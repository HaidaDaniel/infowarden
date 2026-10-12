import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalFolderIndexer } from './local-folder-indexer';
import { TextCodeParser } from '../ingestion/text-code.parser';
import { SimpleChunker } from '../chunking/simple.chunker';
import { StructureAwareChunker } from '../chunking/structure-aware.chunker';
import { SourceType, WorkspaceKind } from '@prisma/client';
import { IndexingSourcePreparationService } from './indexing-source-preparation.service';
import { IndexingChangePlannerService } from './indexing-change-planner.service';
import { IndexingMaterializationService } from './indexing-materialization.service';
import { ChunkingService } from '../chunking/chunking.service';

describe('LocalFolderIndexer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-forge-indexer-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists new documents, chunks, validation report, and vectors', async () => {
    const filePath = writeFixture('README.md', '# Hello\nIndex me');
    const prisma = createPrismaMock();
    const qdrant = createQdrantMock();
    const embeddingProvider = createEmbeddingProvider();
    const indexer = createIndexer({
      prisma,
      qdrant,
      embeddingProvider,
      files: [fileEntry('README.md', filePath)],
    });

    await indexer.run('job-1');

    expect(prisma.document.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.documentVersion.create).toHaveBeenCalledTimes(1);
    expect(prisma.chunk.upsert).toHaveBeenCalled();
    expect(prisma.chunkVersion.create).toHaveBeenCalled();
    expect(prisma.validationReport.create).toHaveBeenCalled();
    expect(qdrant.upsertVectors).toHaveBeenCalledTimes(1);
    expect(qdrant.upsertVectors.mock.calls[0][1][0]).toEqual([0.1, 0.2, 0.3]);
    expect(qdrant.upsertVectors.mock.calls[0][2][0]).toMatchObject({
      chunkerVersion: 'structure-aware-v1',
      metadata: expect.objectContaining({
        chunkerStrategy: 'markdown_section',
        heading: 'Hello',
        stableStructureHash: expect.any(String),
        stableContentHash: expect.any(String),
      }),
    });
    expect(prisma.knowledgeBase.update).not.toHaveBeenCalled();
    expect(indexer.getStats()).toMatchObject({
      filesParsed: 1,
      documentsCreated: 1,
      vectorsUpserted: 1,
      payloadsUpdated: 0,
    });
  });

  it('keeps stats and logs isolated when two source jobs overlap', async () => {
    const firstPath = writeFixture('first.md', '# First\nOne');
    const secondPath = writeFixture('second.md', '# Second\nTwo');
    const prisma = createPrismaMock();
    prisma.indexingJob.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({
        id: where.id,
        source: {
          id: where.id,
          knowledgeBaseId: 'kb-1',
          type: SourceType.local_folder,
          uri: 'fixture',
          includeRules: [],
          excludeRules: [],
          metadata: {},
        },
        knowledgeBase: {
          id: 'kb-1',
          name: 'Test KB',
          activeIndexVersionId: null,
          workspaceKind: WorkspaceKind.general,
        },
      }),
    );

    let markFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sourcePreparation = {
      prepare: jest.fn().mockImplementation(async (source: { id: string }) => {
        if (source.id === 'job-a') {
          markFirstStarted();
          await firstRelease;
          return { scanRoot: tempDir, files: [fileEntry('first.md', firstPath)] };
        }
        return {
          scanRoot: tempDir,
          files: [fileEntry('first.md', firstPath), fileEntry('second.md', secondPath)],
        };
      }),
    };
    const indexer = createIndexer({ prisma, qdrant: createQdrantMock(), sourcePreparation });

    const firstRun = indexer.run('job-a');
    await firstStarted;
    const secondRun = indexer.run('job-b');
    await secondRun;
    releaseFirst();
    await firstRun;

    expect(indexer.getStats('job-a')).toMatchObject({ filesScanned: 1, filesParsed: 1 });
    expect(indexer.getStats('job-b')).toMatchObject({ filesScanned: 2, filesParsed: 2 });
    expect(indexer.getLogs('job-a').map((entry) => entry.message)).not.toContain('Materialized file: second.md');
    expect(indexer.getLogs('job-b').some((entry) => entry.message.includes('second.md'))).toBe(true);
    expect((indexer as any).resultsByJobId.size).toBe(0);
  });

  it('batches embeddings across small documents with bounded flushes', async () => {
    const previousBatchSize = process.env.INDEXING_EMBEDDING_BATCH_SIZE;
    process.env.INDEXING_EMBEDDING_BATCH_SIZE = '2';
    try {
      const firstPath = writeFixture('a.md', 'alpha');
      const secondPath = writeFixture('b.md', 'bravo');
      const thirdPath = writeFixture('c.md', 'charlie');
      const prisma = createPrismaMock();
      const qdrant = createQdrantMock();
      const embeddingProvider = createEmbeddingProvider({
        embedTexts: jest.fn().mockImplementation((texts: string[]) => texts.map((_, index) => [index + 1, 0, 0])),
      });
      const indexer = createIndexer({
        prisma,
        qdrant,
        embeddingProvider,
        files: [fileEntry('a.md', firstPath), fileEntry('b.md', secondPath), fileEntry('c.md', thirdPath)],
      });

      await indexer.run('job-1');

      expect(embeddingProvider.embedTexts).toHaveBeenCalledTimes(2);
      expect(embeddingProvider.embedTexts.mock.calls[0][0]).toHaveLength(2);
      expect(embeddingProvider.embedTexts.mock.calls[1][0]).toHaveLength(1);
      expect(qdrant.upsertVectors).toHaveBeenCalledTimes(2);
      expect(qdrant.upsertVectors.mock.calls[0][1]).toEqual([
        [1, 0, 0],
        [2, 0, 0],
      ]);
      expect(qdrant.upsertVectors.mock.calls[0][2].map((payload: any) => payload.metadata.path)).toEqual([
        'a.md',
        'b.md',
      ]);
      expect(qdrant.upsertVectors.mock.calls[1][2].map((payload: any) => payload.metadata.path)).toEqual(['c.md']);
      expect(indexer.getStats()).toMatchObject({
        documentsCreated: 3,
        chunksCreated: 3,
        vectorsUpserted: 3,
      });
    } finally {
      if (previousBatchSize === undefined) {
        delete process.env.INDEXING_EMBEDDING_BATCH_SIZE;
      } else {
        process.env.INDEXING_EMBEDDING_BATCH_SIZE = previousBatchSize;
      }
    }
  });

  it('fails when a buffered embedding response length does not match payload count', async () => {
    const firstPath = writeFixture('a.md', 'alpha');
    const secondPath = writeFixture('b.md', 'bravo');
    const prisma = createPrismaMock();
    const qdrant = createQdrantMock();
    const embeddingProvider = createEmbeddingProvider({
      embedTexts: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    });
    const indexer = createIndexer({
      prisma,
      qdrant,
      embeddingProvider,
      files: [fileEntry('a.md', firstPath), fileEntry('b.md', secondPath)],
    });

    await expect(indexer.run('job-1')).rejects.toThrow('Embedding provider returned 1 vectors for 2 buffered chunks');

    expect(qdrant.upsertVectors).not.toHaveBeenCalled();
    expect(prisma.knowledgeBase.update).not.toHaveBeenCalled();
  });

  it('materializes unchanged chunks into a new source-revision point set', async () => {
    const filePath = writeFixture('README.md', 'same text');
    const parser = new TextCodeParser();
    const parsed = parser.parse(fs.readFileSync(filePath), 'README.md');
    const documentId = stableDocumentId('source-1', 'README.md');
    const chunkId = stableChunkId(documentId, 0);
    const prisma = createPrismaMock({
      existingDocuments: [
        {
          id: documentId,
          sourceId: 'source-1',
          path: 'README.md',
          contentHash: parsed?.contentHash,
          status: 'active',
          metadata: {},
        },
      ],
      existingChunks: [
        {
          id: chunkId,
          documentId,
          indexVersionId: 'index-prev',
          text: parsed?.text,
          textHash: hashText(parsed?.text || ''),
          tokenCount: Math.ceil((parsed?.text.length || 0) / 4),
          chunkIndex: 0,
          metadata: {},
        },
      ],
    });
    const qdrant = createQdrantMock();
    const embeddingProvider = createEmbeddingProvider();
    const indexer = createIndexer({
      prisma,
      qdrant,
      embeddingProvider,
      files: [fileEntry('README.md', filePath)],
    });

    await indexer.run('job-1');

    expect(embeddingProvider.embedTexts).toHaveBeenCalledTimes(1);
    expect(qdrant.upsertVectors).toHaveBeenCalledTimes(1);
    expect(qdrant.setPayloads).not.toHaveBeenCalled();
    expect(indexer.getStats()).toMatchObject({
      unchanged: 1,
      documentsSkipped: 1,
      vectorsUpserted: 1,
      payloadsUpdated: 0,
      chunksReused: 0,
    });
  });

  it('force re-embeds unchanged chunks when requested by refresh mode', async () => {
    const filePath = writeFixture('README.md', 'same text');
    const parser = new TextCodeParser();
    const parsed = parser.parse(fs.readFileSync(filePath), 'README.md');
    const documentId = stableDocumentId('source-1', 'README.md');
    const chunkId = stableChunkId(documentId, 0);
    const prisma = createPrismaMock({
      existingDocuments: [
        {
          id: documentId,
          sourceId: 'source-1',
          path: 'README.md',
          contentHash: parsed?.contentHash,
          status: 'active',
          metadata: {},
        },
      ],
      existingChunks: [
        {
          id: chunkId,
          documentId,
          indexVersionId: 'index-prev',
          text: parsed?.text,
          textHash: hashText(parsed?.text || ''),
          tokenCount: Math.ceil((parsed?.text.length || 0) / 4),
          chunkIndex: 0,
          metadata: {},
        },
      ],
    });
    const qdrant = createQdrantMock();
    const embeddingProvider = createEmbeddingProvider();
    const indexer = createIndexer({
      prisma,
      qdrant,
      embeddingProvider,
      files: [fileEntry('README.md', filePath)],
    });

    await indexer.run('job-1', { mode: 'force_reembed', trigger: 'manual' });

    expect(embeddingProvider.embedTexts).toHaveBeenCalledTimes(1);
    expect(qdrant.upsertVectors).toHaveBeenCalledTimes(1);
    expect(qdrant.setPayloads).not.toHaveBeenCalled();
    expect(indexer.getStats()).toMatchObject({
      refreshMode: 'force_reembed',
      unchanged: 1,
      vectorsUpserted: 1,
      payloadsUpdated: 0,
    });
  });

  it('does not use payload-only writes for a candidate source revision', async () => {
    const filePath = writeFixture('README.md', 'same text');
    const parser = new TextCodeParser();
    const parsed = parser.parse(fs.readFileSync(filePath), 'README.md');
    const documentId = stableDocumentId('source-1', 'README.md');
    const chunkId = stableChunkId(documentId, 0);
    const prisma = createPrismaMock({
      existingDocuments: [
        {
          id: documentId,
          sourceId: 'source-1',
          path: 'README.md',
          mimeType: 'text/markdown',
          contentHash: parsed?.contentHash,
          status: 'active',
          metadata: { path: 'README.md' },
        },
      ],
      existingChunks: [
        {
          id: chunkId,
          documentId,
          indexVersionId: 'index-prev',
          text: parsed?.text,
          textHash: hashText(parsed?.text || ''),
          tokenCount: Math.ceil((parsed?.text.length || 0) / 4),
          chunkIndex: 0,
          metadata: { path: 'README.md' },
        },
      ],
    });
    const qdrant = createQdrantMock();
    qdrant.setPayloads.mockRejectedValueOnce(new Error('payload update failed'));
    const indexer = createIndexer({
      prisma,
      qdrant,
      files: [fileEntry('README.md', filePath)],
    });

    await expect(indexer.run('job-1')).resolves.toBeUndefined();
    expect(qdrant.setPayloads).not.toHaveBeenCalled();
    expect(qdrant.upsertVectors).toHaveBeenCalledTimes(1);
  });

  it('marks deleted documents but retains old revision vectors until activation cleanup', async () => {
    const prisma = createPrismaMock({
      existingDocuments: [
        {
          id: 'doc-deleted',
          sourceId: 'source-1',
          path: 'old.md',
          contentHash: 'old',
          status: 'active',
          metadata: {},
        },
      ],
      existingChunks: [
        {
          id: 'chunk-deleted',
          documentId: 'doc-deleted',
          indexVersionId: 'index-prev',
          text: 'old',
          textHash: hashText('old'),
          tokenCount: 1,
          chunkIndex: 0,
          metadata: {},
        },
      ],
    });
    const qdrant = createQdrantMock();
    const indexer = createIndexer({ prisma, qdrant, files: [] });

    await indexer.run('job-1');

    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-deleted' },
      data: { status: 'deleted' },
    });
    expect(qdrant.deleteByChunkIds).not.toHaveBeenCalled();
    expect(indexer.getStats()).toMatchObject({
      deleted: 1,
      documentsDeleted: 1,
      chunksDeleted: 0,
      vectorsDeleted: 0,
    });
  });

  it('activates a complete candidate before cleaning only superseded B vectors', async () => {
    const filePath = writeFixture('B.md', 'replacement B');
    const prisma = createPrismaMock();
    const qdrant = createQdrantMock();
    const servingRevisions = {
      prepareBuild: jest.fn().mockResolvedValue({
        sourceRevisionId: 'revision-b2',
        workspaceServingRevisionId: 'serving-2',
        indexBuildId: 'build-2',
        manifestHash: 'manifest-2',
        missingSourceIds: [],
      }),
      finalizeBuild: jest.fn().mockResolvedValue({
        activated: true,
        state: 'active',
        missingSourceIds: [],
        unexpectedSourceIds: [],
        supersededSourceRevisionIds: ['revision-b1'],
      }),
      failBuild: jest.fn().mockResolvedValue(undefined),
    };
    const placement = {
      resolveForKnowledgeBase: jest.fn().mockResolvedValue({
        vectorBackendId: 'backend-1',
        physicalCollectionName: 'workspace-collection',
      }),
      activateMaterialization: jest.fn().mockResolvedValue({}),
    };
    const indexer = createIndexer({
      prisma,
      qdrant,
      files: [fileEntry('B.md', filePath)],
      servingRevisions,
      placement,
    });

    await indexer.run('job-1');

    expect(servingRevisions.finalizeBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceServingRevisionId: 'serving-2',
        indexBuildId: 'build-2',
        physicalCollectionName: 'workspace-collection',
      }),
    );
    expect(placement.activateMaterialization).not.toHaveBeenCalled();
    expect(qdrant.deleteBySourceRevisionId).toHaveBeenCalledWith('workspace-collection', 'revision-b1', 'backend-1');
    expect(qdrant.deleteBySourceRevisionId).not.toHaveBeenCalledWith(
      'workspace-collection',
      'revision-b2',
      'backend-1',
    );
  });

  it('re-embeds only changed chunks for a changed document', async () => {
    const filePath = writeFixture(
      'README.md',
      `${'a'.repeat(2900)}\n${'b'.repeat(500)}\n${'c'.repeat(2900)}\n${'changed'.repeat(80)}`,
    );
    const originalText = `${'a'.repeat(2900)}\n${'b'.repeat(500)}\n${'c'.repeat(2900)}\n${'old'.repeat(80)}`;
    const parser = new TextCodeParser();
    const chunker = new SimpleChunker();
    const originalParsed = parser.parse(Buffer.from(originalText), 'README.md');
    const originalChunks = chunker.chunk(originalParsed?.text || '', {
      strategy: 'fixed_char',
      maxChars: 3000,
      overlapChars: 300,
    });
    const documentId = stableDocumentId('source-1', 'README.md');
    const prisma = createPrismaMock({
      existingDocuments: [
        {
          id: documentId,
          sourceId: 'source-1',
          path: 'README.md',
          contentHash: originalParsed?.contentHash,
          status: 'active',
          metadata: {},
        },
      ],
      existingChunks: originalChunks.map((chunk) => ({
        id: stableChunkId(documentId, chunk.chunkIndex),
        documentId,
        indexVersionId: 'index-prev',
        text: chunk.text,
        textHash: hashText(chunk.text),
        tokenCount: chunk.tokenEstimate || 0,
        chunkIndex: chunk.chunkIndex,
        metadata: {},
      })),
    });
    const qdrant = createQdrantMock();
    const embeddingProvider = createEmbeddingProvider();
    const indexer = createIndexer({
      prisma,
      qdrant,
      embeddingProvider,
      files: [fileEntry('README.md', filePath)],
    });

    await indexer.run('job-1');

    expect(embeddingProvider.embedTexts).toHaveBeenCalledTimes(1);
    expect(embeddingProvider.embedTexts.mock.calls[0][0]).toHaveLength(4);
    expect(qdrant.setPayloads).not.toHaveBeenCalled();
    expect(indexer.getStats()).toMatchObject({
      changed: 1,
      vectorsUpserted: 4,
    });
    expect(indexer.getStats().payloadsUpdated).toBe(0);
    expect(indexer.getStats().chunksReused).toBe(0);
  });

  it('does not activate a partial index when vector upsert fails', async () => {
    const filePath = writeFixture('README.md', 'will fail');
    const prisma = createPrismaMock();
    const qdrant = createQdrantMock();
    qdrant.upsertVectors.mockRejectedValueOnce(new Error('qdrant down'));
    const indexer = createIndexer({
      prisma,
      qdrant,
      files: [fileEntry('README.md', filePath)],
    });

    await expect(indexer.run('job-1')).rejects.toThrow('qdrant down');

    expect(prisma.knowledgeBase.update).not.toHaveBeenCalled();
    expect(prisma.document.delete).toHaveBeenCalledWith({
      where: { id: stableDocumentId('source-1', 'README.md') },
    });
    expect(prisma.indexVersion.update).toHaveBeenCalledWith({
      where: { id: 'index-1' },
      data: { status: 'failed' },
    });
  });

  it('fails before creating partial index state when embedding preflight fails', async () => {
    const filePath = writeFixture('README.md', 'will not start');
    const prisma = createPrismaMock();
    const qdrant = createQdrantMock();
    const indexer = createIndexer({
      prisma,
      qdrant,
      files: [fileEntry('README.md', filePath)],
      embeddingProvider: {
        resolveProvider: jest.fn().mockResolvedValue(testRuntimeEmbeddingProvider()),
        assertReady: jest.fn().mockRejectedValue(new Error('embedding provider not ready')),
        embedTexts: jest.fn(),
      },
    });

    await expect(indexer.run('job-1')).rejects.toThrow('embedding provider not ready');

    expect(prisma.sourceSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.datasetVersion.create).not.toHaveBeenCalled();
    expect(prisma.indexVersion.create).not.toHaveBeenCalled();
    expect(qdrant.upsertVectors).not.toHaveBeenCalled();
  });

  it('requires explicit re-embed mode when the resolved embedding provider changes', async () => {
    const filePath = writeFixture('README.md', 'provider changed');
    const prisma = createPrismaMock({
      knowledgeBase: {
        id: 'kb-1',
        name: 'Test KB',
        activeIndexVersionId: 'index-prev',
        workspaceKind: WorkspaceKind.general,
      },
      previousIndexVersion: {
        id: 'index-prev',
        embeddingModel: 'old-embedding',
        embeddingDimension: 3,
        vectorCollectionName: 'kb-kb-1',
      },
    });
    const qdrant = createQdrantMock();
    const indexer = createIndexer({
      prisma,
      qdrant,
      files: [fileEntry('README.md', filePath)],
      embeddingProvider: {
        resolveProvider: jest.fn().mockResolvedValue(
          testRuntimeEmbeddingProvider({
            model: 'new-embedding',
            reindexRequired: true,
            reindexReason: 'provider changed',
          }),
        ),
        assertReady: jest.fn().mockResolvedValue(undefined),
        embedTexts: jest.fn(),
      },
    });

    await expect(indexer.run('job-1')).rejects.toThrow('provider changed');

    expect(prisma.sourceSnapshot.create).not.toHaveBeenCalled();
    expect(qdrant.upsertVectors).not.toHaveBeenCalled();
  });

  it('allows provider changes when force re-embedding is requested', async () => {
    const filePath = writeFixture('README.md', 'provider changed');
    const prisma = createPrismaMock({
      knowledgeBase: {
        id: 'kb-1',
        name: 'Test KB',
        activeIndexVersionId: 'index-prev',
        workspaceKind: WorkspaceKind.general,
      },
      previousIndexVersion: {
        id: 'index-prev',
        embeddingModel: 'old-embedding',
        embeddingDimension: 3,
        vectorCollectionName: 'kb-kb-1',
      },
    });
    const qdrant = createQdrantMock();
    const indexer = createIndexer({
      prisma,
      qdrant,
      files: [fileEntry('README.md', filePath)],
      embeddingProvider: {
        resolveProvider: jest.fn().mockResolvedValue(
          testRuntimeEmbeddingProvider({
            model: 'new-embedding',
            reindexRequired: true,
            reindexReason: 'provider changed',
          }),
        ),
        assertReady: jest.fn().mockResolvedValue(undefined),
        embedTexts: jest.fn().mockImplementation((texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
      },
    });

    await indexer.run('job-1', { mode: 'force_reembed', trigger: 'manual' });

    expect(prisma.indexVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          embeddingModel: 'new-embedding',
          embeddingDimension: 3,
        }),
      }),
    );
    expect(qdrant.upsertVectors).toHaveBeenCalledTimes(1);
  });

  it('records dependency invalidation hints for codebase workspaces', async () => {
    const configPath = writeFixture('src/config.ts', 'export const config = 1;\n');
    const consumerPath = writeFixture(
      'src/consumer.ts',
      "import { config } from './config'\nexport const value = config;\n",
    );
    const parser = new TextCodeParser();
    const unchangedParsed = parser.parse(fs.readFileSync(consumerPath), 'src/consumer.ts');
    const consumerId = stableDocumentId('source-1', 'src/consumer.ts');
    const consumerChunk = new SimpleChunker().chunk(unchangedParsed?.text || '', {
      strategy: 'fixed_char',
      maxChars: 3000,
      overlapChars: 300,
    })[0];
    const prisma = createPrismaMock({
      knowledgeBase: {
        id: 'kb-1',
        name: 'Code KB',
        activeIndexVersionId: null,
        workspaceKind: WorkspaceKind.codebase,
      },
      existingDocuments: [
        {
          id: stableDocumentId('source-1', 'src/config.ts'),
          sourceId: 'source-1',
          path: 'src/config.ts',
          contentHash: 'old-config-hash',
          status: 'active',
          metadata: {},
        },
        {
          id: consumerId,
          sourceId: 'source-1',
          path: 'src/consumer.ts',
          contentHash: unchangedParsed?.contentHash,
          status: 'active',
          metadata: {
            dependencyRefs: ['./config'],
          },
        },
      ],
      existingChunks: [
        {
          id: stableChunkId(consumerId, 0),
          documentId: consumerId,
          indexVersionId: 'index-prev',
          text: consumerChunk.text,
          textHash: hashText(consumerChunk.text),
          tokenCount: consumerChunk.tokenEstimate || 0,
          chunkIndex: 0,
          metadata: {},
        },
      ],
    });
    const qdrant = createQdrantMock();
    const indexer = createIndexer({
      prisma,
      qdrant,
      files: [fileEntry('src/config.ts', configPath), fileEntry('src/consumer.ts', consumerPath)],
    });

    await indexer.run('job-1');

    expect(prisma.sourceSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'snapshot-1' },
      data: {
        metadata: expect.objectContaining({
          dependencyHints: [
            {
              path: 'src/consumer.ts',
              dependsOn: ['src/config.ts'],
            },
          ],
        }),
      },
    });
    expect(indexer.getStats()).toMatchObject({
      dependencyCandidates: 1,
    });
  });

  it('indexes URL source entries through the normal materialization path', async () => {
    const prisma = createPrismaMock({
      source: {
        id: 'source-1',
        knowledgeBaseId: 'kb-1',
        type: SourceType.url,
        uri: 'https://example.com/',
        includeRules: [],
        excludeRules: [],
        metadata: {},
      },
    });
    const qdrant = createQdrantMock();
    const indexer = createIndexer({
      prisma,
      qdrant,
      files: [
        {
          relativePath: 'index.html',
          absolutePath: 'https://example.com/',
          size: 256,
          mtime: new Date('2026-05-31T00:00:00.000Z'),
          content: Buffer.from('URL: https://example.com/\n\nHello from the web', 'utf8'),
          metadata: {
            sourceUrl: 'https://example.com/',
            contentType: 'text/html',
          },
        },
      ],
    });

    await indexer.run('job-1');

    expect(prisma.sourceSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshotType: 'url_crawl',
        ref: 'https://example.com/',
        metadata: expect.objectContaining({
          startUrl: 'https://example.com/',
          fetchedUrls: ['https://example.com/'],
        }),
      }),
    });
    expect(prisma.document.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          path: 'index.html',
          metadata: expect.objectContaining({
            sourceUrl: 'https://example.com/',
            contentType: 'text/html',
          }),
        }),
      }),
    );
    expect(qdrant.upsertVectors).toHaveBeenCalledTimes(1);
  });

  it('records document processor metadata and extraction warnings in validation reports', async () => {
    const filePath = writeFixture(
      'tiny.pdf',
      [
        '%PDF-1.4',
        '1 0 obj << /Type /Page >> endobj',
        '2 0 obj << /Length 18 >>',
        'stream',
        'BT (Tiny) Tj ET',
        'endstream',
        'endobj',
        '%%EOF',
      ].join('\n'),
    );
    const prisma = createPrismaMock();
    const qdrant = createQdrantMock();
    const indexer = createIndexer({
      prisma,
      qdrant,
      files: [fileEntry('tiny.pdf', filePath)],
    });

    await indexer.run('job-1');

    expect(prisma.validationReport.create).toHaveBeenCalledWith('kb-1', 'index-1', expect.any(Object), [
      expect.objectContaining({
        code: 'low_confidence_pdf_text',
        documentId: stableDocumentId('source-1', 'tiny.pdf'),
        metadata: expect.objectContaining({
          path: 'tiny.pdf',
          pageCount: 1,
        }),
      }),
    ]);
    expect(prisma.document.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          mimeType: 'application/pdf',
          metadata: expect.objectContaining({
            processor: 'pdf_text',
            extractionConfidence: 'low',
            extractionWarnings: [
              expect.objectContaining({
                code: 'low_confidence_pdf_text',
              }),
            ],
          }),
        }),
      }),
    );
  });

  function writeFixture(relativePath: string, contents: string): string {
    const absolutePath = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
    return absolutePath;
  }
});

