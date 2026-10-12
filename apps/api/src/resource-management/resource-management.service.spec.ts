import { IndexVersionStatus, SourceStatus } from '@prisma/client';
import { ResourceManagementService } from './resource-management.service';

describe('ResourceManagementService', () => {
  it('estimates vector size from chunk count and embedding dimension', async () => {
    const { service } = createService({
      workspace: { activeIndexVersionId: 'idx-1' },
      indexVersion: {
        id: 'idx-1',
        embeddingDimension: 2560,
        storageProfile: 'low_memory',
      },
      chunkCount: 1000,
    });

    const estimate = await service.estimateWorkspace('kb-1');

    expect(estimate.embeddingDimension).toBe(2560);
    expect(estimate.estimatedChunks).toBe(1000);
    expect(estimate.rawVectorBytes).toBe(1000 * 2560 * 4);
    expect(estimate.storageProfile).toBe('low_memory');
    expect(estimate.warnings.map((warning: any) => warning.code)).toContain('embedding_dimension_large');
  });

  it('unloads a workspace by deleting the collection and marking lifecycle state', async () => {
    const { service, prisma, vectorIndex } = createService({
      workspace: { activeIndexVersionId: 'idx-1' },
      indexVersion: {
        id: 'idx-1',
        vectorCollectionName: 'kb-kb-1',
        status: IndexVersionStatus.active,
        resourceActual: { chunks: 10 },
      },
    });

    const result = await service.unloadWorkspace('kb-1');

    expect(vectorIndex.deleteCollection).toHaveBeenCalledWith('kb-kb-1', 'backend-1');
    expect(prisma.indexVersion.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'idx-1' },
        data: expect.objectContaining({ lifecycleStatus: 'unloaded' }),
      }),
    );
    expect(result.lifecycle.status).toBe('unloaded');
  });

  it('load enqueues all-source reconciliation when the collection is missing', async () => {
    const { service, queue } = createService({
      workspace: { activeIndexVersionId: 'idx-1' },
      indexVersion: {
        id: 'idx-1',
        vectorCollectionName: 'kb-kb-1',
        status: IndexVersionStatus.active,
        storageProfile: 'balanced',
      },
      collectionInfo: null,
      source: { id: 'source-1' },
    });

    const result = await service.loadWorkspace('kb-1', { storageProfile: 'low_memory' });

    expect(queue.enqueueIndexingJob).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        type: 'build_index',
        refresh: expect.objectContaining({
          mode: 'rebuild_collection',
          triggerMetadata: expect.objectContaining({
            storageProfile: 'low_memory',
            lifecycleAction: 'load_workspace',
            servingRevisionId: 'serving-1',
          }),
        }),
      }),
    );
    expect(result.lifecycle.status).toBe('loading');
  });

  it('marks existing collection partially loaded when active manifest coverage is incomplete', async () => {
    const { service, prisma, queue, qdrant } = createService({
      workspace: { activeIndexVersionId: 'idx-1' },
      indexVersion: {
        id: 'idx-1',
        vectorCollectionName: 'kb-kb-1',
        status: IndexVersionStatus.active,
      },
      collectionInfo: { status: 'green' },
      chunkCountByRevision: 2,
    });
    qdrant.countBySourceRevisionId.mockResolvedValueOnce(1);

    const result = await service.loadWorkspace('kb-1');

    expect(prisma.indexVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'idx-1' },
        data: expect.objectContaining({ lifecycleStatus: 'partially_loaded' }),
      }),
    );
    expect(queue.enqueueIndexingJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'build_index' }),
    );
    expect(result.lifecycle.status).toBe('loading');
  });

  it('returns an existing load reconciliation job under retry instead of enqueueing another one', async () => {
    const { service, queue } = createService({
      workspace: { activeIndexVersionId: 'idx-1' },
      indexVersion: {
        id: 'idx-1',
        vectorCollectionName: 'kb-kb-1',
        status: IndexVersionStatus.active,
      },
      collectionInfo: null,
      existingLoadJob: { id: 'job-existing' },
    });

    const result = await service.loadWorkspace('kb-1');

    expect(queue.enqueueIndexingJob).not.toHaveBeenCalled();
    expect(result.job).toEqual({ id: 'job-existing' });
    expect(result.lifecycle.status).toBe('loading');
  });
});

