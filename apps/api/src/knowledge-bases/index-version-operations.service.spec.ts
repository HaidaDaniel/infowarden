import { IndexVersionStatus } from '@prisma/client';
import { AppException } from '../common/app-error';
import { IndexVersionOperationsService } from './index-version-operations.service';

describe('IndexVersionOperationsService', () => {
  it('returns compare read models for two index versions', async () => {
    const { service, prisma } = createService();

    await expect(service.compare('career-rag', 'idx-base', 'idx-target')).resolves.toMatchObject({
      workspace: {
        id: 'kb-1',
        slug: 'career-rag',
        activeIndexVersionId: 'idx-target',
      },
      base: {
        id: 'idx-base',
        isActive: false,
        provider: {
          embeddingModel: 'model-a',
          embeddingDimension: 384,
        },
        chunks: {
          versionedCount: 3,
          liveCount: 0,
          tokenCount: 90,
        },
      },
      target: {
        id: 'idx-target',
        isActive: true,
        provider: {
          embeddingModel: 'model-b',
          embeddingDimension: 768,
        },
        chunks: {
          versionedCount: 5,
          liveCount: 5,
          tokenCount: 150,
        },
      },
      comparison: {
        documentCountDelta: 2,
        chunkVersionCountDelta: 2,
        liveChunkCountDelta: 5,
        tokenCountDelta: 60,
        embeddingModelChanged: true,
        embeddingDimensionChanged: true,
        chunkingConfigChanged: true,
        sourceSnapshotRefs: {
          added: ['source-1:git_commit:commit-b'],
          removed: ['source-1:git_commit:commit-a'],
          unchanged: [],
        },
        rollback: {
          safe: false,
          code: 'index_rollback_target_already_active',
        },
      },
    });

    expect(prisma.indexVersion.findFirst).toHaveBeenCalledTimes(2);
  });

  it('blocks rollback for mutable collection targets', async () => {
    const { service, prisma, qdrantAdapter } = createService({
      targetOverrides: {
        id: 'idx-base',
        materializationMode: 'mutable_collection',
        status: IndexVersionStatus.active,
      },
      activeIndexVersionId: 'idx-target',
    });

    await expect(service.rollback('career-rag', 'idx-base')).rejects.toBeInstanceOf(AppException);

    expect(qdrantAdapter.collectionExists).not.toHaveBeenCalled();
    expect(prisma.knowledgeBase.update).not.toHaveBeenCalled();
  });

  it('applies rollback for immutable collection targets when the collection exists', async () => {
    const { service, prisma, qdrantAdapter } = createService({
      targetOverrides: {
        id: 'idx-base',
        materializationMode: 'immutable_collection',
        status: IndexVersionStatus.archived,
        vectorCollectionName: 'kb-kb-1-idx-base',
      },
      activeIndexVersionId: 'idx-target',
      collectionExists: true,
    });

    await expect(service.rollback('career-rag', 'idx-base')).resolves.toMatchObject({
      applied: true,
      workspace: {
        id: 'kb-1',
        previousActiveIndexVersionId: 'idx-target',
        activeIndexVersionId: 'idx-base',
      },
      targetIndexVersion: {
        id: 'idx-base',
        vectorCollectionName: 'kb-kb-1-idx-base',
        materializationMode: 'immutable_collection',
      },
    });

    expect(qdrantAdapter.collectionExists).toHaveBeenCalledWith('kb-kb-1-idx-base');
    expect(prisma.indexVersion.update).toHaveBeenCalledWith({
      where: { id: 'idx-target' },
      data: { status: IndexVersionStatus.archived },
    });
    expect(prisma.indexVersion.update).toHaveBeenCalledWith({
      where: { id: 'idx-base' },
      data: { status: IndexVersionStatus.active },
    });
    expect(prisma.knowledgeBase.update).toHaveBeenCalledWith({
      where: { id: 'kb-1' },
      data: { activeIndexVersionId: 'idx-base' },
    });
  });

  it('blocks immutable rollback when the vector collection is missing', async () => {
    const { service, prisma, qdrantAdapter } = createService({
      targetOverrides: {
        id: 'idx-base',
        materializationMode: 'immutable_collection',
        status: IndexVersionStatus.archived,
        vectorCollectionName: 'kb-kb-1-idx-base',
      },
      activeIndexVersionId: 'idx-target',
      collectionExists: false,
    });

    await expect(service.rollback('career-rag', 'idx-base')).rejects.toBeInstanceOf(AppException);

    expect(qdrantAdapter.collectionExists).toHaveBeenCalledWith('kb-kb-1-idx-base');
    expect(prisma.knowledgeBase.update).not.toHaveBeenCalled();
  });
});

