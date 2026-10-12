import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KnowledgeBasesService } from './knowledge-bases.service';

describe('KnowledgeBasesService', () => {
  const prisma = {
    knowledgeBase: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const workspaceAvailabilityService = {
    evaluate: jest.fn(),
  };

  let service: KnowledgeBasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    workspaceAvailabilityService.evaluate.mockImplementation(
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
    service = new KnowledgeBasesService(prisma as any, workspaceAvailabilityService as any);
  });

  it('auto-generates a slug from the knowledge base name', async () => {
    prisma.knowledgeBase.findFirst.mockResolvedValue(null);
    prisma.knowledgeBase.create.mockResolvedValue({
      id: 'kb-1',
      slug: 'career-rag',
      workspaceKind: 'general',
      defaultIndexProfile: 'default',
      defaultRetrievalProfile: 'default',
    });

    await service.create({
      name: 'Career RAG',
      description: 'Profile knowledge base',
    });

    expect(prisma.knowledgeBase.create).toHaveBeenCalledWith({
      data: {
        name: 'Career RAG',
        slug: 'career-rag',
        description: 'Profile knowledge base',
        workspaceKind: 'general',
        defaultIndexProfile: 'default',
        defaultRetrievalProfile: 'default',
      },
    });
  });

  it('adds a numeric suffix when an auto-generated slug already exists', async () => {
    prisma.knowledgeBase.findFirst.mockResolvedValueOnce({ id: 'kb-existing' }).mockResolvedValueOnce(null);
    prisma.knowledgeBase.create.mockResolvedValue({
      id: 'kb-2',
      slug: 'career-rag-2',
      workspaceKind: 'general',
      defaultIndexProfile: 'default',
      defaultRetrievalProfile: 'default',
    });

    await service.create({
      name: 'Career RAG',
    });

    expect(prisma.knowledgeBase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: 'career-rag-2',
      }),
    });
  });

  it('finds a knowledge base by slug', async () => {
    prisma.knowledgeBase.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'kb-1',
      slug: 'career-rag',
      workspaceKind: 'codebase',
      defaultIndexProfile: 'code-default',
      defaultRetrievalProfile: 'code-debug',
      activeServingRevisionId: 'serving-1',
      servingRevisionState: 'active',
      activeServingRevision: {
        id: 'serving-1',
        manifestHash: 'manifest-1',
        status: 'active',
        payloadSchemaVersion: 'payload-v1',
        activatedAt: new Date('2026-07-18T12:00:00.000Z'),
        manifestEntries: [
          {
            position: 0,
            sourceRevision: {
              id: 'revision-1',
              sourceId: 'source-1',
              validationSummary: { status: 'passed' },
            },
          },
        ],
        indexBuilds: [{ id: 'build-1', status: 'active' }],
      },
      sources: [],
      indexVersions: [],
    });

    await expect(service.findOne('career-rag')).resolves.toMatchObject({
      id: 'kb-1',
      slug: 'career-rag',
      workspaceKind: 'codebase',
      defaultIndexProfile: 'code-default',
      defaultRetrievalProfile: 'code-debug',
      workspace: {
        id: 'kb-1',
        slug: 'career-rag',
        kind: 'codebase',
        activeServingRevisionId: 'serving-1',
        servingRevisionState: 'active',
        activeServingRevision: {
          id: 'serving-1',
          manifestHash: 'manifest-1',
          sourceRevisions: [
            expect.objectContaining({
              id: 'revision-1',
              position: 0,
              validationSummary: { status: 'passed' },
            }),
          ],
          indexBuild: { id: 'build-1', status: 'active' },
        },
      },
    });
  });

  it('exposes derived provider availability in REST and workspace-compatible list records', async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([
      {
        id: 'kb-1',
        slug: 'external-docs',
        name: 'External docs',
        workspaceKind: 'docs',
        defaultIndexProfile: 'docs-default',
        defaultRetrievalProfile: 'docs-qa',
        activeIndexVersionId: 'idx-1',
      },
    ]);
    workspaceAvailabilityService.evaluate.mockResolvedValue(
      new Map([
        [
          'kb-1',
          {
            status: 'unavailable',
            reason: 'embedding_connection_refused',
            retryable: true,
          },
        ],
      ]),
    );

    await expect(service.findAll()).resolves.toMatchObject([
      {
        id: 'kb-1',
        availability: {
          status: 'unavailable',
          reason: 'embedding_connection_refused',
        },
        workspace: {
          id: 'kb-1',
          availability: {
            status: 'unavailable',
            reason: 'embedding_connection_refused',
          },
        },
      },
    ]);
  });

  it('updates a knowledge base by slug and normalizes the new slug', async () => {
    prisma.knowledgeBase.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'kb-1',
      slug: 'career-rag',
      workspaceKind: 'general',
      defaultIndexProfile: 'default',
      defaultRetrievalProfile: 'default',
    });
    prisma.knowledgeBase.findFirst.mockResolvedValue(null);
    prisma.knowledgeBase.update.mockResolvedValue({
      id: 'kb-1',
      slug: 'frontend-career',
      workspaceKind: 'codebase',
      defaultIndexProfile: 'code-default',
      defaultRetrievalProfile: 'code-debug',
    });

    await service.update('career-rag', {
      slug: 'Frontend Career',
      workspaceKind: 'codebase',
      defaultIndexProfile: 'code-default',
      defaultRetrievalProfile: 'code-debug',
    });

    expect(prisma.knowledgeBase.update).toHaveBeenCalledWith({
      where: { id: 'kb-1' },
      data: {
        name: undefined,
        description: undefined,
        slug: 'frontend-career',
        workspaceKind: 'codebase',
        defaultIndexProfile: 'code-default',
        defaultRetrievalProfile: 'code-debug',
      },
    });
  });

  it('rejects conflicting knowledge base references', async () => {
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1',
      slug: 'career-rag',
    });

    await expect(service.resolveReference('kb-1', 'other-rag')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws not found for unknown identifiers', async () => {
    prisma.knowledgeBase.findUnique.mockResolvedValue(null);

    await expect(service.resolveIdentifier('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reuses an existing knowledge base by slug for bootstrap flows', async () => {
    prisma.knowledgeBase.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'kb-1', slug: 'career-rag' });

    await expect(
      service.ensureForBootstrap({
        slug: 'career-rag',
        name: 'Career RAG',
      }),
    ).resolves.toEqual({
      knowledgeBase: { id: 'kb-1', slug: 'career-rag' },
      created: false,
    });

    expect(prisma.knowledgeBase.create).not.toHaveBeenCalled();
  });
});
