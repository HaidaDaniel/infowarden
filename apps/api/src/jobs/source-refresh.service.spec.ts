import { IndexingJobType, SourceStatus, SourceType, WorkspaceKind } from '@prisma/client';
import { AppException } from '../common/app-error';
import { SourceRefreshService } from './source-refresh.service';

describe('SourceRefreshService', () => {
  it('enqueues an incremental refresh for a workspace source', async () => {
    const { service, queueService } = createService();

    await expect(
      service.refresh('career-rag', 'source-1', { reason: 'after commit' }),
    ).resolves.toEqual({
      dryRun: false,
      mode: 'incremental',
      reason: 'after commit',
      workspace: {
        id: 'kb-1',
        slug: 'career-rag',
        name: 'Career RAG',
        workspaceKind: WorkspaceKind.general,
      },
      source: {
        id: 'source-1',
        type: SourceType.local_folder,
        uri: '/tmp/career',
        status: SourceStatus.active,
      },
      job: { id: 'job-1' },
    });

    expect(queueService.enqueueIndexingJob).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      sourceId: 'source-1',
      type: IndexingJobType.scan_source,
      refresh: {
        mode: 'incremental',
        reason: 'after commit',
        dryRun: false,
        trigger: 'manual',
      },
    });
  });

  it('returns a dry-run change plan without enqueueing', async () => {
    const { service, queueService, sourcePreparation, changePlanner } = createService({
      planStats: {
        filesParsed: 2,
        filesIgnored: 0,
        parseFailures: 0,
        added: 1,
        changed: 1,
        unchanged: 0,
        deleted: 1,
        documentsDeleted: 1,
        documentsSkipped: 0,
        dependencyCandidates: 0,
      },
    });

    await expect(
      service.refresh('career-rag', 'source-1', { mode: 'force_reembed', dryRun: true }),
    ).resolves.toMatchObject({
      dryRun: true,
      mode: 'force_reembed',
      plan: {
        stats: {
          added: 1,
          changed: 1,
          deleted: 1,
        },
        addedPaths: ['new.md'],
        changedPaths: ['changed.md'],
        deletedPaths: ['old.md'],
      },
    });

    expect(sourcePreparation.prepare).toHaveBeenCalled();
    expect(changePlanner.buildPlan).toHaveBeenCalled();
    expect(queueService.enqueueIndexingJob).not.toHaveBeenCalled();
  });

  it('allows URL sources to be refreshed', async () => {
    const { service, queueService } = createService({
      source: {
        id: 'source-1',
        knowledgeBaseId: 'kb-1',
        type: SourceType.url,
        uri: 'https://example.com',
        status: SourceStatus.active,
        includeRules: [],
        excludeRules: [],
        metadata: {},
      },
    });

    await expect(service.refresh('career-rag', 'source-1', {})).resolves.toMatchObject({
      dryRun: false,
      source: {
        id: 'source-1',
        type: SourceType.url,
      },
      job: { id: 'job-1' },
    });
    expect(queueService.enqueueIndexingJob).toHaveBeenCalled();
  });

  it('allows managed upload sources to be refreshed', async () => {
    const { service, queueService } = createService({
      source: {
        id: 'source-upload',
        knowledgeBaseId: 'kb-1',
        type: SourceType.upload,
        uri: 'upload://upload-1',
        status: SourceStatus.active,
        includeRules: [],
        excludeRules: [],
        metadata: {
          uploadId: 'upload-1',
          extractedPath: '/var/lib/contextforge/uploads/upload-1/extracted',
        },
      },
    });

    await expect(
      service.refresh('career-rag', 'source-upload', { mode: 'force_rechunk' }),
    ).resolves.toMatchObject({
      dryRun: false,
      mode: 'force_rechunk',
      source: {
        id: 'source-upload',
        type: SourceType.upload,
        uri: 'upload://upload-1',
      },
    });
    expect(queueService.enqueueIndexingJob).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'source-upload',
        refresh: expect.objectContaining({ mode: 'force_rechunk' }),
      }),
    );
  });

  it('allows Obsidian vault sources to be refreshed', async () => {
    const { service, queueService } = createService({
      source: {
        id: 'source-obsidian',
        knowledgeBaseId: 'kb-1',
        type: SourceType.obsidian_vault,
        uri: '/vaults/personal',
        status: SourceStatus.active,
        includeRules: ['**/*.md'],
        excludeRules: ['**/.obsidian/**'],
        metadata: {
          sourceTruthPolicy: {
            truthMode: 'read_only',
            writePolicy: 'disabled',
          },
        },
      },
    });

    await expect(
      service.refresh('career-rag', 'source-obsidian', { mode: 'incremental' }),
    ).resolves.toMatchObject({
      dryRun: false,
      source: {
        id: 'source-obsidian',
        type: SourceType.obsidian_vault,
      },
    });
    expect(queueService.enqueueIndexingJob).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'source-obsidian',
      }),
    );
  });

  it('rejects sources outside the requested workspace', async () => {
    const { service, prisma } = createService({ source: null });

    await expect(service.refresh('career-rag', 'missing-source', {})).rejects.toBeInstanceOf(
      AppException,
    );
    expect(prisma.source.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'missing-source',
        knowledgeBaseId: 'kb-1',
      },
    });
  });
});

function createService(options: {
  source?: any;
  planStats?: Record<string, number>;
} = {}) {
  const knowledgeBase = {
    id: 'kb-1',
    slug: 'career-rag',
    name: 'Career RAG',
    workspaceKind: WorkspaceKind.general,
  };
  const source =
    options.source === null
      ? null
      : options.source || {
          id: 'source-1',
          knowledgeBaseId: 'kb-1',
          type: SourceType.local_folder,
          uri: '/tmp/career',
          status: SourceStatus.active,
          includeRules: [],
          excludeRules: [],
          metadata: {},
        };
  const prisma = {
    source: {
      findFirst: jest.fn().mockResolvedValue(source),
    },
    document: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const knowledgeBasesService = {
    resolveIdentifier: jest.fn().mockResolvedValue(knowledgeBase),
  };
  const queueService = {
    enqueueIndexingJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const sourcePreparation = {
    prepare: jest.fn().mockResolvedValue({
      scanRoot: '/tmp/career',
      files: [],
    }),
  };
  const stats =
    options.planStats || {
      filesParsed: 0,
      filesIgnored: 0,
      parseFailures: 0,
      added: 0,
      changed: 0,
      unchanged: 0,
      deleted: 0,
      documentsDeleted: 0,
      documentsSkipped: 0,
      dependencyCandidates: 0,
    };
  const changePlanner = {
    buildPlan: jest.fn().mockReturnValue({
      stats,
      validationIssues: [],
      plan: {
        parsedFiles: [
          {
            changeType: 'added',
            file: { relativePath: 'new.md' },
          },
          {
            changeType: 'changed',
            file: { relativePath: 'changed.md' },
          },
        ],
        deletedDocuments: [{ path: 'old.md' }],
        dependencyHints: [],
      },
    }),
  };

  return {
    service: new SourceRefreshService(
      prisma as any,
      knowledgeBasesService as any,
      queueService as any,
      sourcePreparation as any,
      changePlanner as any,
    ),
    prisma,
    queueService,
    sourcePreparation,
    changePlanner,
  };
}