function createService(options: {
  activeIndexVersionId?: string;
  targetOverrides?: Record<string, unknown>;
  collectionExists?: boolean;
} = {}) {
  const workspace = {
    id: 'kb-1',
    slug: 'career-rag',
    name: 'Career RAG',
    activeIndexVersionId: options.activeIndexVersionId || 'idx-target',
  };
  const base = indexVersion({
    id: 'idx-base',
    datasetVersionId: 'dataset-base',
    embeddingModel: 'model-a',
    embeddingDimension: 384,
    chunkingConfig: { strategy: 'fixed_char', maxChars: 1000 },
    vectorCollectionName: 'kb-kb-1',
    materializationMode: 'mutable_collection',
    status: IndexVersionStatus.active,
    documentCount: 3,
    contentHash: 'hash-base',
    snapshotRef: 'commit-a',
  });
  const target = indexVersion({
    id: 'idx-target',
    datasetVersionId: 'dataset-target',
    embeddingModel: 'model-b',
    embeddingDimension: 768,
    chunkingConfig: { strategy: 'fixed_char', maxChars: 2000 },
    vectorCollectionName: 'kb-kb-1',
    materializationMode: 'mutable_collection',
    status: IndexVersionStatus.active,
    documentCount: 5,
    contentHash: 'hash-target',
    snapshotRef: 'commit-b',
    ...options.targetOverrides,
  });
  const byId = new Map([
    [base.id, base],
    [target.id, target],
  ]);

  const prisma = {
    indexVersion: {
      findFirst: jest.fn(({ where }) => Promise.resolve(byId.get(where.id) || null)),
      update: jest.fn().mockResolvedValue({}),
    },
    chunkVersion: {
      groupBy: jest.fn(({ _count }) => {
        if (_count) {
          return Promise.resolve([
            { indexVersionId: 'idx-base', _count: { _all: 3 } },
            { indexVersionId: 'idx-target', _count: { _all: 5 } },
          ]);
        }
        return Promise.resolve([
          { indexVersionId: 'idx-base', _sum: { tokenCount: 90 } },
          { indexVersionId: 'idx-target', _sum: { tokenCount: 150 } },
        ]);
      }),
    },
    chunk: {
      groupBy: jest.fn(({ _count }) => {
        if (_count) {
          return Promise.resolve([{ indexVersionId: 'idx-target', _count: { _all: 5 } }]);
        }
        return Promise.resolve([{ indexVersionId: 'idx-target', _sum: { tokenCount: 150 } }]);
      }),
    },
    knowledgeBase: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const knowledgeBasesService = {
    resolveIdentifier: jest.fn().mockResolvedValue(workspace),
  };
  const qdrantAdapter = {
    collectionExists: jest.fn().mockResolvedValue(options.collectionExists ?? true),
  };

  return {
    service: new IndexVersionOperationsService(
      prisma as any,
      knowledgeBasesService as any,
      qdrantAdapter as any,
    ),
    prisma,
    qdrantAdapter,
  };
}

function indexVersion(input: {
  id: string;
  datasetVersionId: string;
  embeddingModel: string;
  embeddingDimension: number;
  chunkingConfig: Record<string, unknown>;
  vectorCollectionName: string;
  materializationMode: string;
  status: IndexVersionStatus;
  documentCount: number;
  contentHash: string;
  snapshotRef: string;
}) {
  return {
    id: input.id,
    knowledgeBaseId: 'kb-1',
    datasetVersionId: input.datasetVersionId,
    embeddingModel: input.embeddingModel,
    embeddingDimension: input.embeddingDimension,
    chunkingConfig: input.chunkingConfig,
    vectorCollectionName: input.vectorCollectionName,
    materializationMode: input.materializationMode,
    status: input.status,
    createdAt: new Date('2026-05-31T00:00:00.000Z'),
    datasetVersion: {
      id: input.datasetVersionId,
      documentCount: input.documentCount,
      contentHash: input.contentHash,
      status: 'ready',
      createdAt: new Date('2026-05-31T00:00:00.000Z'),
      sourceSnapshots: [
        {
          id: `snapshot-${input.id}`,
          sourceId: 'source-1',
          snapshotType: 'git_commit',
          ref: input.snapshotRef,
          fileCount: input.documentCount,
          contentBytes: input.documentCount * 100,
          createdAt: new Date('2026-05-31T00:00:00.000Z'),
        },
      ],
    },
    validationReports: [
      {
        id: `validation-${input.id}`,
        level: 'deterministic',
        status: 'passed',
        summary: { chunkCount: input.documentCount },
        issues: [],
        createdAt: new Date('2026-05-31T00:00:00.000Z'),
      },
    ],
  };
}
