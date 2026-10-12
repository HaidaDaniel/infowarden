import { VectorMaterializationQueueService } from './vector-materialization-queue.service';

describe('VectorMaterializationQueueService', () => {
  it('closes worker before queue and Redis at the shutdown boundary', async () => {
    const calls: string[] = [];
    const queue = { close: jest.fn().mockResolvedValue(undefined) };
    const worker = {
      close: jest.fn().mockImplementation(async () => {
        calls.push('worker');
      }),
    };
    queue.close.mockImplementation(async () => {
      calls.push('queue');
    });
    const redis = {
      quit: jest.fn().mockImplementation(async () => {
        calls.push('redis');
      }),
    };
    const service = Object.create(
      VectorMaterializationQueueService.prototype,
    ) as VectorMaterializationQueueService;
    (service as any).queue = queue;
    (service as any).worker = worker;
    (service as any).redis = redis;

    await service.close();

    expect(queue.close).toHaveBeenCalledTimes(1);
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['worker', 'queue', 'redis']);
  });

  it('retries a retained failed operation with a fresh BullMQ job id', async () => {
    const { service, prisma, queue } = createQueueService();
    prisma.vectorMaterializationOperation.findUnique
      .mockResolvedValueOnce({
        id: 'operation-1',
        state: 'failed',
        strategy: 'canonical_reembed',
        buildJobId: 'vector-operation-operation-1-attempt-2',
        progressCheckpoint: { enqueueGeneration: 2 },
      })
      .mockResolvedValueOnce({
        id: 'operation-1',
        state: 'planned',
        buildJobId: 'vector-operation-operation-1-attempt-3',
      });

    await service.enqueueBuild('operation-1');

    expect(queue.add).toHaveBeenCalledWith(
      'build-vector-operation',
      expect.objectContaining({ operationId: 'operation-1' }),
      expect.objectContaining({
        jobId: 'vector-operation-operation-1-attempt-3',
      }),
    );
    expect(prisma.vectorMaterializationOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'planned',
          buildJobId: 'vector-operation-operation-1-attempt-3',
          progressCheckpoint: expect.objectContaining({
            enqueueGeneration: 3,
            previousBuildJobId: 'vector-operation-operation-1-attempt-2',
          }),
        }),
      }),
    );
  });

  it('does not enqueue a parallel build when an operation already has a live job', async () => {
    const { service, prisma, queue } = createQueueService();
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue({
      id: 'operation-1',
      state: 'building',
      strategy: 'canonical_reembed',
      buildJobId: 'vector-operation-operation-1-attempt-1',
      progressCheckpoint: { enqueueGeneration: 1 },
    });
    queue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('active'),
    });

    await service.enqueueBuild('operation-1');

    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.vectorMaterializationOperation.update).not.toHaveBeenCalled();
  });

  it('reconciles durable in-flight operations on startup', async () => {
    const { service, prisma } = createQueueService();
    const enqueueBuild = jest.fn().mockResolvedValue(undefined);
    (service as any).enqueueBuild = enqueueBuild;
    prisma.vectorMaterializationOperation.findMany.mockResolvedValue([
      { id: 'operation-1', strategy: 'canonical_reembed' },
      { id: 'operation-2', strategy: 'compatible_copy' },
    ]);

    await service.onModuleInit();

    expect(enqueueBuild).toHaveBeenCalledWith('operation-1', 'canonical_reembed');
    expect(enqueueBuild).toHaveBeenCalledWith('operation-2', 'compatible_copy');
  });

  it('keeps worker retries non-terminal until configured attempts are exhausted', () => {
    const service = Object.create(
      VectorMaterializationQueueService.prototype,
    ) as VectorMaterializationQueueService;

    expect(
      (service as any).hasExhaustedAttempts({
        attemptsMade: 1,
        opts: { attempts: 5 },
      }),
    ).toBe(false);
    expect(
      (service as any).hasExhaustedAttempts({
        attemptsMade: 5,
        opts: { attempts: 5 },
      }),
    ).toBe(true);
  });

  it('lets BullMQ own terminal failure state while processing build retries', async () => {
    const placements = {
      executeOperationBuild: jest.fn().mockResolvedValue({ id: 'operation-1' }),
    };
    const service = Object.create(
      VectorMaterializationQueueService.prototype,
    ) as VectorMaterializationQueueService;
    (service as any).placements = placements;

    await service.process({
      data: { operationId: 'operation-1', strategy: 'canonical_reembed' },
      id: 'job-1',
      attemptsMade: 2,
    } as any);

    expect(placements.executeOperationBuild).toHaveBeenCalledWith(
      'operation-1',
      'canonical_reembed',
      { finalizeFailures: false },
    );
  });
});

function createQueueService() {
  const prisma = {
    vectorMaterializationOperation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const queue = {
    add: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(undefined),
  };
  const worker = { close: jest.fn().mockResolvedValue(undefined) };
  const redis = { quit: jest.fn().mockResolvedValue(undefined) };
  const service = Object.create(
    VectorMaterializationQueueService.prototype,
  ) as VectorMaterializationQueueService;
  (service as any).prisma = prisma;
  (service as any).queue = queue;
  (service as any).worker = worker;
  (service as any).redis = redis;
  (service as any).telemetry = undefined;
  return { service, prisma, queue, worker, redis };
}
