import { VectorBackendState, WorkspaceVectorPlacementMode, WorkspaceVectorPlacementState } from '@prisma/client';
import { WorkspaceVectorPlacementService } from './workspace-vector-placement.service';
import { VectorBackendSelector } from './vector-backend-selector.service';
import { VectorMaterializationValidator } from './vector-materialization-validator.service';

describe('WorkspaceVectorPlacementService', () => {
  it('keeps an existing healthy placement stable', async () => {
    const { service, prisma } = createService();
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(placement());

    await expect(service.resolveForKnowledgeBase('kb-1')).resolves.toMatchObject({
      vectorBackendId: 'backend-a',
    });
    expect(prisma.vectorBackend.findMany).not.toHaveBeenCalled();
  });

  it('chooses capacity-assisted backend deterministically with build headroom', async () => {
    const { service, prisma } = createService();
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(null);
    prisma.knowledgeBase.findUnique
      .mockResolvedValueOnce({
        id: 'kb-1',
        slug: 'docs',
        activeServingRevisionId: null,
        activeIndexVersionId: 'index-1',
      })
      .mockResolvedValueOnce({ activeIndexVersionId: 'index-1' });
    prisma.vectorBackend.findMany.mockResolvedValue([
      backend('backend-b', 'node-b', {
        diskBytes: 1000,
        ramBytes: 1000,
        maxWorkspaces: 2,
      }),
      backend('backend-a', 'node-a', {
        diskBytes: 1000,
        ramBytes: 1000,
        maxWorkspaces: 2,
      }),
    ]);
    prisma.workspaceVectorPlacement.findMany.mockResolvedValue([]);
    prisma.indexVersion.findUnique.mockResolvedValue({
      id: 'index-1',
      resourceEstimate: { qdrantDiskBytesHigh: 100, estimatedRamBytes: 100 },
      lifecycleStatus: 'unloaded',
      vectorCollectionName: 'kb-kb-1',
    });
    prisma.workspaceVectorPlacement.create.mockImplementation(async ({ data }) => ({
      id: 'placement-1',
      ...data,
      vectorBackend: backend(data.vectorBackendId, data.vectorBackendId, {}),
    }));

    const result = await service.resolveForKnowledgeBase('kb-1');

    expect(result.vectorBackendId).toBe('backend-a');
    expect(prisma.workspaceVectorPlacement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: WorkspaceVectorPlacementMode.capacity_assisted,
          capacitySnapshot: expect.objectContaining({
            candidateBuildMultiplier: 2,
          }),
        }),
      }),
    );
  });

  it('rejects capacity selection for unhealthy or insufficient backends', async () => {
    const { service, prisma } = createService();
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(null);
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1',
      slug: 'docs',
      activeServingRevisionId: null,
    });
    prisma.vectorBackend.findMany.mockResolvedValue([
      backend('offline', 'offline', { diskBytes: 1000, ramBytes: 1000, maxWorkspaces: 1 }, VectorBackendState.offline),
      backend('small', 'small', {
        diskBytes: 200,
        ramBytes: 200,
        maxWorkspaces: 1,
      }),
    ]);
    prisma.workspaceVectorPlacement.findMany.mockResolvedValue([]);
    prisma.knowledgeBase.findUnique
      .mockResolvedValueOnce({
        id: 'kb-1',
        slug: 'docs',
        activeServingRevisionId: null,
      })
      .mockResolvedValueOnce({ activeIndexVersionId: 'index-1' });
    prisma.indexVersion.findUnique.mockResolvedValue({
      resourceEstimate: { qdrantDiskBytesHigh: 100, estimatedRamBytes: 100 },
    });

    await expect(service.resolveForKnowledgeBase('kb-1')).rejects.toMatchObject({
      code: 'workspace_vector_backend_capacity_unavailable',
    });
  });

  it('refuses pinning a loaded workspace to a different backend before migration exists', async () => {
    const { service, prisma, knowledgeBases } = createService();
    knowledgeBases.resolveIdentifier.mockResolvedValue({
      id: 'kb-1',
      slug: 'docs',
    });
    prisma.vectorBackend.findUnique.mockResolvedValue(
      backend('backend-b', 'node-b', {
        diskBytes: 1000,
        ramBytes: 1000,
        maxWorkspaces: 2,
      }),
    );
    prisma.workspaceVectorPlacement.findMany.mockResolvedValue([]);
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      activeIndexVersionId: null,
    });
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(
      placement({ state: WorkspaceVectorPlacementState.loaded }),
    );

    await expect(service.pin('docs', 'backend-b')).rejects.toMatchObject({
      code: 'workspace_vector_backend_move_requires_migration',
    });
  });

  it('keeps the active placement untouched when a candidate copy fails', async () => {
    const { service, prisma, qdrant } = createService();
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(operation());
    prisma.indexVersion.findFirst.mockResolvedValue({
      embeddingDimension: 3,
      storageProfile: 'balanced',
    });
    qdrant.collectionExists.mockResolvedValue(true);
    qdrant.copyCollectionPoints.mockRejectedValue(new Error('target unavailable'));
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => data);

    await expect(service.executeCompatibleCopy('operation-1')).rejects.toThrow('target unavailable');

    expect(prisma.workspaceVectorPlacement.update).not.toHaveBeenCalled();
    expect(prisma.vectorMaterializationOperation.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'failed' }) }),
    );
  });

  it('records retryable build failures without marking the operation terminal', async () => {
    const { service, prisma, qdrant } = createService();
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(operation());
    prisma.indexVersion.findFirst.mockResolvedValue({
      embeddingDimension: 3,
      storageProfile: 'balanced',
    });
    qdrant.collectionExists.mockResolvedValue(true);
    qdrant.copyCollectionPoints.mockRejectedValue(new Error('target unavailable'));
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => data);

    await expect(service.executeCompatibleCopy('operation-1', { finalizeFailures: false })).rejects.toThrow(
      'target unavailable',
    );

    expect(prisma.workspaceVectorPlacement.update).not.toHaveBeenCalled();
    expect(prisma.vectorMaterializationOperation.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ state: 'failed' }),
      }),
    );
    expect(prisma.indexBuild.update).not.toHaveBeenCalled();
  });

  it('validates compatible transfer against every serving-manifest revision', async () => {
    const { service, prisma, qdrant } = createService();
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(operation());
    prisma.indexVersion.findFirst.mockResolvedValue({
      embeddingDimension: 3,
      storageProfile: 'balanced',
    });
    prisma.workspaceServingRevision.findUnique.mockResolvedValue({
      manifestEntries: [{ sourceRevisionId: 'revision-a' }, { sourceRevisionId: 'revision-b' }],
    });
    qdrant.collectionExists.mockResolvedValue(true);
    qdrant.copyCollectionPoints.mockResolvedValue(2);
    qdrant.countCollection.mockResolvedValue(2);
    qdrant.countBySourceRevisionId.mockResolvedValue(1);
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => data);

    await expect(service.executeCompatibleCopy('operation-1')).resolves.toMatchObject({
      state: 'ready_for_cutover',
      validationSummary: expect.objectContaining({
        revisionCoverage: [
          expect.objectContaining({ sourceRevisionId: 'revision-a', targetPoints: 1 }),
          expect.objectContaining({ sourceRevisionId: 'revision-b', targetPoints: 1 }),
        ],
      }),
    });
  });

  it('runs labeled semantic probes against the candidate collection before validation', async () => {
    const { service, prisma, qdrant, embeddings } = createService();
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(operation());
    prisma.indexVersion.findFirst.mockResolvedValue({
      id: 'index-1',
      embeddingModel: 'model-a',
      embeddingDimension: 3,
      storageProfile: 'balanced',
    });
    prisma.workspaceServingRevision.findUnique.mockResolvedValue({
      manifestEntries: [{ sourceRevisionId: 'revision-a' }],
    });
    prisma.evalQuestion.findMany.mockResolvedValue([
      {
        id: 'question-1',
        text: 'Where is the local marker?',
        expectedDocumentIds: ['document-chunk-a'],
        expectedChunkIds: ['chunk-a'],
      },
    ]);
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1',
      activeIndexVersionId: 'index-1',
    });
    embeddings.resolveProvider.mockResolvedValue({
      model: 'model-a',
      dimension: 3,
    });
    embeddings.embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);
    qdrant.collectionExists.mockResolvedValue(true);
    qdrant.copyCollectionPoints.mockResolvedValue(1);
    qdrant.countCollection.mockResolvedValue(1);
    qdrant.countBySourceRevisionId.mockResolvedValue(1);
    qdrant.search.mockResolvedValue([
      {
        payload: {
          documentId: 'document-chunk-a',
          chunkId: 'chunk-a',
          indexVersionId: 'index-1',
          metadata: { path: 'local-guide.md' },
        },
      },
    ]);
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => data);

    await expect(service.executeCompatibleCopy('operation-1')).resolves.toMatchObject({
      state: 'ready_for_cutover',
      validationSummary: expect.objectContaining({
        semanticProbes: expect.objectContaining({
          checked: 1,
          passed: true,
        }),
      }),
    });

    expect(qdrant.search).toHaveBeenCalledWith(
      'candidate-collection',
      [0.1, 0.2, 0.3],
      5,
      undefined,
      { sourceRevisionIds: ['revision-a'] },
      'backend-a',
    );
  });

  it('fails validation when candidate semantic probes miss labeled results', async () => {
    const { service, prisma, qdrant, embeddings } = createService();
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(operation());
    prisma.indexVersion.findFirst.mockResolvedValue({
      id: 'index-1',
      embeddingModel: 'model-a',
      embeddingDimension: 3,
      storageProfile: 'balanced',
    });
    prisma.workspaceServingRevision.findUnique.mockResolvedValue({
      manifestEntries: [{ sourceRevisionId: 'revision-a' }],
    });
    prisma.evalQuestion.findMany.mockResolvedValue([
      {
        id: 'question-1',
        text: 'Where is the local marker?',
        expectedDocumentIds: ['document-expected'],
        expectedChunkIds: ['chunk-expected'],
      },
    ]);
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1',
      activeIndexVersionId: 'index-1',
    });
    embeddings.resolveProvider.mockResolvedValue({
      model: 'model-a',
      dimension: 3,
    });
    embeddings.embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);
    qdrant.collectionExists.mockResolvedValue(true);
    qdrant.copyCollectionPoints.mockResolvedValue(1);
    qdrant.countCollection.mockResolvedValue(1);
    qdrant.countBySourceRevisionId.mockResolvedValue(1);
    qdrant.search.mockResolvedValue([]);
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => data);

    await expect(service.executeCompatibleCopy('operation-1')).rejects.toMatchObject({
      code: 'vector_operation_semantic_probe_failed',
    });

    expect(prisma.workspaceVectorPlacement.update).not.toHaveBeenCalled();
    expect(prisma.vectorMaterializationOperation.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'failed',
          errorSummary: expect.objectContaining({
            code: 'vector_operation_semantic_probe_failed',
            stage: 'vector_operation_semantic_probe',
          }),
        }),
      }),
    );
  });

  it('canonical rebuild re-embeds every active serving-manifest revision into a candidate collection', async () => {
    const { service, prisma, qdrant, embeddings } = createService();
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(
      operation({ strategy: 'canonical_reembed', progressCheckpoint: {} }),
    );
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(
      placement({
        physicalCollectionName: 'source-collection',
        servingRevisionId: 'serving-1',
        activeIndexBuildId: undefined,
      }),
    );
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1',
      defaultIndexProfile: 'default',
      activeIndexVersionId: 'index-1',
    });
    prisma.indexVersion.findUnique.mockResolvedValue({
      id: 'index-1',
      status: 'active',
      embeddingModel: 'model-a',
      embeddingDimension: 3,
      storageProfile: 'balanced',
    });
    prisma.workspaceServingRevision.findUnique.mockResolvedValue({
      id: 'serving-1',
      status: 'active',
      payloadSchemaVersion: 'qdrant-chunk-payload-v2',
      manifestEntries: [
        {
          sourceRevisionId: 'revision-a',
          sourceRevision: { sourceId: 'source-a', documentCount: 1 },
        },
        {
          sourceRevisionId: 'revision-b',
          sourceRevision: { sourceId: 'source-b', documentCount: 1 },
        },
      ],
    });
    prisma.indexBuild.create.mockResolvedValue({ id: 'build-candidate' });
    prisma.chunk.count.mockResolvedValue(1);
    prisma.chunk.findMany
      .mockResolvedValueOnce([chunk('chunk-a', 'source-a')])
      .mockResolvedValueOnce([chunk('chunk-b', 'source-b')]);
    embeddings.resolveProvider.mockResolvedValue({
      source: 'environment',
      name: 'local',
      baseUrl: 'http://embedding',
      model: 'model-a',
      dimension: 3,
      timeoutMs: 30_000,
      protocol: 'openai_compatible',
    });
    embeddings.embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);
    qdrant.collectionExists.mockResolvedValue(false);
    qdrant.countBySourceRevisionId.mockResolvedValue(1);
    qdrant.countCollection.mockResolvedValue(2);
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => data);

    await expect(service.executeOperationBuild('operation-1', 'canonical_reembed')).resolves.toMatchObject({
      state: 'ready_for_cutover',
      validationSummary: expect.objectContaining({
        transfer: 'canonical_reembed',
        expectedTotal: 2,
      }),
    });

    expect(qdrant.createCollection).toHaveBeenCalledWith(
      'candidate-collection',
      3,
      'Cosine',
      expect.any(Object),
      'backend-a',
    );
    expect(qdrant.upsertVectors).toHaveBeenCalledTimes(2);
    expect(prisma.workspaceVectorPlacement.update).not.toHaveBeenCalled();
  });

  it('recreates a stale canonical candidate collection before retry without progress', async () => {
    const { service, prisma, qdrant, embeddings } = createService();
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(
      operation({
        attemptCount: 2,
        progressCheckpoint: { queuedAt: '2026-07-19T00:00:00.000Z' },
      }),
    );
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(
      placement({
        physicalCollectionName: 'source-collection',
        servingRevisionId: 'serving-1',
        activeIndexBuildId: undefined,
      }),
    );
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1',
      defaultIndexProfile: 'default',
      activeIndexVersionId: 'index-1',
    });
    prisma.indexVersion.findUnique.mockResolvedValue({
      id: 'index-1',
      status: 'active',
      embeddingModel: 'model-a',
      embeddingDimension: 3,
      storageProfile: 'balanced',
    });
    prisma.workspaceServingRevision.findUnique.mockResolvedValue({
      id: 'serving-1',
      status: 'active',
      payloadSchemaVersion: 'qdrant-chunk-payload-v2',
      manifestEntries: [
        {
          sourceRevisionId: 'revision-a',
          sourceRevision: { sourceId: 'source-a', documentCount: 1 },
        },
      ],
    });
    prisma.indexBuild.create.mockResolvedValue({ id: 'build-candidate' });
    prisma.chunk.count.mockResolvedValue(1);
    prisma.chunk.findMany.mockResolvedValue([chunk('chunk-a', 'source-a')]);
    embeddings.resolveProvider.mockResolvedValue({
      source: 'environment',
      name: 'local',
      baseUrl: 'http://embedding',
      model: 'model-a',
      dimension: 3,
      timeoutMs: 30_000,
      protocol: 'openai_compatible',
    });
    embeddings.embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);
    qdrant.collectionExists.mockResolvedValue(true);
    qdrant.countBySourceRevisionId.mockResolvedValue(1);
    qdrant.countCollection.mockResolvedValue(1);
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => data);

    await expect(service.executeOperationBuild('operation-1', 'canonical_reembed')).resolves.toMatchObject({
      state: 'ready_for_cutover',
    });

    expect(qdrant.deleteCollection).toHaveBeenCalledWith('candidate-collection', 'backend-a');
    expect(qdrant.createCollection).toHaveBeenCalledWith(
      'candidate-collection',
      3,
      'Cosine',
      expect.any(Object),
      'backend-a',
    );
    expect(qdrant.upsertVectors).toHaveBeenCalledTimes(1);
  });

  it('restarts a canonical candidate after retryable Qdrant failure with partial progress', async () => {
    const { service, prisma, qdrant, embeddings } = createService();
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(
      operation({
        attemptCount: 3,
        progressCheckpoint: {
          phase: 'canonical_reembed',
          revisionIndex: 0,
          chunkOffset: 3,
          vectorsUpserted: 3,
        },
        errorSummary: {
          code: 'vector_upsert_failed',
          stage: 'qdrant_upsert_vectors',
        },
      }),
    );
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(
      placement({
        physicalCollectionName: 'source-collection',
        servingRevisionId: 'serving-1',
        activeIndexBuildId: undefined,
      }),
    );
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1',
      defaultIndexProfile: 'default',
      activeIndexVersionId: 'index-1',
    });
    prisma.indexVersion.findUnique.mockResolvedValue({
      id: 'index-1',
      status: 'active',
      embeddingModel: 'model-a',
      embeddingDimension: 3,
      storageProfile: 'balanced',
    });
    prisma.workspaceServingRevision.findUnique.mockResolvedValue({
      id: 'serving-1',
      status: 'active',
      payloadSchemaVersion: 'qdrant-chunk-payload-v2',
      manifestEntries: [
        {
          sourceRevisionId: 'revision-a',
          sourceRevision: { sourceId: 'source-a', documentCount: 1 },
        },
      ],
    });
    prisma.indexBuild.create.mockResolvedValue({ id: 'build-candidate' });
    prisma.chunk.count.mockResolvedValue(1);
    prisma.chunk.findMany.mockResolvedValue([chunk('chunk-a', 'source-a')]);
    embeddings.resolveProvider.mockResolvedValue({
      source: 'environment',
      name: 'local',
      baseUrl: 'http://embedding',
      model: 'model-a',
      dimension: 3,
      timeoutMs: 30_000,
      protocol: 'openai_compatible',
    });
    embeddings.embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);
    qdrant.collectionExists.mockResolvedValue(true);
    qdrant.countBySourceRevisionId.mockResolvedValue(1);
    qdrant.countCollection.mockResolvedValue(1);
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => data);

    await expect(service.executeOperationBuild('operation-1', 'canonical_reembed')).resolves.toMatchObject({
      state: 'ready_for_cutover',
    });

    expect(qdrant.deleteCollection).toHaveBeenCalledWith('candidate-collection', 'backend-a');
    expect(qdrant.upsertVectors).toHaveBeenCalledTimes(1);
    expect(prisma.vectorMaterializationOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          progressCheckpoint: expect.objectContaining({
            resetAfterFailure: true,
            revisionIndex: 0,
            chunkOffset: 0,
            vectorsUpserted: 0,
          }),
        }),
      }),
    );
  });

  it('changes cross-backend placement only after validation', async () => {
    const { service, prisma, qdrant } = createService();
    const candidate = operation({ targetVectorBackendId: 'backend-b', state: 'ready_for_cutover' });
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(candidate);
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(
      placement({
        physicalCollectionName: 'source-collection',
      }),
    );
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => ({ ...candidate, ...data }));

    await service.cutoverOperation('operation-1');

    expect(qdrant.switchCollectionAlias).not.toHaveBeenCalled();
    expect(prisma.workspaceVectorPlacement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vectorBackendId: 'backend-b',
          physicalCollectionName: 'candidate-collection',
        }),
      }),
    );
  });

  it('switches a stable Qdrant alias before same-backend placement cutover', async () => {
    const { service, prisma, qdrant } = createService();
    const candidate = operation({ state: 'ready_for_cutover' });
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(candidate);
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(
      placement({
        physicalCollectionName: 'source-collection',
        collectionAlias: 'workspace-docs',
      }),
    );
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => ({ ...candidate, ...data }));

    await service.cutoverOperation('operation-1');

    expect(qdrant.switchCollectionAlias).toHaveBeenCalledWith('workspace-docs', 'candidate-collection', 'backend-a');
  });

  it('restores the stable alias before same-backend rollback', async () => {
    const { service, prisma, qdrant } = createService();
    const cutOver = operation({ state: 'cutover_complete' });
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(cutOver);
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(
      placement({
        physicalCollectionName: 'candidate-collection',
        collectionAlias: 'workspace-docs',
      }),
    );
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => ({ ...cutOver, ...data }));

    await service.rollbackOperation('operation-1');

    expect(qdrant.switchCollectionAlias).toHaveBeenCalledWith('workspace-docs', 'source-collection', 'backend-a');
    expect(prisma.workspaceVectorPlacement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ physicalCollectionName: 'source-collection' }),
      }),
    );
  });

  it('never cleans the active collection and records successful cleanup', async () => {
    const { service, prisma, qdrant } = createService();
    const pending = operation({
      state: 'cleanup_pending',
      cleanupAfter: new Date(Date.now() - 1_000),
    });
    prisma.vectorMaterializationOperation.findUnique.mockResolvedValue(pending);
    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(
      placement({
        physicalCollectionName: 'candidate-collection',
        vectorBackendId: 'backend-a',
      }),
    );
    prisma.vectorMaterializationOperation.update.mockImplementation(async ({ data }) => ({ ...pending, ...data }));

    await expect(service.executeOperationCleanup('operation-1')).resolves.toMatchObject({
      state: 'cleanup_complete',
    });
    expect(qdrant.deleteCollection).toHaveBeenCalledWith('source-collection', 'backend-a');

    prisma.workspaceVectorPlacement.findUnique.mockResolvedValue(
      placement({
        physicalCollectionName: 'source-collection',
        vectorBackendId: 'backend-a',
      }),
    );
    await expect(service.executeOperationCleanup('operation-1')).rejects.toMatchObject({
      code: 'vector_operation_cleanup_active_collection',
    });
  });
});