function createService(options: {
  workspace?: Record<string, any>;
  indexVersion?: Record<string, any>;
  chunkCount?: number;
  documentCount?: number;
  sourceStats?: Record<string, any>;
  collectionInfo?: any;
  source?: Record<string, any> | null;
  chunkCountByRevision?: number;
  existingLoadJob?: Record<string, any> | null;
} = {}) {
  const workspace = {
    id: 'kb-1',
    slug: 'kb-1',
    name: 'KB 1',
    workspaceKind: 'general',
    activeIndexVersionId: null,
    activeServingRevisionId: 'serving-1',
    ...options.workspace,
  };
  const indexVersion = {
    id: 'idx-1',
    status: IndexVersionStatus.active,
    lifecycleStatus: 'loaded',
    vectorCollectionName: 'kb-kb-1',
    embeddingDimension: 384,
    embeddingModel: 'embedding-model',
    storageProfile: 'balanced',
    storageConfig: {},
    resourceEstimate: {},
    resourceActual: {},
    createdAt: new Date('2026-07-15T00:00:00Z'),
    resourceRequested: {},
    resourceAllocated: {},
    resourceObserved: {},
    ...options.indexVersion,
  };
  const servingRevision = {
    id: 'serving-1',
    status: 'active',
    manifestEntries: [
      {
        sourceRevisionId: 'revision-1',
        sourceRevision: {
          id: 'revision-1',
          sourceId: 'source-1',
          documentCount: 1,
        },
      },
    ],
  };
  const placement = {
    id: 'placement-1',
    knowledgeBaseId: 'kb-1',
    vectorBackendId: 'backend-1',
    collectionAlias: 'workspace-kb-1',
    physicalCollectionName: 'kb-kb-1',
    state: 'loaded',
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    vectorBackend: { id: 'backend-1', state: 'enabled' },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (callback) => callback(prisma)),
    knowledgeBase: {
      findUnique: jest.fn().mockResolvedValue({
        activeServingRevisionId: 'serving-1',
      }),
    },
    workspaceVectorPlacement: {
      findUnique: jest.fn().mockResolvedValue(placement),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...placement, ...data })),
    },
    workspaceServingRevision: {
      findUnique: jest.fn().mockResolvedValue(servingRevision),
    },
    indexVersion: {
      findUnique: jest.fn().mockResolvedValue(indexVersion),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...indexVersion, ...data })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    indexingJob: {
      findMany: jest.fn().mockResolvedValue(
        options.existingLoadJob
          ? [
              {
                ...options.existingLoadJob,
                stats: {
                  refresh: {
                    triggerMetadata: {
                      lifecycleAction: 'load_workspace',
                    },
                  },
                },
              },
            ]
          : [],
      ),
    },
    document: {
      count: jest.fn().mockResolvedValue(options.documentCount ?? 0),
    },
    chunk: {
      count: jest.fn().mockImplementation(async ({ where }) => {
        if (where?.metadata?.path?.[0] === 'sourceRevisionId') {
          return options.chunkCountByRevision ?? 1;
        }
        return options.chunkCount ?? 0;
      }),
    },
    sourceSnapshot: {
      aggregate: jest.fn().mockResolvedValue(
        options.sourceStats || { _sum: { fileCount: 0, contentBytes: 0 } },
      ),
    },
    source: {
      findFirst: jest.fn().mockResolvedValue(
        options.source === undefined ? { id: 'source-1', status: SourceStatus.active } : options.source,
      ),
      findMany: jest.fn().mockResolvedValue([{ id: 'source-1' }]),
    },
  };
  const knowledgeBases = {
    resolveIdentifier: jest.fn().mockResolvedValue(workspace),
  };
  const vectorIndex = {
    getCollectionInfo: jest.fn().mockResolvedValue(
      options.collectionInfo === undefined ? { status: 'green' } : options.collectionInfo,
    ),
    deleteCollection: jest.fn().mockResolvedValue(undefined),
  };
  const queue = {
    enqueueIndexingJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const qdrant = {
    countBySourceRevisionId: jest.fn().mockResolvedValue(1),
  };
  return {
    service: new ResourceManagementService(
      prisma as any,
      knowledgeBases as any,
      vectorIndex as any,
      queue as any,
      qdrant as any,
    ),
    prisma,
    knowledgeBases,
    vectorIndex,
    queue,
    qdrant,
  };
}
