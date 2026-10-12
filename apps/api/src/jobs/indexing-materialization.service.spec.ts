import { ChunkingService } from '../chunking/chunking.service';
import { SimpleChunker } from '../chunking/simple.chunker';
import { StructureAwareChunker } from '../chunking/structure-aware.chunker';
import { IndexingMaterializationService } from './indexing-materialization.service';

describe('IndexingMaterializationService build artifacts', () => {
  it('creates source-scoped compatibility records plus serving build state', async () => {
    const prisma = {
      sourceSnapshot: {
        create: jest.fn().mockResolvedValue({ id: 'snapshot-1', metadata: {} }),
      },
      datasetVersion: {
        create: jest.fn().mockResolvedValue({ id: 'dataset-1' }),
      },
      indexVersion: {
        create: jest.fn().mockResolvedValue({ id: 'index-1' }),
      },
    };
    const servingRevisions = {
      prepareBuild: jest.fn().mockResolvedValue({
        sourceRevisionId: 'source-revision-1',
        workspaceServingRevisionId: 'serving-1',
        indexBuildId: 'build-1',
        manifestHash: 'manifest-1',
        missingSourceIds: [],
      }),
    };
    const service = new IndexingMaterializationService(
      prisma as any,
      createChunkingService(),
      servingRevisions as any,
    );

    const result = await service.createBuildArtifacts({
      source: { id: 'source-1', uri: '/data/source-1' },
      knowledgeBase: { id: 'kb-1' },
      scanRoot: '/data/source-1',
      fileCount: 1,
      contentBytes: 12,
      parsedFiles: [
        {
          documentId: 'document-1',
          changeType: 'added',
          file: {
            relativePath: 'README.md',
            absolutePath: '/data/source-1/README.md',
            size: 12,
            mtime: new Date('2026-07-18T00:00:00.000Z'),
          },
          parsed: {
            text: '# Readme',
            mimeType: 'text/markdown',
            filePath: 'README.md',
            contentHash: 'document-hash',
            fileSize: 12,
            language: 'markdown',
          },
        },
      ],
      ignoredFiles: 0,
      parseFailures: 0,
      embeddingModel: 'embed-model',
      embeddingDimension: 384,
      collectionName: 'kb-kb-1',
      storageProfile: 'balanced',
      resourceEstimate: { estimatedChunks: 1 },
    });

    expect(prisma.datasetVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceSnapshotIds: ['snapshot-1'],
        documentCount: 1,
        status: 'building',
      }),
    });
    expect(servingRevisions.prepareBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        sourceId: 'source-1',
        sourceSnapshotId: 'snapshot-1',
        documentCount: 1,
        indexVersionId: 'index-1',
        physicalCollectionName: 'kb-kb-1',
        embeddingProfileSnapshot: expect.objectContaining({
          model: 'embed-model',
          dimension: 384,
        }),
      }),
    );
    expect(result.servingBuild).toMatchObject({
      sourceRevisionId: 'source-revision-1',
      workspaceServingRevisionId: 'serving-1',
      indexBuildId: 'build-1',
    });
  });
});

function createChunkingService() {
  const simpleChunker = new SimpleChunker();
  return new ChunkingService(simpleChunker, new StructureAwareChunker(simpleChunker));
}
