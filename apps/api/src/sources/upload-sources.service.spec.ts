import { UploadSourcesService } from './upload-sources.service';

describe('UploadSourcesService', () => {
  it('stores the upload, creates an upload source, and returns the indexing request shape', async () => {
    const knowledgeBasesService = {
      resolveIdentifier: jest.fn().mockResolvedValue({
        id: 'kb-1',
        slug: 'career-rag',
        name: 'Career RAG',
        workspaceKind: 'datasets',
      }),
    };
    const sourcesService = {
      createManagedUploadSource: jest.fn().mockResolvedValue({
        id: 'source-1',
        type: 'upload',
        uri: 'upload://upload-1',
      }),
    };
    const uploadStorage = {
      store: jest.fn().mockResolvedValue({
        uploadId: 'upload-1',
        originalFileName: 'dataset.zip',
        archiveFormat: 'zip',
        storageRoot: '/var/lib/contextforge/uploads',
        originalPath: '/var/lib/contextforge/uploads/upload-1/original/dataset.zip',
        extractedPath: '/var/lib/contextforge/uploads/upload-1/extracted',
        sizeBytes: 123,
        fileCount: 2,
        contentBytes: 456,
        uploadedAt: '2026-05-28T12:00:00.000Z',
      }),
    };
    const service = new UploadSourcesService(
      knowledgeBasesService as any,
      sourcesService as any,
      uploadStorage as any,
    );

    await expect(
      service.createManagedUploadSource(
        'career-rag',
        {
          originalname: 'dataset.zip',
          buffer: Buffer.from('zip'),
          size: 3,
        },
        {
          includeRules: '["**/*.md","**/*.txt"]',
          excludeRules: 'tmp/**,node_modules/**',
          sourceName: 'docs import',
        },
      ),
    ).resolves.toMatchObject({
      workspace: {
        id: 'kb-1',
        slug: 'career-rag',
      },
      upload: {
        id: 'upload-1',
        archiveFormat: 'zip',
        fileCount: 2,
      },
      source: {
        id: 'source-1',
        type: 'upload',
      },
      next: {
        enqueueIndexing: {
          method: 'POST',
          path: '/jobs/indexing',
          body: {
            knowledgeBaseId: 'kb-1',
            sourceId: 'source-1',
            type: 'scan_source',
          },
        },
      },
    });

    expect(sourcesService.createManagedUploadSource).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      uploadId: 'upload-1',
      includeRules: ['**/*.md', '**/*.txt'],
      excludeRules: ['tmp/**', 'node_modules/**'],
      metadata: expect.objectContaining({
        managed: true,
        uploadId: 'upload-1',
        archiveFormat: 'zip',
        extractedPath: '/var/lib/contextforge/uploads/upload-1/extracted',
        sourceName: 'docs import',
        cleanupStrategy: 'manual',
      }),
    });
  });
});
