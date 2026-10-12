import { IndexingJobType } from '@prisma/client';
import { QueueService } from './queue.service';
import { AppException } from '../common/app-error';

describe('QueueService', () => {
  it('persists scan results returned for the same job instead of singleton indexer state', async () => {
    const prisma = {
      indexingJob: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const indexer = {
      run: jest.fn().mockResolvedValue(undefined),
      getStats: jest.fn().mockReturnValue({ filesScanned: 2 }),
      getLogs: jest.fn().mockReturnValue([{ level: 'info', message: 'job-2' }]),
    };
    const service = Object.create(QueueService.prototype) as QueueService;
    (service as any).prisma = prisma;
    (service as any).indexer = indexer;

    const result = await (service as any).processJobWithTelemetry({
      data: {
        jobId: 'job-2',
        sourceId: 'source-2',
        knowledgeBaseId: 'kb-1',
        type: IndexingJobType.scan_source,
      },
    });

    expect(indexer.getStats).toHaveBeenCalledWith('job-2');
    expect(indexer.getLogs).toHaveBeenCalledWith('job-2');
    expect(result).toEqual({
      stats: { filesScanned: 2 },
      logs: [{ level: 'info', message: 'job-2' }],
    });
  });

  it('marks the job failed when Redis/BullMQ enqueue fails', async () => {
    const prisma = {
      indexingJob: {
        create: jest.fn().mockResolvedValue({ id: 'job-1' }),
        update: jest.fn().mockResolvedValue({ id: 'job-1' }),
      },
    };
    const knowledgeBasesService = {
      resolveReference: jest.fn().mockResolvedValue({ id: 'kb-1', slug: 'career-rag' }),
    };
    const queue = {
      add: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    };
    const service = Object.create(QueueService.prototype) as QueueService;
    (service as any).prisma = prisma;
    (service as any).knowledgeBasesService = knowledgeBasesService;
    (service as any).queue = queue;

    await expect(
      service.enqueueIndexingJob({
        knowledgeBaseSlug: 'career-rag',
        sourceId: 'source-1',
        type: IndexingJobType.scan_source,
      }),
    ).rejects.toBeInstanceOf(AppException);

    expect(knowledgeBasesService.resolveReference).toHaveBeenCalledWith(undefined, 'career-rag');
    expect(prisma.indexingJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'failed',
          logs: [
            expect.objectContaining({
              data: {
                code: 'queue_unavailable',
                stage: 'enqueue_indexing_job',
              },
            }),
          ],
        }),
      }),
    );
  });

  it('closes BullMQ queue and worker at the shutdown boundary', async () => {
    const calls: string[] = [];
    const queue = { close: jest.fn().mockImplementation(async () => calls.push('queue')) };
    const worker = { close: jest.fn().mockImplementation(async () => calls.push('worker')) };
    const service = Object.create(QueueService.prototype) as QueueService;
    (service as any).queue = queue;
    (service as any).worker = worker;

    await service.onModuleDestroy();

    expect(queue.close).toHaveBeenCalledTimes(1);
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['worker', 'queue']);
  });
});