function createService() {
  const prisma: Record<string, any> = {
    workspaceVectorPlacement: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    knowledgeBase: { findUnique: jest.fn(), findMany: jest.fn() },
    vectorBackend: { findUnique: jest.fn(), findMany: jest.fn() },
    indexVersion: { findUnique: jest.fn(), findFirst: jest.fn() },
    workspaceServingRevision: { findUnique: jest.fn() },
    chunk: { count: jest.fn(), findMany: jest.fn() },
    indexBuild: { create: jest.fn(), update: jest.fn() },
    evalQuestion: { findMany: jest.fn().mockResolvedValue([]) },
    vectorMaterializationOperation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (callback) => callback(prisma)),
  };
  const knowledgeBases = { resolveIdentifier: jest.fn() };
  const vectorBackends = { ensureDefaultBackend: jest.fn() };
  const qdrant = {
    collectionExists: jest.fn(),
    createCollection: jest.fn(),
    copyCollectionPoints: jest.fn(),
    countCollection: jest.fn(),
    countBySourceRevisionId: jest.fn(),
    search: jest.fn(),
    upsertVectors: jest.fn(),
    switchCollectionAlias: jest.fn(),
    deleteCollection: jest.fn(),
  };
  const embeddings = {
    resolveProvider: jest.fn(),
    assertReady: jest.fn(),
    embedTexts: jest.fn(),
  };
  return {
    service: new WorkspaceVectorPlacementService(
      prisma as any,
      knowledgeBases as any,
      vectorBackends as any,
      qdrant as any,
      embeddings as any,
      new VectorBackendSelector(prisma as any),
      new VectorMaterializationValidator(prisma as any, qdrant as any, embeddings as any),
    ),
    prisma,
    knowledgeBases,
    qdrant,
    embeddings,
  };
}