function createIndexer(options: {
  prisma: any;
  qdrant: any;
  files?: Array<{
    relativePath: string;
    absolutePath: string;
    size: number;
    mtime: Date;
    content?: Buffer;
    metadata?: Record<string, unknown>;
  }>;
  embeddingProvider?: any;
  servingRevisions?: any;
  placement?: any;
  sourcePreparation?: any;
}) {
  const scanner = {
    scan: jest.fn().mockReturnValue(options.files || []),
  } as any;
  const gitManager = {
    getStatus: jest.fn(),
    clone: jest.fn(),
    pull: jest.fn(),
  } as any;
  const urlCrawler = {
    crawl: jest.fn().mockResolvedValue({
      files: options.files || [],
      metadata: {
        startUrl: 'https://example.com/',
        fetchedUrls: ['https://example.com/'],
        maxPages: 25,
        maxBytesPerPage: 1024 * 1024,
        totalMaxBytes: 5 * 1024 * 1024,
        timeoutMs: 10000,
        sameHost: true,
        respectRobots: true,
      },
    }),
  } as any;
  const embeddingProvider = options.embeddingProvider || createEmbeddingProvider();
  const servingRevisions =
    options.servingRevisions ||
    ({
      prepareBuild: jest.fn().mockResolvedValue({
        sourceRevisionId: 'source-revision-1',
        workspaceServingRevisionId: 'serving-1',
        indexBuildId: 'build-1',
        manifestHash: 'manifest-1',
        missingSourceIds: [],
      }),
      finalizeBuild: jest.fn().mockResolvedValue({
        activated: false,
        state: 'reconciliation_required',
        missingSourceIds: [],
        unexpectedSourceIds: [],
        supersededSourceRevisionIds: [],
      }),
      failBuild: jest.fn().mockResolvedValue(undefined),
    } as any);
  const workspaceVectorPlacement =
    options.placement ||
    ({
      resolveForKnowledgeBase: jest.fn().mockResolvedValue({
        vectorBackendId: 'default-qdrant',
        physicalCollectionName: null,
      }),
      activateMaterialization: jest.fn().mockResolvedValue({}),
    } as any);

  const sourcePreparation =
    options.sourcePreparation || new IndexingSourcePreparationService(scanner, gitManager, urlCrawler);
  const changePlanner = new IndexingChangePlannerService(new TextCodeParser());
  const materialization = new IndexingMaterializationService(options.prisma, createChunkingService(), servingRevisions);

  return new LocalFolderIndexer(
    options.prisma,
    sourcePreparation,
    changePlanner,
    materialization,
    embeddingProvider as any,
    options.qdrant,
    { createReport: options.prisma.validationReport.create } as any,
    servingRevisions,
    workspaceVectorPlacement,
  );
}

