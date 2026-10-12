import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { RedisService } from './redis.service';
import { LocalFolderIndexer } from './local-folder-indexer';
import { IndexingJobType, JobStatus } from '@prisma/client';
import { AppException, getErrorMessage } from '../common/app-error';
import { SourceRefreshRequestContext } from './indexing.types';
import { WorkspaceLoadReconciliationService } from './workspace-load-reconciliation.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { createTraceContext, parseTraceparent } from '../telemetry/trace-context';

const INDEXING_QUEUE_NAME = 'indexing';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private queue: Queue;
  private worker: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly redisService: RedisService,
    private readonly indexer: LocalFolderIndexer,
    private readonly workspaceLoadReconciliationService: WorkspaceLoadReconciliationService,
    private readonly telemetry: TelemetryService,
  ) {
    const redis = redisService.getRedis();
    const connection = redis.duplicate();

    this.queue = new Queue(INDEXING_QUEUE_NAME, { connection });

    this.worker = new Worker(INDEXING_QUEUE_NAME, async (job: Job) => this.processJob(job), {
      connection: redis.duplicate(),
      concurrency: this.workerConcurrency(),
    });

    this.worker.on('completed', (job: Job) => {
      void this.handleCompletedJob(job);
    });

    this.worker.on('failed', (job: Job, error) => {
      void this.handleFailedJob(job, error);
    });
  }

  private async handleCompletedJob(job: Job): Promise<void> {
    if (!job) return;
    const returnValue = (job.returnvalue || {}) as {
      stats?: Record<string, unknown>;
      logs?: Array<Record<string, unknown>>;
    };
    const stats = returnValue.stats || {};
    const logs = returnValue.logs || [];

    await this.prisma.indexingJob.update({
      where: { id: job.data.jobId },
      data: {
        status: 'succeeded' as JobStatus,
        finishedAt: new Date(),
        stats: stats as any,
        logs: logs as any,
      },
    });
  }

  private async handleFailedJob(job: Job, error: unknown): Promise<void> {
    if (!job) return;
    const existingJob =
      job.data.type === IndexingJobType.scan_source
        ? null
        : await this.prisma.indexingJob.findUnique({
            where: { id: job.data.jobId },
            select: { logs: true },
          });
    const logs =
      job.data.type === IndexingJobType.scan_source
        ? this.indexer.getLogs(job.data.jobId)
        : Array.isArray(existingJob?.logs)
          ? ([...(existingJob.logs as any[])] as any[])
          : [];
    logs.push({
      level: 'error',
      message: getErrorMessage(error),
      at: new Date().toISOString(),
      data: {
        code: (error as any)?.code || (error as any)?.response?.code || 'indexing_job_failed',
        stage: (error as any)?.stage || (error as any)?.response?.stage || 'indexing_worker',
      },
    });

    await this.prisma.indexingJob.update({
      where: { id: job.data.jobId },
      data: {
        status: 'failed' as JobStatus,
        finishedAt: new Date(),
        logs: logs as any,
      },
    });
  }

  async processJob(job: Job): Promise<Record<string, unknown>> {
    const context = createTraceContext(parseTraceparent(job.data.traceparent));
    return this.telemetry.runWithContext(context, () =>
      this.telemetry.span(
        'bullmq.process',
        {
          jobId: job.data.jobId,
          bullmqJobId: String(job.id || ''),
          jobType: job.data.type,
          knowledgeBaseId: job.data.knowledgeBaseId,
          sourceId: job.data.sourceId,
          attempt: job.attemptsMade,
        },
        () => this.processJobWithTelemetry(job),
      ),
    );
  }

  private async processJobWithTelemetry(job: Job): Promise<Record<string, unknown>> {
    const { jobId, sourceId, type, knowledgeBaseId, refresh } = job.data;

    await this.prisma.indexingJob.update({
      where: { id: jobId },
      data: {
        status: 'running' as JobStatus,
        startedAt: new Date(),
      },
    });

    if (type === IndexingJobType.scan_source) {
      if (!sourceId) {
        throw new AppException(
          'indexing_source_required',
          'sourceId is required for scan_source indexing jobs',
          'process_indexing_job',
          false,
          { jobId, knowledgeBaseId, type },
        );
      }
      await this.indexer.run(jobId, refresh);
      return {
        stats: this.indexer.getStats(jobId),
        logs: this.indexer.getLogs(jobId),
      };
    }

    if (type === IndexingJobType.build_index && refresh?.triggerMetadata?.lifecycleAction === 'load_workspace') {
      return this.workspaceLoadReconciliationService.run(jobId, refresh);
    }

    return { message: `Job ${jobId} completed successfully` };
  }

  async enqueueIndexingJob(data: {
    knowledgeBaseId?: string;
    knowledgeBaseSlug?: string;
    sourceId?: string;
    type: IndexingJobType;
    refresh?: SourceRefreshRequestContext;
  }): Promise<{ id: string }> {
    const knowledgeBase = await this.knowledgeBasesService.resolveReference(
      data.knowledgeBaseId,
      data.knowledgeBaseSlug,
    );

    const jobRecord = await this.prisma.indexingJob.create({
      data: {
        knowledgeBaseId: knowledgeBase.id,
        sourceId: data.sourceId,
        type: data.type,
        status: 'queued',
        stats: data.refresh ? ({ refresh: data.refresh } as any) : undefined,
        logs: data.refresh
          ? ([
              {
                level: 'info',
                message: 'Source refresh enqueued',
                at: new Date().toISOString(),
                data: {
                  refreshMode: data.refresh.mode,
                  refreshReason: data.refresh.reason,
                  refreshTrigger: data.refresh.trigger,
                  triggerMetadata: data.refresh.triggerMetadata,
                },
              },
            ] as any)
          : undefined,
      },
    });

    try {
      await this.queue.add(
        'indexing',
        {
          jobId: jobRecord.id,
          knowledgeBaseId: knowledgeBase.id,
          sourceId: data.sourceId,
          type: data.type,
          refresh: data.refresh,
          traceparent: this.telemetry.traceparent(),
        },
        {
          jobId: jobRecord.id,
        },
      );
    } catch (error) {
      const message = getErrorMessage(error, 'Queue is unavailable');
      await this.prisma.indexingJob.update({
        where: { id: jobRecord.id },
        data: {
          status: 'failed' as JobStatus,
          finishedAt: new Date(),
          logs: [
            {
              level: 'error',
              message,
              at: new Date().toISOString(),
              data: {
                code: 'queue_unavailable',
                stage: 'enqueue_indexing_job',
              },
            },
          ] as any,
        },
      });
      throw new AppException(
        'queue_unavailable',
        'Indexing queue is unavailable; check Redis connectivity',
        'enqueue_indexing_job',
        true,
        { cause: message },
      );
    }

    return { id: jobRecord.id };
  }

  async getJobStatus(jobId: string) {
    return this.prisma.indexingJob.findUnique({
      where: { id: jobId },
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private workerConcurrency(): number {
    const parsed = Number.parseInt(process.env.INDEXING_WORKER_CONCURRENCY || '1', 10);
    if (!Number.isFinite(parsed)) {
      return 1;
    }
    return Math.min(Math.max(parsed, 1), 8);
  }
}
