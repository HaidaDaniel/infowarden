import { IndexingJobType } from '@prisma/client';
import { SourceType } from '../sources/enums/source.enums';
import { BootstrapIndexingService } from './bootstrap-indexing.service';

describe('BootstrapIndexingService', () => {
  it('reuses a matching knowledge base and source before enqueueing scan_source', async () => {
    const knowledgeBasesService = {
      ensureForBootstrap: jest.fn().mockResolvedValue({
        knowledgeBase: { id: 'kb-1', slug: 'career-rag' },
        created: false,
      }),
    };
    const sourcesService = {
      createOrReuse: jest.fn().mockResolvedValue({
        source: { id: 'source-1', knowledgeBaseId: 'kb-1' },
        created: false,
      }),
    };
    const queueService = {
      enqueueIndexingJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const service = new BootstrapIndexingService(
      knowledgeBasesService as any,
      sourcesService as any,
      queueService as any,
    );

    await expect(
      service.bootstrap({
        knowledgeBase: {
          slug: 'career-rag',
        },
        source: {
          type: SourceType.LOCAL_FOLDER,
          uri: '/tmp/career',
          includeRules: ['**/*.md'],
        },
      } as any),
    ).resolves.toEqual({
      knowledgeBase: { id: 'kb-1', slug: 'career-rag' },
      source: { id: 'source-1', knowledgeBaseId: 'kb-1' },
      job: { id: 'job-1' },
      reused: {
        knowledgeBase: true,
        source: true,
      },
    });

    expect(queueService.enqueueIndexingJob).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      sourceId: 'source-1',
      type: IndexingJobType.scan_source,
    });
  });
});
