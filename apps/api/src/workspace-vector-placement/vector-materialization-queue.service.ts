import { Inject, Injectable, OnModuleInit, OnModuleDestroy, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Prisma, VectorMaterializationOperationState, VectorMaterializationStrategy } from '@prisma/client';
import { AppException, getErrorMessage, sanitizeErrorDetails } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { createTraceContext, parseTraceparent } from '../telemetry/trace-context';
import { WorkspaceVectorPlacementService } from './workspace-vector-placement.service';

const VECTOR_MATERIALIZATION_QUEUE_NAME = 'vector-materialization';

@Injectable()
export class VectorMaterializationQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly redis: Redis;
  private readonly queue: Queue;
  private readonly worker: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => WorkspaceVectorPlacementService))
    private readonly placements: WorkspaceVectorPlacementService,
    @Optional()
    @Inject(TelemetryService)
    private readonly telemetry?: TelemetryService,
  ) {
    this.redis = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue(VECTOR_MATERIALIZATION_QUEUE_NAME, {
      connection: this.redis.duplicate(),
    });
    this.worker = new Worker(VECTOR_MATERIALIZATION_QUEUE_NAME, (job) => this.process(job), {
      connection: this.redis.duplicate(),
      concurrency: this.workerConcurrency(),
    });
    this.worker.on('failed', (job, error) => {
      void this.handleFailedJob(job, error);
    });
  }

  private async handleFailedJob(job: Job | undefined, error: Error): Promise<void> {
    if (!job) return;
    const appError = error as { code?: string; stage?: string; details?: Record<string, unknown> };
    const configuredAttempts = this.configuredAttempts(job);
    if (!this.hasExhaustedAttempts(job)) {
      await this.prisma.vectorMaterializationOperation
        .update({
          where: { id: job.data.operationId },
          data: {
            errorSummary: {
              message: getErrorMessage(error),
              code: appError.code,
              stage: appError.stage,
              details: sanitizeErrorDetails(appError.details),
              lastFailedAttemptAt: new Date().toISOString(),
              attemptsMade: job.attemptsMade,
              attemptsConfigured: configuredAttempts,
            } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      return;
    }
    await this.placements.failOperation(job.data.operationId, error).catch(() => undefined);
    await this.prisma.vectorMaterializationOperation
      .update({
        where: { id: job.data.operationId },
        data: {
          state: 'failed',
          errorSummary: {
            message: getErrorMessage(error),
            code: appError.code,
            stage: appError.stage,
            details: sanitizeErrorDetails(appError.details),
            failedAt: new Date().toISOString(),
            attemptsMade: job.attemptsMade,
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }

  async onModuleInit() {
    await this.reconcilePendingOperations();
  }

  async enqueueBuild(operationId: string, strategy?: VectorMaterializationStrategy) {
    const operation = await this.prisma.vectorMaterializationOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation) {
      throw new AppException(
        'vector_operation_not_found',
        'Vector materialization operation was not found',
        'enqueue_vector_operation',
        false,
        { operationId },
      );
    }
    const effectiveStrategy = strategy || operation.strategy;
    if (this.isBuildTerminal(operation.state)) {
      return operation;
    }
    const existingJobState = operation.buildJobId ? await this.jobState(operation.buildJobId) : undefined;
    if (
      operation.state !== VectorMaterializationOperationState.failed &&
      operation.buildJobId &&
      this.isLiveJobState(existingJobState)
    ) {
      return operation;
    }
    const checkpoint = this.record(operation.progressCheckpoint);
    const enqueueGeneration =
      operation.state === VectorMaterializationOperationState.failed || this.isTerminalJobState(existingJobState)
        ? this.numberValue(checkpoint.enqueueGeneration) + 1
        : Math.max(this.numberValue(checkpoint.enqueueGeneration), 1);
    const buildJobId = `vector-operation-${operation.id}-attempt-${enqueueGeneration}`;
    await this.prisma.vectorMaterializationOperation.update({
      where: { id: operation.id },
      data: {
        state:
          operation.state === VectorMaterializationOperationState.failed
            ? VectorMaterializationOperationState.planned
            : operation.state,
        strategy: effectiveStrategy,
        buildJobId,
        progressCheckpoint: {
          ...checkpoint,
          queuedAt: new Date().toISOString(),
          enqueueGeneration,
          previousBuildJobId:
            operation.buildJobId && operation.buildJobId !== buildJobId ? operation.buildJobId : undefined,
        } as Prisma.InputJsonValue,
      },
    });
    await this.queue.add(
      'build-vector-operation',
      {
        operationId: operation.id,
        strategy: effectiveStrategy,
        traceparent: this.telemetry?.traceparent(),
      },
      {
        jobId: buildJobId,
        attempts: this.workerAttempts(),
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    );
    return this.prisma.vectorMaterializationOperation.findUnique({
      where: { id: operation.id },
    });
  }

  async process(job: Job) {
    const context = createTraceContext(parseTraceparent(job.data.traceparent));
    const run = () =>
      this.placements.executeOperationBuild(job.data.operationId, job.data.strategy, {
        finalizeFailures: false,
      });
    return this.telemetry
      ? this.telemetry.runWithContext(context, () =>
          this.telemetry!.span(
            'bullmq.vector_materialization.process',
            {
              operationId: job.data.operationId,
              bullmqJobId: String(job.id || ''),
              strategy: job.data.strategy,
              attempt: job.attemptsMade,
            },
            run,
          ),
        )
      : run();
  }

  async close(): Promise<void> {
    await this.closeWorkerWithBound();
    await this.queue.close();
    await this.redis.quit();
  }

  async onModuleDestroy() {
    await this.close();
  }

  private workerConcurrency(): number {
    const parsed = Number.parseInt(process.env.VECTOR_OPERATION_WORKER_CONCURRENCY || '1', 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 4) : 1;
  }

  private workerAttempts(): number {
    const parsed = Number.parseInt(process.env.VECTOR_OPERATION_WORKER_ATTEMPTS || '5', 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 8) : 3;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private configuredAttempts(job: Pick<Job, 'opts'>): number {
    return typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
  }

  private hasExhaustedAttempts(job: Pick<Job, 'attemptsMade' | 'opts'>): boolean {
    return job.attemptsMade >= this.configuredAttempts(job);
  }

  private async reconcilePendingOperations(): Promise<void> {
    const operations = await this.prisma.vectorMaterializationOperation.findMany({
      where: {
        state: {
          in: [
            VectorMaterializationOperationState.planned,
            VectorMaterializationOperationState.building,
            VectorMaterializationOperationState.validating,
          ],
        },
      },
      orderBy: { updatedAt: 'asc' },
    });
    for (const operation of operations) {
      await this.enqueueBuild(operation.id, operation.strategy).catch((error) =>
        this.prisma.vectorMaterializationOperation
          .update({
            where: { id: operation.id },
            data: {
              errorSummary: {
                message: getErrorMessage(error),
                stage: 'vector_operation_reconcile',
                retryable: true,
                failedAt: new Date().toISOString(),
              } as Prisma.InputJsonValue,
            },
          })
          .catch(() => undefined),
      );
    }
  }

  private isBuildTerminal(state: VectorMaterializationOperationState): boolean {
    return new Set<VectorMaterializationOperationState>([
      VectorMaterializationOperationState.ready_for_cutover,
      VectorMaterializationOperationState.cutover_complete,
      VectorMaterializationOperationState.rollback_complete,
      VectorMaterializationOperationState.cleanup_pending,
      VectorMaterializationOperationState.cleanup_complete,
      VectorMaterializationOperationState.cancelled,
    ]).has(state);
  }

  private isLiveJobState(state?: string): boolean {
    return ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children', 'paused'].includes(state || '');
  }

  private isTerminalJobState(state?: string): boolean {
    return ['completed', 'failed', 'unknown'].includes(state || '');
  }

  private async jobState(jobId: string): Promise<string | undefined> {
    try {
      const job = await this.queue.getJob(jobId);
      return job ? job.getState() : 'unknown';
    } catch {
      return undefined;
    }
  }

  private numberValue(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  }

  private async closeWorkerWithBound(): Promise<void> {
    const timeoutMs = this.shutdownTimeoutMs();
    const closePromise = this.worker.close();
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeout = setTimeout(() => resolve('timeout'), timeoutMs);
      timeout.unref?.();
    });
    const result = await Promise.race([closePromise.then(() => 'closed' as const), timeoutPromise]);
    if (timeout) clearTimeout(timeout);
    if (result === 'closed') return;
    await this.markActiveOperationsRetryable(timeoutMs);
    await this.worker.close(true);
  }

  private shutdownTimeoutMs(): number {
    const parsed = Number.parseInt(process.env.VECTOR_OPERATION_SHUTDOWN_TIMEOUT_MS || '15000', 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1_000), 60_000) : 15_000;
  }

  private async markActiveOperationsRetryable(timeoutMs: number): Promise<void> {
    const operations = await this.prisma.vectorMaterializationOperation.findMany({
      where: {
        state: {
          in: [VectorMaterializationOperationState.building, VectorMaterializationOperationState.validating],
        },
      },
    });
    await Promise.all(
      operations.map((operation) =>
        this.prisma.vectorMaterializationOperation
          .update({
            where: { id: operation.id },
            data: {
              progressCheckpoint: {
                ...this.record(operation.progressCheckpoint),
                shutdownTimeoutMs: timeoutMs,
                shutdownRetryableAt: new Date().toISOString(),
              } as Prisma.InputJsonValue,
              errorSummary: {
                ...this.record(operation.errorSummary),
                message: 'Vector worker shutdown reached drain bound; operation remains retryable',
                code: 'vector_operation_shutdown_retryable',
                stage: 'vector_operation_shutdown',
                retryable: true,
              } as Prisma.InputJsonValue,
            },
          })
          .catch(() => undefined),
      ),
    );
  }
}
