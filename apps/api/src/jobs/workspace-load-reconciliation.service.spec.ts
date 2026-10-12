import { WorkspaceLoadReconciliationService } from './workspace-load-reconciliation.service';

describe('WorkspaceLoadReconciliationService', () => {
  it('re-materializes every active serving-manifest source before marking loaded', async () => {
    const { service, prisma, qdrant } = createService();

    const result = await service.run('job-1', {
      mode: 'rebuild_collection',
      trigger: 'manual',
      triggerMetadata: { lifecycleAction: 'load_workspace' },
    } as any);

    expect(qdrant.createCollection).toHaveBeenCalledWith(
      'kb-kb-1',
      384,
      'Cosine',
      expect.any(Object),
      'backend-1',
    );
    const payloads = qdrant.upsertVectors.mock.calls.flatMap((call: any[]) => call[2]);
    expect(payloads.map((payload: any) => payload.sourceRevisionId)).toEqual([
      'rev-a',
      'rev-b',
      'rev-c',
    ]);
    expect(prisma.indexVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'idx-1' },
        data: expect.objectContaining({
          lifecycleStatus: 'loaded',
          resourceRequested: expect.objectContaining({ kind: 'requested' }),
          resourceAllocated: expect.objectContaining({ kind: 'allocated' }),
          resourceObserved: expect.objectContaining({
            kind: 'observed',
          }),
        }),
      }),
    );
    expect(prisma.workspaceVectorPlacement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'placement-1' },
        data: expect.objectContaining({ state: 'loaded' }),
      }),
    );
    expect(result.stats.sourceRevisionCount).toBe(3);
  });

  it('surfaces missing active source as source unavailable', async () => {
    const { service, prisma } = createService({
      activeSources: [{ id: 'source-a' }, { id: 'source-missing' }],
    });

    await expect(service.run('job-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'workspace_load_source_unavailable',
      }),
    });
    expect(prisma.indexingJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('surfaces offline backend as backend unavailable', async () => {
    const { service } = createService({ backendState: 'offline' });

    await expect(service.run('job-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'workspace_load_backend_unavailable',
      }),
    });
  });
});

function createService(options: {
  backendState?: string;
  activeSources?: Array<{ id: string }>;
} = {}) {
  const revisions = [
    { sourceId: 'source-a', sourceRevisionId: 'rev-a' },
    { sourceId: 'source-b', sourceRevisionId: 'rev-b' },
    { sourceId: 'source-c', sourceRevisionId: 'rev-c' },
  ];
  const chunks = revisions.map((revision, index) => ({
    id: `chunk-${index + 1}`,
    indexVersionId: 'idx-1',
    text: `chunk text ${index + 1}`,
    textHash: `hash-${index + 1}`,
    tokenCount: 3,
    chunkIndex: 0,
    startLine: null,
    endLine: null,
    metadata: {
      sourceRevisionId: revision.sourceRevisionId,
      path: `doc-${index + 1}.md`,
    },
    document: {
      id: `doc-${index + 1}`,
      status: 'active',
      sourceId: revision.sourceId,
    },
  }));
  const prisma: any = {
    $transaction: jest.fn().mockImplementation(async (callback) => callback(prisma)),
    indexingJob: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'job-1',
        knowledgeBaseId: 'kb-1',
      }),
      update: jest.fn().mockResolvedValue({ id: 'job-1' }),
    },
    indexVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'idx-1',
        status: 'active',
        vectorCollectionName: 'kb-kb-1',
        embeddingModel: 'model',
        embeddingDimension: 384,
        storageProfile: 'balanced',
        storageConfig: {},
      }),
      update: jest.fn().mockResolvedValue({ id: 'idx-1' }),
    },
    workspaceVectorPlacement: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'placement-1',
        vectorBackendId: 'backend-1',
        collectionAlias: 'workspace-kb-1',
        physicalCollectionName: 'kb-kb-1',
        activeIndexBuildId: 'build-1',
        vectorBackend: {
          id: 'backend-1',
          state: options.backendState || 'enabled',
        },
      }),
      update: jest.fn().mockResolvedValue({ id: 'placement-1' }),
    },
    workspaceServingRevision: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'serving-1',
        status: 'active',
        manifestEntries: revisions.map((revision, position) => ({
          sourceRevisionId: revision.sourceRevisionId,
          position,
          sourceRevision: {
            id: revision.sourceRevisionId,
            sourceId: revision.sourceId,
            documentCount: 1,
          },
        })),
      }),
    },
    source: {
      findMany: jest.fn().mockResolvedValue(
        options.activeSources || revisions.map((revision) => ({ id: revision.sourceId })),
      ),
    },
    chunk: {
      findMany: jest.fn().mockResolvedValue(chunks),
    },
  };
  const knowledgeBases = {
    resolveIdentifier: jest.fn().mockResolvedValue({
      id: 'kb-1',
      slug: 'kb-1',
      name: 'KB 1',
      activeIndexVersionId: 'idx-1',
      activeServingRevisionId: 'serving-1',
    }),
  };
  const embeddings = {
    resolveProvider: jest.fn().mockResolvedValue({
      source: 'env',
      model: 'model',
      dimension: 384,
    }),
    assertReady: jest.fn().mockResolvedValue(undefined),
    embedTexts: jest.fn().mockImplementation(async (texts: string[]) =>
      texts.map(() => [0.1, 0.2, 0.3]),
    ),
  };
  const qdrant = {
    collectionExists: jest.fn().mockResolvedValue(false),
    createCollection: jest.fn().mockResolvedValue(undefined),
    upsertVectors: jest.fn().mockResolvedValue(undefined),
    countBySourceRevisionId: jest.fn().mockImplementation(async (_collection, revisionId) =>
      chunks.filter((chunk) => chunk.metadata.sourceRevisionId === revisionId).length,
    ),
    countCollection: jest.fn().mockResolvedValue(chunks.length),
  };
  return {
    service: new WorkspaceLoadReconciliationService(
      prisma,
      knowledgeBases as any,
      embeddings as any,
      qdrant as any,
    ),
    prisma,
    qdrant,
  };
}
