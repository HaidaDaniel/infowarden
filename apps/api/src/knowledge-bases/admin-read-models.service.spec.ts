import {
  IndexVersionStatus,
  IndexingJobType,
  JobStatus,
  SourceStatus,
  SourceType,
  WorkspaceKind,
} from '@prisma/client';
import { AdminReadModelsService } from './admin-read-models.service';

describe('AdminReadModelsService', () => {
  const prisma = {
    knowledgeBase: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      groupBy: jest.fn(),
    },
    source: {
      count: jest.fn(),
    },
    document: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    chunk: {
      groupBy: jest.fn(),
    },
    indexVersion: {
      findMany: jest.fn(),
    },
    indexingJob: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    sourceSnapshot: {
      findMany: jest.fn(),
    },
  };

  const knowledgeBasesService = {
    resolveIdentifier: jest.fn(),
    resolveReference: jest.fn(),
    evaluateAvailability: jest.fn(),
  };

  const healthService = {
    checkAll: jest.fn(),
  };

  const retrievalService = {
    traceRetrieval: jest.fn(),
  };

  let service: AdminReadModelsService;

  beforeEach(() => {
    jest.clearAllMocks();
    knowledgeBasesService.evaluateAvailability.mockImplementation(
      async (workspaces: any[]) =>
        new Map(
          workspaces.map((workspace) => [
            workspace.id,
            workspace.activeIndexVersionId
              ? { status: 'available', retryable: false }
              : { status: 'unindexed', reason: 'active_index_missing', retryable: false },
          ]),
        ),
    );
    service = new AdminReadModelsService(
      prisma as any,
      knowledgeBasesService as any,
      healthService as any,
      retrievalService as any,
    );
  });

  it('returns an empty dashboard state when no admin data exists', async () => {
    prisma.knowledgeBase.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.source.count.mockResolvedValue(0);
    prisma.document.count.mockResolvedValue(0);
    prisma.indexingJob.groupBy.mockResolvedValue([]);
    prisma.indexingJob.findMany.mockResolvedValue([]);
    prisma.knowledgeBase.groupBy.mockResolvedValue([]);
    prisma.knowledgeBase.findMany.mockResolvedValue([]);
    prisma.indexVersion.findMany.mockResolvedValue([]);
    prisma.chunk.groupBy.mockResolvedValue([]);
    prisma.indexingJob.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    healthService.checkAll.mockResolvedValue({
      status: 'healthy',
      timestamp: '2026-05-24T18:30:00.000Z',
      services: {
        database: { status: 'up' },
        redis: { status: 'up' },
        qdrant: { status: 'up' },
        embeddings: { status: 'up' },
      },
    });

    await expect(service.getDashboard()).resolves.toEqual({
      totals: {
        knowledgeBases: 0,
        sources: 0,
        documents: 0,
        activeIndexes: 0,
      },
      jobs: {
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
      },
      lastSuccessfulIndexAt: null,
      recentJobs: [],
      system: {
        health: expect.objectContaining({
          status: 'healthy',
        }),
        queue: {
          queued: 0,
          running: 0,
          succeededLastHour: 0,
          failedLast24Hours: 0,
          pressure: 'idle',
        },
        workspaceKinds: {},
        collections: {
          totalActiveCollections: 0,
          totalChunks: 0,
          items: [],
        },
      },
    });
  });

  it('reports only indexes currently referenced by knowledge bases as active collections', async () => {
    const activeCreatedAt = new Date('2026-05-24T18:00:00.000Z');
    prisma.knowledgeBase.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.source.count.mockResolvedValue(1);
    prisma.document.count.mockResolvedValue(3);
    prisma.indexingJob.groupBy.mockResolvedValue([]);
    prisma.indexingJob.findMany.mockResolvedValue([]);
    prisma.knowledgeBase.groupBy.mockResolvedValue([]);
    prisma.knowledgeBase.findMany.mockResolvedValue([
      {
        id: 'kb-1',
        slug: 'career-rag',
        name: 'Career RAG',
        workspaceKind: WorkspaceKind.codebase,
        activeIndexVersionId: 'idx-current',
      },
    ]);
    prisma.indexVersion.findMany.mockResolvedValue([
      {
        id: 'idx-current',
        vectorCollectionName: 'kb-kb-1',
        materializationMode: 'mutable_collection',
        createdAt: activeCreatedAt,
        embeddingModel: 'qwen3-embedding-4b',
        embeddingDimension: 2560,
      },
    ]);
    prisma.chunk.groupBy.mockResolvedValue([
      {
        indexVersionId: 'idx-current',
        _count: { _all: 3 },
      },
      {
        indexVersionId: 'idx-stale',
        _count: { _all: 99 },
      },
    ]);
    prisma.indexingJob.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    healthService.checkAll.mockResolvedValue({
      status: 'healthy',
      timestamp: '2026-05-24T18:30:00.000Z',
      services: {},
    });

    const result = await service.getDashboard();

    expect(prisma.indexVersion.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['idx-current'],
        },
        status: IndexVersionStatus.active,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    expect(result.system.collections).toMatchObject({
      totalActiveCollections: 1,
      totalChunks: 3,
      items: [
        expect.objectContaining({
          knowledgeBaseId: 'kb-1',
          indexVersionId: 'idx-current',
        }),
      ],
    });
  });

  it('returns an active knowledge base overview with nested source state and playground config', async () => {
    const finishedAt = new Date('2026-05-12T16:56:07.305Z');
    knowledgeBasesService.resolveIdentifier.mockResolvedValue({
      id: 'kb-1',
      slug: 'career-rag',
    });
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1',
      slug: 'career-rag',
      name: 'Career RAG',
      description: 'Profile knowledge base',
      workspaceKind: WorkspaceKind.codebase,
      defaultRetrievalProfile: 'code-debug',
      activeIndexVersionId: 'idx-1',
      createdAt: new Date('2026-05-12T16:49:36.320Z'),
      updatedAt: new Date('2026-05-12T16:56:07.305Z'),
      retrievalProfiles: [
        {
          key: 'code-debug',
          name: 'Code Debug',
          intent: 'code_search',
          denseTopK: 10,
          scoreThreshold: null,
          neighborBefore: 1,
          neighborAfter: 1,
          tokenBudget: 1500,
          grouping: 'path',
          recencyBoost: false,
        },
      ],
      sources: [
        {
          id: 'src-1',
          type: SourceType.local_folder,
          uri: '/data/career',
          status: SourceStatus.active,
          includeRules: ['**/*.md'],
          excludeRules: [],
          lastSyncedAt: finishedAt,
          createdAt: new Date('2026-05-12T16:49:36.329Z'),
          updatedAt: finishedAt,
        },
      ],
      indexVersions: [
        {
          id: 'idx-1',
          status: IndexVersionStatus.active,
          createdAt: finishedAt,
          embeddingModel: 'qwen3-embedding-4b',
          embeddingDimension: 2560,
          vectorCollectionName: 'kb-kb-1',
          materializationMode: 'mutable_collection',
        },
      ],
    });
    prisma.document.groupBy.mockResolvedValue([
      {
        sourceId: 'src-1',
        _count: {
          _all: 25,
        },
      },
    ]);
    prisma.indexingJob.findMany.mockResolvedValue([
      {
        id: 'job-1',
        knowledgeBaseId: 'kb-1',
        sourceId: 'src-1',
        type: IndexingJobType.scan_source,
        status: JobStatus.succeeded,
        stats: {
          filesScanned: 25,
          filesParsed: 25,
          chunksCreated: 54,
          vectorsUpserted: 54,
          validationReportId: 'vr-1',
        },
        logs: [
          {
            at: '2026-05-12T16:55:57.414Z',
            level: 'info',
            message: 'Starting incremental local folder indexing job',
          },
        ],
        createdAt: new Date('2026-05-12T16:55:57.403Z'),
        startedAt: new Date('2026-05-12T16:55:57.412Z'),
        finishedAt,
        knowledgeBase: {
          id: 'kb-1',
          slug: 'career-rag',
          name: 'Career RAG',
        },
        source: {
          id: 'src-1',
          type: SourceType.local_folder,
          uri: '/data/career',
          status: SourceStatus.active,
        },
      },
    ]);
    prisma.sourceSnapshot.findMany.mockResolvedValue([
      {
        sourceId: 'src-1',
        createdAt: finishedAt,
        ref: null,
        snapshotType: 'local_folder_scan',
        fileCount: 25,
        contentBytes: 125653,
      },
    ]);
    prisma.document.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        sourceId: 'src-1',
        path: 'notes/profile.md',
        mimeType: 'text/markdown',
        contentHash: 'hash-1',
        status: 'active',
        metadata: {
          language: 'markdown',
        },
        createdAt: new Date('2026-05-12T16:50:00.000Z'),
        updatedAt: finishedAt,
      },
    ]);
    prisma.chunk.groupBy.mockResolvedValue([
      {
        documentId: 'doc-1',
        _count: {
          _all: 4,
        },
      },
    ]);

    const result = await service.getKnowledgeBaseOverview('career-rag');

    expect(result.knowledgeBase.slug).toBe('career-rag');
    expect(result.knowledgeBase.activeIndexVersion.id).toBe('idx-1');
    expect(result.knowledgeBase.availability).toEqual({
      status: 'available',
      retryable: false,
    });
    expect(result.knowledgeBase.lastSuccessfulIndexAt).toEqual(finishedAt);
    expect(result.knowledgeBase.workspaceKind).toBe(WorkspaceKind.codebase);
    expect(result.knowledgeBase.counts.documents).toBe(25);
    expect(result.knowledgeBase.sources).toHaveLength(1);
    expect(result.knowledgeBase.sources[0]).toMatchObject({
      id: 'src-1',
      documentCount: 25,
      lastSuccessfulIndexAt: finishedAt,
      lastSnapshot: {
        snapshotType: 'local_folder_scan',
        fileCount: 25,
        contentBytes: 125653,
      },
    });
    expect(result.recentJobs[0]).toMatchObject({
      id: 'job-1',
      status: JobStatus.succeeded,
      progress: {
        filesScanned: 25,
        chunksCreated: 54,
        vectorsUpserted: 54,
        validationReportId: 'vr-1',
      },
    });
    expect(result.retrievalPlayground).toMatchObject({
      defaultProfileKey: 'code-debug',
      profiles: [
        expect.objectContaining({
          key: 'code-debug',
          grouping: 'path',
        }),
      ],
      activeCollection: expect.objectContaining({
        indexVersionId: 'idx-1',
        materializationMode: 'mutable_collection',
      }),
    });
    expect(result.explorer.documents).toEqual([
      expect.objectContaining({
        id: 'doc-1',
        path: 'notes/profile.md',
        chunkCount: 4,
        metadata: {
          language: 'markdown',
        },
      }),
    ]);
  });

  it('returns failed recent jobs with stable error and progress summaries', async () => {
    knowledgeBasesService.resolveReference.mockResolvedValue({
      id: 'kb-1',
      slug: 'career-rag',
    });
    prisma.indexingJob.findMany.mockResolvedValue([
      {
        id: 'job-failed',
        knowledgeBaseId: 'kb-1',
        sourceId: 'src-1',
        type: IndexingJobType.scan_source,
        status: JobStatus.failed,
        stats: {
          filesScanned: 10,
          filesParsed: 8,
          parseFailures: 2,
        },
        logs: [
          {
            at: '2026-05-12T17:00:00.000Z',
            level: 'info',
            message: 'Starting indexing',
          },
          {
            at: '2026-05-12T17:00:05.000Z',
            level: 'error',
            message: 'Embedding model was not found at the configured provider',
            data: {
              code: 'embedding_model_not_found',
              stage: 'preflight',
            },
          },
        ],
        createdAt: new Date('2026-05-12T17:00:00.000Z'),
        startedAt: new Date('2026-05-12T17:00:00.100Z'),
        finishedAt: new Date('2026-05-12T17:00:05.000Z'),
        knowledgeBase: {
          id: 'kb-1',
          slug: 'career-rag',
          name: 'Career RAG',
        },
        source: {
          id: 'src-1',
          type: SourceType.local_folder,
          uri: '/data/career',
          status: SourceStatus.active,
        },
      },
    ]);

    const result = await service.getRecentJobs({
      knowledgeBaseSlug: 'career-rag',
      limit: 1,
    });

    expect(result.filters).toEqual({
      knowledgeBaseId: 'kb-1',
      knowledgeBaseSlug: 'career-rag',
      sourceId: null,
      limit: 1,
    });
    expect(result.jobs[0]).toMatchObject({
      id: 'job-failed',
      status: JobStatus.failed,
      progress: {
        filesScanned: 10,
        filesParsed: 8,
        parseFailures: 2,
      },
      lastErrorSummary: {
        at: '2026-05-12T17:00:05.000Z',
        message: 'Embedding model was not found at the configured provider',
        code: 'embedding_model_not_found',
        stage: 'preflight',
      },
      lastLogAt: '2026-05-12T17:00:05.000Z',
    });
  });

  it('returns retrieval playground traces through the admin read model surface', async () => {
    knowledgeBasesService.resolveIdentifier.mockResolvedValue({
      id: 'kb-1',
      slug: 'career-rag',
    });
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1',
      slug: 'career-rag',
      name: 'Career RAG',
      workspaceKind: WorkspaceKind.codebase,
      defaultRetrievalProfile: 'code-debug',
    });
    retrievalService.traceRetrieval.mockResolvedValue({
      knowledgeBaseId: 'kb-1',
      indexVersionId: 'idx-1',
      query: 'where queue pressure comes from',
      retrievalProfile: { key: 'code-debug' },
      stages: {
        denseCandidates: [{ chunkId: 'chunk-1' }],
        filteredCandidates: [{ chunkId: 'chunk-1' }],
        dedupedCandidates: [{ chunkId: 'chunk-1' }],
        expandedCandidates: [{ chunkId: 'chunk-1' }, { chunkId: 'chunk-2' }],
      },
      contextPackage: {
        count: 2,
        budget: {
          requestedTokens: 1500,
          estimatedTokens: 200,
        },
        groups: [],
      },
      diagnostics: {
        denseCandidates: 1,
        filteredCandidates: 1,
        droppedByFilters: 0,
        droppedDuplicates: 0,
        expandedNeighbors: 1,
        finalCount: 2,
        reranked: false,
      },
    });

    const result = await service.runRetrievalPlayground('career-rag', {
      query: 'where queue pressure comes from',
      profileKey: 'code-debug',
      tokenBudget: 1500,
    });

    expect(result.knowledgeBase).toMatchObject({
      id: 'kb-1',
      slug: 'career-rag',
      defaultRetrievalProfile: 'code-debug',
    });
    expect(result.trace).toMatchObject({
      indexVersionId: 'idx-1',
      diagnostics: {
        expandedNeighbors: 1,
      },
    });
  });
});