function backend(
  id: string,
  name: string,
  capacityHints: Record<string, unknown>,
  state: VectorBackendState = VectorBackendState.enabled,
) {
  return {
    id,
    name,
    baseUrl: `http://${name}:6333`,
    state,
    capacityHints,
    healthMetadata: { healthy: true, compatible: true },
  };
}

function placement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'placement-1',
    knowledgeBaseId: 'kb-1',
    vectorBackendId: 'backend-a',
    state: WorkspaceVectorPlacementState.loaded,
    mode: WorkspaceVectorPlacementMode.capacity_assisted,
    vectorBackend: backend('backend-a', 'node-a', {}),
    ...overrides,
  };
}

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'operation-1',
    knowledgeBaseId: 'kb-1',
    kind: 'full_rebuild',
    state: 'planned',
    sourceVectorBackendId: 'backend-a',
    targetVectorBackendId: 'backend-a',
    sourceCollectionName: 'source-collection',
    targetCollectionName: 'candidate-collection',
    servingRevisionId: 'serving-1',
    cleanupAfter: null,
    rollbackUntil: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function chunk(id: string, sourceId: string) {
  return {
    id,
    documentId: `document-${id}`,
    indexVersionId: 'index-1',
    text: `text for ${id}`,
    textHash: `hash-${id}`,
    tokenCount: 4,
    chunkIndex: 0,
    startLine: null,
    endLine: null,
    metadata: {},
    document: {
      id: `document-${id}`,
      sourceId,
    },
  };
}
