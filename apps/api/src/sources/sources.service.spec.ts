import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SourceType } from './enums/source.enums';
import { SourcesService } from './sources.service';

describe('SourcesService', () => {
  const prisma = {
    source: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const knowledgeBasesService = {
    resolveReference: jest.fn(),
  };

  let service: SourcesService;

  beforeEach(() => {
    jest.clearAllMocks();
    knowledgeBasesService.resolveReference.mockResolvedValue({ id: 'kb-1', slug: 'career-rag' });
    service = new SourcesService(prisma as any, knowledgeBasesService as any);
  });

  it('creates a local folder source', async () => {
    prisma.source.create.mockResolvedValue({ id: 'source-1' });

    await service.create({
      knowledgeBaseSlug: 'career-rag',
      type: SourceType.LOCAL_FOLDER,
      uri: '/tmp/docs',
      includeRules: ['**/*.md'],
      excludeRules: ['node_modules/**'],
    });

    expect(prisma.source.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        type: SourceType.LOCAL_FOLDER,
        uri: '/tmp/docs',
        metadata: {
          sourceTruthPolicy: {
            truthMode: 'read_only',
            writePolicy: 'disabled',
          },
        },
      }),
    });
  });

  it('creates a git source with metadata references', async () => {
    prisma.source.create.mockResolvedValue({ id: 'source-2' });

    await service.create({
      knowledgeBaseId: 'kb-1',
      type: SourceType.GIT_REPO,
      uri: 'https://github.com/example/repo.git',
      git: {
        branch: 'main',
        commit: '0123abc',
        clonePath: '/tmp/git/repo',
        credentialsRef: 'github-prod-token',
      },
    });

    expect(prisma.source.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: SourceType.GIT_REPO,
        uri: 'https://github.com/example/repo.git',
        metadata: {
          sourceTruthPolicy: {
            truthMode: 'read_only',
            writePolicy: 'disabled',
          },
          branch: 'main',
          commit: '0123abc',
          clonePath: '/tmp/git/repo',
          credentialsRef: 'github-prod-token',
        },
      }),
    });
  });

  it('creates a managed upload source without exposing a server path as the URI', async () => {
    prisma.source.create.mockResolvedValue({ id: 'source-upload' });

    await service.createManagedUploadSource({
      knowledgeBaseId: 'kb-1',
      uploadId: 'upload-1',
      includeRules: ['**/*.md'],
      metadata: {
        managed: true,
        uploadId: 'upload-1',
        originalFileName: 'dataset.zip',
        archiveFormat: 'zip',
        storageRoot: '/var/lib/contextforge/uploads',
        originalPath: '/var/lib/contextforge/uploads/upload-1/original/dataset.zip',
        extractedPath: '/var/lib/contextforge/uploads/upload-1/extracted',
        sizeBytes: 128,
        fileCount: 2,
        contentBytes: 512,
        uploadedAt: '2026-05-28T12:00:00.000Z',
        cleanupStrategy: 'manual',
      },
    });

    expect(prisma.source.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        type: SourceType.UPLOAD,
        uri: 'upload://upload-1',
        includeRules: ['**/*.md'],
        excludeRules: [],
        status: 'active',
        metadata: expect.objectContaining({
          sourceTruthPolicy: {
            truthMode: 'read_only',
            writePolicy: 'disabled',
          },
          managed: true,
          uploadId: 'upload-1',
          extractedPath: '/var/lib/contextforge/uploads/upload-1/extracted',
        }),
      }),
    });
  });

  it('accepts a local filesystem path for git source URIs', async () => {
    prisma.source.create.mockResolvedValue({ id: 'source-3' });

    await service.create({
      knowledgeBaseId: 'kb-1',
      type: SourceType.GIT_REPO,
      uri: '../fixtures/repo',
      git: {
        branch: 'main',
      },
    });

    expect(prisma.source.create).toHaveBeenCalled();
  });

  it('creates a URL source with bounded crawl metadata', async () => {
    prisma.source.create.mockResolvedValue({ id: 'source-url' });

    await service.create({
      knowledgeBaseId: 'kb-1',
      type: SourceType.URL,
      uri: 'https://example.com/docs',
      url: {
        maxPages: 3,
        maxBytesPerPage: 65536,
        totalMaxBytes: 131072,
        timeoutMs: 2000,
        sameHost: true,
        respectRobots: false,
      },
    });

    expect(prisma.source.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: SourceType.URL,
        uri: 'https://example.com/docs',
        metadata: {
          sourceTruthPolicy: {
            truthMode: 'read_only',
            writePolicy: 'disabled',
          },
          maxPages: 3,
          maxBytesPerPage: 65536,
          totalMaxBytes: 131072,
          timeoutMs: 2000,
          sameHost: true,
          respectRobots: false,
        },
      }),
    });
  });

  it('creates an Obsidian vault source with read-only policy and default excludes', async () => {
    prisma.source.create.mockResolvedValue({ id: 'source-obsidian' });

    await service.create({
      knowledgeBaseId: 'kb-1',
      type: SourceType.OBSIDIAN_VAULT,
      uri: '/vaults/personal',
    });

    expect(prisma.source.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: SourceType.OBSIDIAN_VAULT,
        uri: '/vaults/personal',
        excludeRules: expect.arrayContaining([
          '**/.obsidian/**',
          '**/.trash/**',
          '**/*.png',
          '**/*.pdf',
        ]),
        metadata: expect.objectContaining({
          sourceTruthPolicy: {
            truthMode: 'read_only',
            writePolicy: 'disabled',
          },
          obsidian: expect.objectContaining({
            readOnly: true,
          }),
        }),
      }),
    });
  });

  it('allows watch sync policy for Obsidian vault sources', async () => {
    prisma.source.findUnique.mockResolvedValue({
      id: 'source-obsidian',
      type: SourceType.OBSIDIAN_VAULT,
      uri: '/vaults/personal',
      metadata: {},
    });
    prisma.source.update.mockResolvedValue({ id: 'source-obsidian' });

    await expect(
      service.update('source-obsidian', {
        syncPolicy: {
          triggerMode: 'watch',
          watchDebounceMs: 1000,
        },
      }),
    ).resolves.toEqual({ id: 'source-obsidian' });
  });

  it('rejects URL source schemes outside HTTP(S)', async () => {
    await expect(
      service.create({
        knowledgeBaseId: 'kb-1',
        type: SourceType.URL,
        uri: 'file:///etc/passwd',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid git repo URIs', async () => {
    await expect(
      service.create({
        knowledgeBaseId: 'kb-1',
        type: SourceType.GIT_REPO,
        uri: 'not a repo',
        git: { branch: 'main' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects raw git credentials', async () => {
    await expect(
      service.create({
        knowledgeBaseId: 'kb-1',
        type: SourceType.GIT_REPO,
        uri: 'git@github.com:example/repo.git',
        git: {
          branch: 'main',
          credentialsRef: 'ghp_secret123',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges URL crawl metadata on update', async () => {
    prisma.source.findUnique.mockResolvedValue({
      id: 'source-url',
      type: SourceType.URL,
      uri: 'https://example.com/docs',
      metadata: {
        maxPages: 3,
        sameHost: true,
      },
    });
    prisma.source.update.mockResolvedValue({ id: 'source-url' });

    await service.update('source-url', {
      url: {
        maxPages: 5,
        respectRobots: false,
      },
    });

    expect(prisma.source.update).toHaveBeenCalledWith({
      where: { id: 'source-url' },
      data: {
        uri: undefined,
        includeRules: undefined,
        excludeRules: undefined,
        status: undefined,
        metadata: {
          sourceTruthPolicy: {
            truthMode: 'read_only',
            writePolicy: 'disabled',
          },
          maxPages: 5,
          sameHost: true,
          respectRobots: false,
        },
      },
    });
  });

  it('rejects URL limits where total bytes are smaller than per-page bytes', async () => {
    await expect(
      service.create({
        knowledgeBaseId: 'kb-1',
        type: SourceType.URL,
        uri: 'https://example.com',
        url: {
          maxBytesPerPage: 4096,
          totalMaxBytes: 2048,
        },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges git metadata on update', async () => {
    prisma.source.findUnique.mockResolvedValue({
      id: 'source-2',
      type: SourceType.GIT_REPO,
      uri: 'https://github.com/example/repo.git',
      metadata: {
        branch: 'main',
        clonePath: '/tmp/git/repo',
      },
    });
    prisma.source.update.mockResolvedValue({ id: 'source-2' });

    await service.update('source-2', {
      git: {
        branch: 'develop',
        credentialsRef: 'github-rotated-ref',
      },
    });

    expect(prisma.source.update).toHaveBeenCalledWith({
      where: { id: 'source-2' },
      data: {
        uri: undefined,
        includeRules: undefined,
        excludeRules: undefined,
        status: undefined,
        metadata: {
          sourceTruthPolicy: {
            truthMode: 'read_only',
            writePolicy: 'disabled',
          },
          branch: 'develop',
          clonePath: '/tmp/git/repo',
          credentialsRef: 'github-rotated-ref',
        },
      },
    });
  });

  it('stores a source sync policy without dropping existing metadata', async () => {
    prisma.source.findUnique.mockResolvedValue({
      id: 'source-upload',
      type: SourceType.UPLOAD,
      uri: 'upload://upload-1',
      metadata: {
        managed: true,
        uploadId: 'upload-1',
      },
    });
    prisma.source.update.mockResolvedValue({ id: 'source-upload' });

    await service.update('source-upload', {
      syncPolicy: {
        triggerMode: 'schedule',
        schedule: '5m',
        mode: 'incremental',
        reason: 'nightly dataset refresh',
      },
    });

    expect(prisma.source.update).toHaveBeenCalledWith({
      where: { id: 'source-upload' },
      data: expect.objectContaining({
        metadata: {
          managed: true,
          uploadId: 'upload-1',
          syncPolicy: {
            triggerMode: 'schedule',
            enabled: true,
            schedule: '5m',
            watchDebounceMs: 5000,
            mode: 'incremental',
            reason: 'nightly dataset refresh',
          },
          sourceTruthPolicy: {
            truthMode: 'read_only',
            writePolicy: 'disabled',
          },
        },
      }),
    });
  });

  it('updates and reads source policy through workspace source policy helpers', async () => {
    (knowledgeBasesService as any).resolveIdentifier = jest
      .fn()
      .mockResolvedValue({ id: 'kb-1', slug: 'career-rag' });
    prisma.source.findFirst.mockResolvedValue({
      id: 'source-1',
      knowledgeBaseId: 'kb-1',
      type: SourceType.LOCAL_FOLDER,
      uri: '/tmp/docs',
      status: 'active',
      lastSyncedAt: new Date('2026-07-15T10:00:00.000Z'),
      metadata: {
        sourceTruthPolicy: {
          truthMode: 'read_only',
          writePolicy: 'disabled',
        },
      },
    });
    prisma.source.update.mockResolvedValue({
      id: 'source-1',
      knowledgeBaseId: 'kb-1',
      type: SourceType.LOCAL_FOLDER,
      uri: '/tmp/docs',
      status: 'active',
      lastSyncedAt: new Date('2026-07-15T10:00:00.000Z'),
      metadata: {
        sourceTruthPolicy: {
          truthMode: 'read_only',
          writePolicy: 'disabled',
          reason: 'external folder is source truth',
        },
        syncPolicy: {
          triggerMode: 'schedule',
          enabled: true,
          schedule: '5m',
          watchDebounceMs: 5000,
          mode: 'incremental',
        },
      },
    });

    await expect(
      service.updatePolicy('career-rag', 'source-1', {
        sourceTruthPolicy: {
          reason: 'external folder is source truth',
        },
        syncPolicy: {
          triggerMode: 'schedule',
          schedule: '5m',
        },
      }),
    ).resolves.toMatchObject({
      source: {
        id: 'source-1',
        knowledgeBaseId: 'kb-1',
      },
      sourceTruthPolicy: {
        truthMode: 'read_only',
        writePolicy: 'disabled',
        reason: 'external folder is source truth',
      },
      syncPolicy: {
        triggerMode: 'schedule',
        enabled: true,
        schedule: '5m',
        mode: 'incremental',
      },
      autoRefreshEnabled: true,
      nextTriggerAt: '2026-07-15T10:05:00.000Z',
    });

    expect(prisma.source.update).toHaveBeenCalledWith({
      where: { id: 'source-1' },
      data: {
        metadata: expect.objectContaining({
          sourceTruthPolicy: {
            truthMode: 'read_only',
            writePolicy: 'disabled',
            reason: 'external folder is source truth',
          },
          syncPolicy: expect.objectContaining({
            triggerMode: 'schedule',
            enabled: true,
            schedule: '5m',
          }),
        }),
      },
    });
  });

  it('rejects source truth write policy changes', async () => {
    (knowledgeBasesService as any).resolveIdentifier = jest
      .fn()
      .mockResolvedValue({ id: 'kb-1', slug: 'career-rag' });
    prisma.source.findFirst.mockResolvedValue({
      id: 'source-1',
      knowledgeBaseId: 'kb-1',
      type: SourceType.LOCAL_FOLDER,
      uri: '/tmp/docs',
      status: 'active',
      metadata: {},
    });

    await expect(
      service.updatePolicy('career-rag', 'source-1', {
        sourceTruthPolicy: {
          writePolicy: 'enabled' as any,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects watch sync policy for non-local sources', async () => {
    prisma.source.findUnique.mockResolvedValue({
      id: 'source-upload',
      type: SourceType.UPLOAD,
      uri: 'upload://upload-1',
      metadata: {},
    });

    await expect(
      service.update('source-upload', {
        syncPolicy: {
          triggerMode: 'watch',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws not found on update when source is missing', async () => {
    prisma.source.findUnique.mockResolvedValue(null);

    await expect(service.update('missing', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolves a knowledge base slug when listing sources', async () => {
    prisma.source.findMany.mockResolvedValue([]);

    await service.findAll(undefined, 'career-rag');

    expect(knowledgeBasesService.resolveReference).toHaveBeenCalledWith(undefined, 'career-rag');
    expect(prisma.source.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { knowledgeBaseId: 'kb-1' },
      }),
    );
  });

  it('reuses an existing matching source instead of creating a duplicate', async () => {
    prisma.source.findFirst.mockResolvedValue({
      id: 'source-existing',
      knowledgeBaseId: 'kb-1',
      type: SourceType.LOCAL_FOLDER,
      uri: '/tmp/docs',
      includeRules: ['**/*.md'],
      excludeRules: [],
      metadata: {},
      status: 'active',
    });

    await expect(
      service.createOrReuse({
        knowledgeBaseSlug: 'career-rag',
        type: SourceType.LOCAL_FOLDER,
        uri: ' /tmp/docs ',
        includeRules: ['**/*.md'],
      }),
    ).resolves.toEqual({
      source: expect.objectContaining({ id: 'source-existing' }),
      created: false,
    });

    expect(prisma.source.create).not.toHaveBeenCalled();
  });
});
