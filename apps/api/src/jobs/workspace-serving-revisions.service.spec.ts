import {
  IndexBuildStatus,
  SourceRevisionStatus,
  WorkspaceServingRevisionStatus,
  WorkspaceServingState,
} from '@prisma/client';
import { WorkspaceServingRevisionsService } from './workspace-serving-revisions.service';

describe('WorkspaceServingRevisionsService', () => {
  it('hashes canonical manifests independently of object key and source order', () => {
    const service = new WorkspaceServingRevisionsService({} as any);
    const first = service.computeManifestHash({
      knowledgeBaseId: 'kb-1',
      sources: [
        { sourceId: 'source-b', sourceRevisionId: 'revision-b' },
        { sourceId: 'source-a', sourceRevisionId: 'revision-a' },
      ],
      missingSourceIds: ['source-d', 'source-c'],
      embeddingProfileSnapshot: { model: 'embed', dimension: 384 },
      chunkingProfileSnapshot: { maxChars: 3000, strategy: 'fixed_char' },
      payloadSchemaVersion: 'payload-v1',
    });
    const second = service.computeManifestHash({
      knowledgeBaseId: 'kb-1',
      sources: [
        { sourceId: 'source-a', sourceRevisionId: 'revision-a' },
        { sourceId: 'source-b', sourceRevisionId: 'revision-b' },
      ],
      missingSourceIds: ['source-c', 'source-d'],
      embeddingProfileSnapshot: { dimension: 384, model: 'embed' },
      chunkingProfileSnapshot: { strategy: 'fixed_char', maxChars: 3000 },
      payloadSchemaVersion: 'payload-v1',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('prepares a complete ordered manifest from current and ready source revisions', async () => {
    const prisma = preparePrisma({
      activeSources: ['source-a', 'source-b'],
      readyRevisions: [readyRevision('revision-a', 'source-a')],
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    const result = await service.prepareBuild(prepareInput());

    expect(result).toMatchObject({
      sourceRevisionId: 'revision-b',
      workspaceServingRevisionId: 'serving-1',
      indexBuildId: 'build-1',
      missingSourceIds: [],
    });
    expect(prisma.workspaceServingRevision.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          metadata: expect.objectContaining({ complete: true, missingSourceIds: [] }),
          manifestEntries: {
            create: [
              { sourceRevisionId: 'revision-a', position: 0 },
              { sourceRevisionId: 'revision-b', position: 1 },
            ],
          },
        }),
      }),
    );
  });

  it('records missing active sources without inventing revisions', async () => {
    const prisma = preparePrisma({
      activeSources: ['source-a', 'source-b'],
      readyRevisions: [],
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    const result = await service.prepareBuild(prepareInput());

    expect(result.missingSourceIds).toEqual(['source-a']);
    expect(prisma.workspaceServingRevision.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          metadata: expect.objectContaining({
            complete: false,
            missingSourceIds: ['source-a'],
          }),
        }),
      }),
    );
  });

  it('uses the active manifest instead of an unactivated ready revision', async () => {
    const prisma = preparePrisma({
      activeSources: ['source-a', 'source-b'],
      readyRevisions: [readyRevision('revision-a-unactivated', 'source-a')],
      activeManifestRevisions: [readyRevision('revision-a-active', 'source-a')],
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await service.prepareBuild(prepareInput());

    expect(prisma.workspaceServingRevision.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          manifestEntries: {
            create: [
              { sourceRevisionId: 'revision-a-active', position: 0 },
              { sourceRevisionId: 'revision-b', position: 1 },
            ],
          },
        }),
      }),
    );
  });

  it('replaces only refreshed B in a complete three-source manifest', async () => {
    const prisma = preparePrisma({
      activeSources: ['source-a', 'source-b', 'source-c'],
      readyRevisions: [],
      activeManifestRevisions: [
        readyRevision('revision-a1', 'source-a'),
        readyRevision('revision-b1', 'source-b'),
        readyRevision('revision-c1', 'source-c'),
      ],
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await service.prepareBuild(prepareInput());

    expect(prisma.workspaceServingRevision.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          manifestEntries: {
            create: [
              { sourceRevisionId: 'revision-a1', position: 0 },
              { sourceRevisionId: 'revision-b', position: 1 },
              { sourceRevisionId: 'revision-c1', position: 2 },
            ],
          },
        }),
      }),
    );
  });

  it('activates only a complete ready manifest and archives the previous serving state', async () => {
    const prisma = activationPrisma({
      activeSources: ['source-a', 'source-b'],
      entries: [
        manifestEntry(0, readyRevision('revision-a', 'source-a')),
        manifestEntry(1, {
          ...readyRevision('revision-b', 'source-b'),
          status: SourceRevisionStatus.building,
        }),
      ],
      activeServingRevisionId: 'serving-old',
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await expect(service.finalizeBuild(finalizeInput())).resolves.toEqual({
      activated: true,
      state: WorkspaceServingState.active,
      missingSourceIds: [],
      unexpectedSourceIds: [],
      supersededSourceRevisionIds: [],
    });
    expect(prisma.workspaceServingRevision.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'serving-old',
        status: WorkspaceServingRevisionStatus.active,
      },
      data: { status: WorkspaceServingRevisionStatus.archived },
    });
    expect(prisma.workspaceServingRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'serving-1' },
        data: expect.objectContaining({ status: WorkspaceServingRevisionStatus.active }),
      }),
    );
    expect(prisma.indexBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: IndexBuildStatus.active }),
      }),
    );
    expect(prisma.knowledgeBase.updateMany).toHaveBeenCalledWith({
      where: { id: 'kb-1', activeServingRevisionId: 'serving-old' },
      data: {
        activeServingRevisionId: 'serving-1',
        activeIndexVersionId: 'index-1',
        servingRevisionState: WorkspaceServingState.active,
      },
    });
    expect(prisma.workspaceVectorPlacement.update).toHaveBeenCalledWith({
      where: { knowledgeBaseId: 'kb-1' },
      data: {
        servingRevisionId: 'serving-1',
        activeIndexBuildId: 'build-1',
        physicalCollectionName: 'kb-kb-1',
        state: 'loaded',
      },
    });
  });

  it('reports the superseded source revision for deferred cleanup', async () => {
    const prisma = activationPrisma({
      activeSources: ['source-a', 'source-b', 'source-c'],
      entries: [
        manifestEntry(0, readyRevision('revision-a1', 'source-a')),
        manifestEntry(1, { ...readyRevision('revision-b2', 'source-b'), status: SourceRevisionStatus.building }),
        manifestEntry(2, readyRevision('revision-c1', 'source-c')),
      ],
      activeServingRevisionId: 'serving-old',
    });
    prisma.sourceRevision.findUnique.mockResolvedValue({
      id: 'revision-b2',
      knowledgeBaseId: 'kb-1',
      status: SourceRevisionStatus.building,
    });
    prisma.indexBuild.findUnique.mockResolvedValue({
      id: 'build-1',
      knowledgeBaseId: 'kb-1',
      workspaceServingRevisionId: 'serving-1',
      sourceRevisionId: 'revision-b2',
      status: IndexBuildStatus.building,
    });
    prisma.workspaceServingRevision.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === 'serving-old') {
        return Promise.resolve({
          manifestEntries: [
            manifestEntry(0, readyRevision('revision-a1', 'source-a')),
            manifestEntry(1, readyRevision('revision-b1', 'source-b')),
            manifestEntry(2, readyRevision('revision-c1', 'source-c')),
          ],
        });
      }
      return Promise.resolve({
        id: 'serving-1',
        knowledgeBaseId: 'kb-1',
        manifestHash: 'manifest-hash',
        status: WorkspaceServingRevisionStatus.building,
        metadata: {},
        manifestEntries: [
          manifestEntry(0, readyRevision('revision-a1', 'source-a')),
          manifestEntry(1, { ...readyRevision('revision-b2', 'source-b'), status: SourceRevisionStatus.building }),
          manifestEntry(2, readyRevision('revision-c1', 'source-c')),
        ],
      });
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await expect(service.finalizeBuild({ ...finalizeInput(), sourceRevisionId: 'revision-b2' })).resolves.toMatchObject(
      { activated: true, supersededSourceRevisionIds: ['revision-b1'] },
    );
  });

  it('keeps placement activation inside the cutover transaction', async () => {
    const prisma = activationPrisma({
      activeSources: ['source-a', 'source-b'],
      entries: [
        manifestEntry(0, readyRevision('revision-a', 'source-a')),
        manifestEntry(1, {
          ...readyRevision('revision-b', 'source-b'),
          status: SourceRevisionStatus.building,
        }),
      ],
      activeServingRevisionId: 'serving-old',
    });
    let inTransaction = false;
    prisma.$transaction = jest.fn().mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      inTransaction = true;
      try {
        return await callback(prisma);
      } finally {
        inTransaction = false;
      }
    });
    prisma.workspaceVectorPlacement.update.mockImplementation(() => {
      expect(inTransaction).toBe(true);
      throw new Error('placement activation unavailable');
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await expect(service.finalizeBuild(finalizeInput())).rejects.toThrow('placement activation unavailable');
    expect(prisma.knowledgeBase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activeServingRevisionId: 'serving-1' }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('marks an incomplete manifest for reconciliation and never activates it', async () => {
    const prisma = activationPrisma({
      activeSources: ['source-a', 'source-b'],
      entries: [
        manifestEntry(0, {
          ...readyRevision('revision-b', 'source-b'),
          status: SourceRevisionStatus.building,
        }),
      ],
      activeServingRevisionId: null,
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await expect(service.finalizeBuild(finalizeInput())).resolves.toEqual({
      activated: false,
      state: WorkspaceServingState.reconciliation_required,
      missingSourceIds: ['source-a'],
      unexpectedSourceIds: [],
      supersededSourceRevisionIds: [],
    });
    expect(prisma.workspaceServingRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WorkspaceServingRevisionStatus.reconciliation_required,
        }),
      }),
    );
    expect(prisma.knowledgeBase.update).toHaveBeenCalledWith({
      where: { id: 'kb-1' },
      data: {
        servingRevisionState: WorkspaceServingState.reconciliation_required,
      },
    });
  });

  it('keeps an existing active manifest when a candidate is incomplete', async () => {
    const prisma = activationPrisma({
      activeSources: ['source-a', 'source-b'],
      entries: [
        manifestEntry(0, {
          ...readyRevision('revision-b', 'source-b'),
          status: SourceRevisionStatus.building,
        }),
      ],
      activeServingRevisionId: 'serving-old',
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await expect(service.finalizeBuild(finalizeInput())).resolves.toEqual({
      activated: false,
      state: WorkspaceServingState.reconciliation_required,
      missingSourceIds: ['source-a'],
      unexpectedSourceIds: [],
      supersededSourceRevisionIds: [],
    });
    expect(prisma.knowledgeBase.update).toHaveBeenCalledWith({
      where: { id: 'kb-1' },
      data: {
        servingRevisionState: WorkspaceServingState.reconciliation_required,
      },
    });
    expect(prisma.knowledgeBase.updateMany).not.toHaveBeenCalled();
    expect(prisma.workspaceServingRevision.updateMany).not.toHaveBeenCalled();
  });

  it('rejects activation of a failed serving revision', async () => {
    const prisma = activationPrisma({
      activeSources: ['source-b'],
      entries: [
        manifestEntry(0, {
          ...readyRevision('revision-b', 'source-b'),
          status: SourceRevisionStatus.building,
        }),
      ],
      activeServingRevisionId: null,
    });
    prisma.workspaceServingRevision.findUnique.mockResolvedValue({
      id: 'serving-1',
      knowledgeBaseId: 'kb-1',
      manifestHash: 'manifest-hash',
      status: WorkspaceServingRevisionStatus.failed,
      metadata: {},
      manifestEntries: [
        manifestEntry(0, {
          ...readyRevision('revision-b', 'source-b'),
          status: SourceRevisionStatus.building,
        }),
      ],
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await expect(service.finalizeBuild(finalizeInput())).rejects.toThrow(
      'Workspace serving revision is not eligible for activation',
    );
    expect(prisma.knowledgeBase.update).not.toHaveBeenCalled();
  });

  it('rejects activation when deterministic validation failed', async () => {
    const prisma = activationPrisma({
      activeSources: ['source-b'],
      entries: [
        manifestEntry(0, {
          ...readyRevision('revision-b', 'source-b'),
          status: SourceRevisionStatus.building,
        }),
      ],
      activeServingRevisionId: null,
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await expect(
      service.finalizeBuild({
        ...finalizeInput(),
        validationSummary: { status: 'failed' },
      }),
    ).rejects.toThrow('Index build validation did not pass');
    expect(prisma.sourceRevision.update).not.toHaveBeenCalled();
    expect(prisma.knowledgeBase.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a concurrent serving-pointer change', async () => {
    const prisma = activationPrisma({
      activeSources: ['source-b'],
      entries: [
        manifestEntry(0, {
          ...readyRevision('revision-b', 'source-b'),
          status: SourceRevisionStatus.building,
        }),
      ],
      activeServingRevisionId: null,
    });
    prisma.knowledgeBase.updateMany.mockResolvedValue({ count: 0 });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await expect(service.finalizeBuild(finalizeInput())).rejects.toThrow(
      'Workspace serving revision changed during activation',
    );
  });

  it('fails a candidate build without replacing an existing active manifest', async () => {
    const prisma = activationPrisma({
      activeSources: ['source-b'],
      entries: [],
      activeServingRevisionId: 'serving-old',
    });
    const service = new WorkspaceServingRevisionsService(prisma as any);

    await service.failBuild({
      ...finalizeInput(),
      reason: 'vector validation failed',
    });

    expect(prisma.indexBuild.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: IndexBuildStatus.failed }),
      }),
    );
    expect(prisma.sourceRevision.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SourceRevisionStatus.failed }),
      }),
    );
    expect(prisma.workspaceServingRevision.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: WorkspaceServingRevisionStatus.failed },
      }),
    );
    expect(prisma.knowledgeBase.update).not.toHaveBeenCalled();
  });
});

