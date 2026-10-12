import { IndexingJobType } from '@prisma/client';
import { AppException } from '../common/app-error';
import { JobsController } from './jobs.controller';

describe('JobsController', () => {
  it('forwards bootstrap requests to the bootstrap indexing service', async () => {
    const queue = {
      enqueueIndexingJob: jest.fn(),
    };
    const bootstrap = {
      bootstrap: jest.fn().mockResolvedValue({ job: { id: 'job-1' } }),
    };
    const controller = new JobsController(queue as any, bootstrap as any);

    await expect(
      controller.bootstrapIndexing({
        knowledgeBase: {
          slug: 'career-rag',
        },
        source: {
          type: 'local_folder',
          uri: '/tmp/career',
        },
      } as any),
    ).resolves.toEqual({ job: { id: 'job-1' } });

    expect(bootstrap.bootstrap).toHaveBeenCalled();
  });

  it('rejects jobs without a knowledge base identifier before queueing', async () => {
    const queue = {
      enqueueIndexingJob: jest.fn(),
    };
    const controller = new JobsController(queue as any, {} as any);

    await expect(
      controller.enqueueIndexingJob({
        type: IndexingJobType.build_index,
      } as any),
    ).rejects.toBeInstanceOf(AppException);
    expect(queue.enqueueIndexingJob).not.toHaveBeenCalled();
  });

  it('rejects scan_source jobs without a sourceId before queueing', async () => {
    const queue = {
      enqueueIndexingJob: jest.fn(),
    };
    const controller = new JobsController(queue as any, {} as any);

    await expect(
      controller.enqueueIndexingJob({
        knowledgeBaseSlug: 'career-rag',
        type: IndexingJobType.scan_source,
      }),
    ).rejects.toBeInstanceOf(AppException);
    expect(queue.enqueueIndexingJob).not.toHaveBeenCalled();
  });
});
