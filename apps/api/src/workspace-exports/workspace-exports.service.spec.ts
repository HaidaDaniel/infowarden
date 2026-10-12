import { WorkspaceExportsService } from './workspace-exports.service';

describe('WorkspaceExportsService', () => {
  const prisma = {
    knowledgeBase: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    source: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    retrievalProfile: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    indexVersion: {
      findMany: jest.fn(),
    },
    memoryEntry: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    sourceSnapshot: {
      findMany: jest.fn(),
    },
    validationReport: {
      findMany: jest.fn(),
    },
    document: {
      findMany: jest.fn(),
    },
    chunk: {
      groupBy: jest.fn(),
    },
  };

  const knowledgeBasesService = {
    resolveIdentifier: jest.fn(),
    create: jest.fn(),
  };

  const queueService = {
    enqueueIndexingJob: jest.fn(),
  };

  let service: WorkspaceExportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkspaceExportsService(
      prisma as any,
      knowledgeBasesService as any,
      queueService as any,
    );
    knowledgeBasesService.resolveIdentifier.mockResolvedValue({
      id: 'kb-1',
      slug: 'career-rag',
      name: 'Career RAG',
      description: 'Career context',
      workspaceKind: 'codebase',
      defaultIndexProfile: 'code-default',
      defaultRetrievalProfile: 'code-debug',
      activeIndexVersionId: 'idx-1',
      createdAt: new Date('2026-05-24T10:00:00.000Z'),
      updatedAt: new Date('2026-05-24T11:00:00.000Z'),
    });
    knowledgeBasesService.create.mockResolvedValue({
      id: 'kb-restored',
      slug: 'career-rag-restored',
      name: 'Career RAG Restored',
      description: 'Restored',
      workspaceKind: 'codebase',
      defaultIndexProfile: 'code-default',
      defaultRetrievalProfile: 'code-debug',
    });
    prisma.knowledgeBase.findFirst.mockResolvedValue(null);
    prisma.knowledgeBase.update.mockResolvedValue({
      id: 'kb-existing',
      slug: 'career-rag-existing',
      name: 'Career RAG Existing',
    });
    prisma.retrievalProfile.upsert.mockImplementation(({ create }) =>
      Promise.resolve({ id: 'profile-restored', ...create }),
    );
    prisma.memoryEntry.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'memory-restored', ...data }),
    );
    prisma.source.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `source-${data.type}`, ...data }),
    );
    queueService.enqueueIndexingJob.mockResolvedValue({ id: 'job-1' });
  });

  it('builds a portable workspace export manifest without raw secrets', async () => {
    prisma.source.findMany.mockResolvedValue([
      {
        id: 'src-1',
        type: 'git_repo',
        uri: 'https://user:token@github.com/example/project.git',
        includeRules: ['**/*.ts'],
        excludeRules: ['node_modules/**'],
        status: 'active',
        lastSyncedAt: new Date('2026-05-24T10:30:00.000Z'),
        createdAt: new Date('2026-05-24T10:00:00.000Z'),
        updatedAt: new Date('2026-05-24T10:30:00.000Z'),
        metadata: {
          branch: 'main',
          credentialsRef: 'ssh-key-prod',
          nested: {
            apiToken: 'hidden',
          },
        },
      },
    ]);
    prisma.retrievalProfile.findMany.mockResolvedValue([
      {
        id: 'profile-1',
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
        metadata: {},
        createdAt: new Date('2026-05-24T10:00:00.000Z'),
        updatedAt: new Date('2026-05-24T10:00:00.000Z'),
      },
    ]);
    prisma.indexVersion.findMany.mockResolvedValue([
      {
        id: 'idx-1',
        datasetVersionId: 'dataset-1',
        embeddingModel: 'qwen3-embedding-4b',
        embeddingDimension: 2560,
        chunkingConfig: { strategy: 'fixed_char' },
        vectorCollectionName: 'kb-kb-1',
        materializationMode: 'mutable_collection',
        status: 'active',
        createdAt: new Date('2026-05-24T10:30:00.000Z'),
      },
    ]);
    prisma.memoryEntry.findMany.mockResolvedValue([
      {
        id: 'mem-1',
        entryType: 'decision',
        title: 'Use HTTP MCP',
        body: 'Remote agents need an HTTP transport.',
        summary: 'HTTP MCP',
        tags: ['mcp'],
        authoredBy: 'codex',
        sessionId: 'session-1',
        sourceRefs: [],
        occurredAt: null,
        metadata: {},
        createdAt: new Date('2026-05-24T10:40:00.000Z'),
        updatedAt: new Date('2026-05-24T10:40:00.000Z'),
      },
    ]);
    prisma.sourceSnapshot.findMany.mockResolvedValue([]);
    prisma.validationReport.findMany.mockResolvedValue([]);
    prisma.document.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        sourceId: 'src-1',
        path: 'src/index.ts',
        mimeType: 'text/typescript',
        contentHash: 'hash',
        status: 'active',
        metadata: { path: 'src/index.ts' },
        createdAt: new Date('2026-05-24T10:30:00.000Z'),
        updatedAt: new Date('2026-05-24T10:30:00.000Z'),
      },
    ]);
    prisma.chunk.groupBy.mockResolvedValue([
      {
        documentId: 'doc-1',
        _count: { _all: 3 },
      },
    ]);

    const manifest = await service.buildManifest('career-rag');

    expect(manifest).toMatchObject({
      formatVersion: 'workspace-export-manifest.v1',
      workspace: {
        id: 'kb-1',
        slug: 'career-rag',
        kind: 'codebase',
      },
      counts: {
        sources: 1,
        retrievalProfiles: 1,
        memoryEntries: 1,
        documents: 1,
        chunks: 3,
        indexVersions: 1,
      },
      restorePlan: {
        requiresReindexForSearch: true,
      },
    });
    expect(manifest.sources[0].metadata).toEqual({
      branch: 'main',
      credentialsRef: '[redacted]',
      nested: {
        apiToken: '[redacted]',
      },
    });
    expect(manifest.sources[0].uri).toBe('https://github.com/example/project.git');
    expect(manifest.restorePlan.sourceWarnings[0].uri).toBe(
      'https://github.com/example/project.git',
    );
    expect(manifest.indexVersions[0]).toMatchObject({
      id: 'idx-1',
      isActive: true,
    });
  });

  it('validates required source remaps without mutating state', async () => {
    const manifest = createManifest({
      sources: [
        {
          id: 'src-local',
          type: 'local_folder',
          uri: '/old/path',
          includeRules: [],
          excludeRules: [],
          metadata: {},
        },
        {
          id: 'src-git',
          type: 'git_repo',
          uri: 'https://github.com/example/project.git',
          includeRules: [],
          excludeRules: [],
          metadata: {
            branch: 'main',
            credentialsRef: '[redacted]',
          },
        },
      ],
    });

    await expect(service.validateImport({ manifest })).resolves.toMatchObject({
      valid: false,
      requiredRemaps: [
        {
          sourceId: 'src-local',
          required: ['uri'],
        },
        {
          sourceId: 'src-git',
          required: ['credentialsRef'],
        },
      ],
      errors: [
        expect.objectContaining({ code: 'restore_source_remap_required' }),
        expect.objectContaining({ code: 'restore_source_remap_required' }),
      ],
    });

    expect(knowledgeBasesService.create).not.toHaveBeenCalled();
    expect(prisma.source.create).not.toHaveBeenCalled();
    expect(queueService.enqueueIndexingJob).not.toHaveBeenCalled();
  });

  it('applies a conservative restore and enqueues reindex jobs', async () => {
    const manifest = createManifest({
      sources: [
        {
          id: 'src-local',
          type: 'local_folder',
          uri: '/old/path',
          includeRules: ['**/*.md'],
          excludeRules: ['tmp/**'],
          metadata: {
            syncPolicy: {
              triggerMode: 'manual',
              webhookSecretRef: '[redacted]',
            },
          },
        },
        {
          id: 'src-url',
          type: 'url',
          uri: 'https://example.com/docs',
          includeRules: [],
          excludeRules: [],
          metadata: {},
        },
      ],
      retrievalProfiles: [
        {
          id: 'profile-1',
          key: 'docs-qa',
          name: 'Docs QA',
          intent: 'docs',
          denseTopK: 8,
          scoreThreshold: null,
          neighborBefore: 1,
          neighborAfter: 1,
          tokenBudget: 1200,
          grouping: 'document',
          recencyBoost: false,
          metadata: {},
        },
      ],
      memoryEntries: [
        {
          id: 'mem-1',
          entryType: 'decision',
          title: 'Keep restore conservative',
          body: 'Vectors must be rebuilt.',
          summary: null,
          tags: ['restore'],
          authoredBy: 'codex',
          sessionId: null,
          sourceRefs: [],
          occurredAt: null,
          metadata: {},
        },
      ],
      indexVersions: [{ id: 'idx-1' }],
    });

    await expect(
      service.applyImport({
        manifest,
        targetWorkspace: {
          slug: 'career-rag-restored',
          name: 'Career RAG Restored',
        },
        sourceRemaps: [
          {
            sourceId: 'src-local',
            uri: '/new/path',
          },
        ],
      }),
    ).resolves.toMatchObject({
      applied: true,
      workspace: {
        id: 'kb-restored',
        slug: 'career-rag-restored',
        created: true,
      },
      restored: {
        retrievalProfiles: 1,
        memoryEntries: 1,
        sources: 2,
      },
      reindexJobs: [
        expect.objectContaining({ originalSourceId: 'src-local', jobId: 'job-1' }),
        expect.objectContaining({ originalSourceId: 'src-url', jobId: 'job-1' }),
      ],
    });

    expect(knowledgeBasesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'career-rag-restored',
        workspaceKind: 'codebase',
      }),
    );
    expect(prisma.retrievalProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          knowledgeBaseId_key: {
            knowledgeBaseId: 'kb-restored',
            key: 'docs-qa',
          },
        },
      }),
    );
    expect(prisma.memoryEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          knowledgeBaseId: 'kb-restored',
          entryType: 'decision',
          metadata: expect.objectContaining({
            restore: expect.objectContaining({ memoryEntryId: 'mem-1' }),
          }),
        }),
      }),
    );
    expect(prisma.source.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'local_folder',
          uri: '/new/path',
          metadata: expect.objectContaining({
            restore: expect.objectContaining({
              originalSourceId: 'src-local',
              originalUri: '/old/path',
            }),
          }),
        }),
      }),
    );
    expect(prisma.source.create.mock.calls[0][0].data.metadata.syncPolicy).toEqual({
      triggerMode: 'manual',
    });
    expect(queueService.enqueueIndexingJob).toHaveBeenCalledTimes(2);
    expect(queueService.enqueueIndexingJob).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-restored',
        type: 'scan_source',
        refresh: expect.objectContaining({
          mode: 'rebuild_collection',
          reason: 'workspace restore apply',
        }),
      }),
    );
  });

  it('refuses to apply invalid manifests', async () => {
    const manifest = createManifest({
      sources: [
        {
          id: 'src-local',
          type: 'local_folder',
          uri: '/old/path',
          includeRules: [],
          excludeRules: [],
          metadata: {},
        },
      ],
    });

    await expect(
      service.applyImport({
        manifest,
        targetWorkspace: { slug: 'restore-target' },
      }),
    ).rejects.toThrow('Workspace restore manifest validation failed');

    expect(knowledgeBasesService.create).not.toHaveBeenCalled();
  });
});

function createManifest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    formatVersion: 'workspace-export-manifest.v1',
    workspace: {
      id: 'kb-1',
      slug: 'career-rag',
      name: 'Career RAG',
      description: 'Career context',
      kind: 'codebase',
      defaultIndexProfile: 'code-default',
      defaultRetrievalProfile: 'code-debug',
    },
    sources: [],
    retrievalProfiles: [],
    memoryEntries: [],
    indexVersions: [],
    ...overrides,
  };
}