function prepareInput() {
  return {
    knowledgeBaseId: 'kb-1',
    sourceId: 'source-b',
    sourceSnapshotId: 'snapshot-b',
    sourceContentHash: 'content-b',
    documentCount: 2,
    indexVersionId: 'index-1',
    physicalCollectionName: 'kb-kb-1',
    storageProfile: 'balanced',
    embeddingProfileSnapshot: { model: 'embed', dimension: 384 },
    chunkingProfileSnapshot: { strategy: 'fixed_char', maxChars: 3000 },
  };
}

function finalizeInput() {
  return {
    knowledgeBaseId: 'kb-1',
    sourceRevisionId: 'revision-b',
    workspaceServingRevisionId: 'serving-1',
    indexBuildId: 'build-1',
    manifestHash: 'manifest-hash',
    physicalCollectionName: 'kb-kb-1',
    missingSourceIds: [],
    validationSummary: { status: 'passed' },
    resourceObserved: { vectors: 4 },
  };
}

function readyRevision(
  id: string,
  sourceId: string,
): {
  id: string;
  sourceId: string;
  status: SourceRevisionStatus;
  createdAt: Date;
} {
  return {
    id,
    sourceId,
    status: SourceRevisionStatus.ready,
    createdAt: new Date('2026-07-18T00:00:00.000Z'),
  };
}