function createChunkingService() {
  const simpleChunker = new SimpleChunker();
  return new ChunkingService(simpleChunker, new StructureAwareChunker(simpleChunker));
}

function createEmbeddingProvider(overrides: Record<string, unknown> = {}) {
  return {
    resolveProvider: jest.fn().mockResolvedValue(testRuntimeEmbeddingProvider()),
    assertReady: jest.fn().mockResolvedValue(undefined),
    embedTexts: jest.fn().mockImplementation((texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
    ...overrides,
  };
}

function testRuntimeEmbeddingProvider(overrides: Record<string, unknown> = {}) {
  return {
    source: 'environment',
    name: 'environment',
    baseUrl: 'http://embedding.local/v1',
    model: 'test-embedding',
    dimension: 3,
    apiKey: 'test-key',
    apiKeyRef: 'EMBEDDING_API_KEY',
    timeoutMs: 1000,
    protocol: 'openai_compatible',
    ...overrides,
  };
}

function createPrismaMock(
  options: {
    existingDocuments?: any[];
    existingChunks?: any[];
    source?: any;
    knowledgeBase?: any;
    previousIndexVersion?: any;
  } = {},
) {
  const chunks = [...(options.existingChunks || [])];
  const documents = [...(options.existingDocuments || [])];

  return {
    indexingJob: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'job-1',
        source: options.source || {
          id: 'source-1',
          knowledgeBaseId: 'kb-1',
          type: SourceType.local_folder,
          uri: 'fixture',
          includeRules: [],
          excludeRules: [],
          metadata: {},
        },
        knowledgeBase: options.knowledgeBase || {
          id: 'kb-1',
          name: 'Test KB',
          activeIndexVersionId: null,
          workspaceKind: WorkspaceKind.general,
        },
      }),
    },
    indexVersion: {
      findUnique: jest.fn().mockResolvedValue(options.previousIndexVersion || null),
      create: jest.fn().mockResolvedValue({
        id: 'index-1',
        vectorCollectionName: 'kb-kb-1',
        materializationMode: 'mutable_collection',
      }),
      update: jest.fn().mockResolvedValue({ id: 'index-1' }),
    },
    document: {
      findMany: jest.fn().mockResolvedValue(documents),
      findUnique: jest.fn().mockImplementation(({ where }) => {
        return Promise.resolve(documents.find((document) => document.id === where.id) || null);
      }),
      upsert: jest.fn().mockImplementation(({ create, update, where }) => {
        const existing = documents.find((document) => document.id === where.id);
        const next = existing ? { ...existing, ...update } : { id: where.id, ...create };
        if (!existing) {
          documents.push(next);
        }
        return Promise.resolve(next);
      }),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockImplementation(({ where }) => {
        const index = documents.findIndex((document) => document.id === where.id);
        if (index >= 0) {
          documents.splice(index, 1);
        }
        return Promise.resolve({});
      }),
    },
    sourceSnapshot: {
      create: jest.fn().mockResolvedValue({ id: 'snapshot-1', metadata: {} }),
      update: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
    },
    datasetVersion: {
      create: jest.fn().mockResolvedValue({ id: 'dataset-1' }),
      update: jest.fn().mockResolvedValue({ id: 'dataset-1' }),
    },
    documentVersion: {
      create: jest.fn().mockResolvedValue({ id: 'document-version-1' }),
    },
    chunk: {
      upsert: jest.fn().mockImplementation(({ create, update, where }) => {
        const existingIndex = chunks.findIndex((chunk) => chunk.id === where.id);
        const next = existingIndex >= 0 ? { ...chunks[existingIndex], ...update } : { ...create };
        if (existingIndex >= 0) {
          chunks[existingIndex] = next;
        } else {
          chunks.push(next);
        }
        return Promise.resolve(next);
      }),
      findMany: jest.fn().mockImplementation(({ where }) => {
        if (where?.documentId) {
          return Promise.resolve(chunks.filter((chunk) => chunk.documentId === where.documentId));
        }
        return Promise.resolve(chunks);
      }),
      deleteMany: jest.fn().mockImplementation(({ where }) => {
        if (where?.documentId) {
          for (let index = chunks.length - 1; index >= 0; index -= 1) {
            if (chunks[index].documentId === where.documentId) {
              chunks.splice(index, 1);
            }
          }
        } else if (where?.id?.in) {
          for (let index = chunks.length - 1; index >= 0; index -= 1) {
            if (where.id.in.includes(chunks[index].id)) {
              chunks.splice(index, 1);
            }
          }
        }
        return Promise.resolve({ count: 0 });
      }),
    },
    chunkVersion: {
      create: jest.fn().mockResolvedValue({ id: 'chunk-version-1' }),
    },
    validationReport: {
      create: jest.fn().mockResolvedValue({ id: 'validation-report-1' }),
    },
    knowledgeBase: {
      update: jest.fn().mockResolvedValue({ id: 'kb-1' }),
    },
  };
}

function createQdrantMock() {
  return {
    collectionExists: jest.fn().mockResolvedValue(false),
    createCollection: jest.fn().mockResolvedValue(undefined),
    upsertVectors: jest.fn().mockResolvedValue(undefined),
    setPayloads: jest.fn().mockResolvedValue(undefined),
    deleteByChunkIds: jest.fn().mockResolvedValue(undefined),
    deleteBySourceRevisionId: jest.fn().mockResolvedValue(undefined),
    countBySourceRevisionId: jest.fn().mockResolvedValue(10_000),
  };
}

function stableDocumentId(sourceId: string, relativePath: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(`${sourceId}:${relativePath}`, 'utf8').digest('hex').slice(0, 32);
}

function stableChunkId(documentId: string, chunkIndex: number): string {
  const crypto = require('crypto');
  const value = crypto.createHash('sha256').update(`${documentId}:${chunkIndex}`, 'utf8').digest('hex').slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function hashText(text: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function fileEntry(relativePath: string, absolutePath: string) {
  const stats = fs.statSync(absolutePath);
  return {
    relativePath,
    absolutePath,
    size: stats.size,
    mtime: stats.mtime,
  };
}