function manifestEntry(position: number, sourceRevision: ReturnType<typeof readyRevision>) {
  return {
    position,
    sourceRevision,
  };
}

function preparePrisma(options: {
  activeSources: string[];
  readyRevisions: Array<ReturnType<typeof readyRevision>>;
  activeManifestRevisions?: Array<ReturnType<typeof readyRevision>>;
}) {
  const prisma: Record<string, any> = {
    sourceRevision: {
      upsert: jest.fn().mockResolvedValue({
        ...readyRevision('revision-b', 'source-b'),
        status: SourceRevisionStatus.building,
      }),
      findMany: jest.fn().mockResolvedValue(options.readyRevisions),
    },
    source: {
      findMany: jest.fn().mockResolvedValue(options.activeSources.map((id) => ({ id }))),
    },
    knowledgeBase: {
      findUnique: jest.fn().mockResolvedValue({
        activeServingRevision: options.activeManifestRevisions
          ? {
              manifestEntries: options.activeManifestRevisions.map((sourceRevision) => ({
                sourceRevision,
              })),
            }
          : null,
      }),
    },
    workspaceServingRevision: {
      upsert: jest.fn().mockResolvedValue({ id: 'serving-1' }),
    },
    indexBuild: {
      upsert: jest.fn().mockResolvedValue({ id: 'build-1' }),
    },
  };
  prisma.$transaction = jest.fn().mockImplementation((callback) => callback(prisma));
  return prisma;
}

function activationPrisma(options: {
  activeSources: string[];
  entries: Array<ReturnType<typeof manifestEntry>>;
  activeServingRevisionId: string | null;
}) {
  const prisma: Record<string, any> = {
    sourceRevision: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'revision-b',
        knowledgeBaseId: 'kb-1',
        status: SourceRevisionStatus.building,
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    source: {
      findMany: jest.fn().mockResolvedValue(options.activeSources.map((id) => ({ id }))),
    },
    workspaceServingRevision: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'serving-1',
        knowledgeBaseId: 'kb-1',
        manifestHash: 'manifest-hash',
        status: WorkspaceServingRevisionStatus.building,
        metadata: {},
        manifestEntries: options.entries,
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    indexBuild: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'build-1',
        knowledgeBaseId: 'kb-1',
        workspaceServingRevisionId: 'serving-1',
        sourceRevisionId: 'revision-b',
        indexVersionId: 'index-1',
        status: IndexBuildStatus.building,
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    knowledgeBase: {
      findUnique: jest.fn().mockResolvedValue({
        activeServingRevisionId: options.activeServingRevisionId,
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workspaceVectorPlacement: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
  prisma.$transaction = jest.fn().mockImplementation((callback) => callback(prisma));
  return prisma;
}
