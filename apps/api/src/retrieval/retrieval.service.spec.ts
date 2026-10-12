import { BadRequestException } from '@nestjs/common';
import { ProviderType } from '@prisma/client';
import { ProvidersService } from '../providers/providers.service';
import { RetrievalService } from './retrieval.service';

describe('RetrievalService', () => {
  it('returns documented general search response shape', async () => {
    const service = createService({
      hits: [
        {
          id: 'point-1',
          score: 0.9,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            indexVersionId: 'old-index',
            text: 'hello search',
            startLine: 2,
            endLine: 4,
            metadata: {
              sourceId: 'source-1',
              path: 'docs/readme.md',
              language: 'markdown',
            },
          },
        },
      ],
    });

    await expect(service.search('career-rag', { query: 'hello', topK: 5 })).resolves.toEqual({
      knowledgeBaseId: 'kb-1',
      indexVersionId: 'index-1',
      retrievalProfile: expect.objectContaining({
        key: 'default',
        denseTopK: 10,
      }),
      count: 1,
      results: [
        expect.objectContaining({
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          score: 0.9,
          text: 'hello search',
          path: 'docs/readme.md',
          language: 'markdown',
          startLine: 2,
          endLine: 4,
          metadata: expect.objectContaining({ indexVersionId: 'index-1' }),
        }),
      ],
    });
  });

  it('passes active source revisions before topK and rejects a superseded dense point', async () => {
    const service = createService({
      hits: [
        {
          id: 'active',
          score: 0.9,
          payload: {
            documentId: 'doc-a',
            chunkId: 'chunk-a',
            indexVersionId: 'index-a',
            sourceRevisionId: 'revision-a1',
            text: 'active A',
            metadata: { path: 'docs/a.md' },
          },
        },
        {
          id: 'old-b',
          score: 0.99,
          payload: {
            documentId: 'doc-b',
            chunkId: 'chunk-old-b',
            indexVersionId: 'index-b',
            sourceRevisionId: 'revision-b1',
            text: 'superseded B',
            metadata: { path: 'docs/b.md' },
          },
        },
      ],
    }) as any;

    const result = await service.search('career-rag', { query: 'source', topK: 1, filters: { pathPrefix: 'docs/' } });

    expect(result.results.map((item: any) => item.chunkId)).toEqual(['chunk-a']);
    expect(service.__vectorIndex.search).toHaveBeenCalledWith(
      'kb-kb-1',
      expect.any(Array),
      1,
      undefined,
      expect.objectContaining({ sourceRevisionIds: ['revision-a1'], pathPrefix: 'docs/' }),
      'backend-1',
    );
  });

  it('returns a clear error when there is no active index', async () => {
    const service = createService({
      knowledgeBase: {
        id: 'kb-1',
        name: 'Empty KB',
        activeIndexVersionId: null,
      },
    });

    await expect(service.search('kb-1', { query: 'hello' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters code search by payload metadata instead of chunk text', async () => {
    const service = createService({
      hits: [
        {
          id: 'point-1',
          score: 0.8,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            indexVersionId: 'index-1',
            text: 'function run() {}',
            metadata: {
              path: 'src/run.ts',
              language: 'typescript',
              branch: 'main',
            },
          },
        },
        {
          id: 'point-2',
          score: 0.7,
          payload: {
            documentId: 'doc-2',
            chunkId: 'chunk-2',
            indexVersionId: 'index-1',
            text: 'typescript appears in prose only',
            metadata: {
              path: 'docs/run.md',
              language: 'markdown',
              branch: 'main',
            },
          },
        },
      ],
    });

    const response = await service.searchCode('kb-1', {
      query: 'run',
      topK: 10,
      filters: {
        pathPrefix: 'src/',
        language: 'typescript',
        branch: 'main',
      },
    });

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      chunkId: 'chunk-1',
      path: 'src/run.ts',
      language: 'typescript',
    });
    expect(response.retrievalProfile).toMatchObject({
      key: 'default',
    });
  });

  it('builds a grouped context package with neighbor expansion and diagnostics', async () => {
    const service = createService({
      knowledgeBase: {
        id: 'kb-1',
        name: 'Code KB',
        activeIndexVersionId: 'index-1',
        defaultRetrievalProfile: 'code-debug',
      },
      retrievalProfile: null,
      hits: [
        {
          id: 'point-1',
          score: 0.91,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-2',
            indexVersionId: 'index-1',
            text: 'main function body',
            tokenCount: 40,
            chunkIndex: 2,
            metadata: {
              path: 'src/run.ts',
              language: 'typescript',
            },
          },
        },
      ],
      chunk: {
        id: 'chunk-2',
        documentId: 'doc-1',
        indexVersionId: 'index-1',
        chunkIndex: 2,
        text: 'main function body',
        metadata: { path: 'src/run.ts', language: 'typescript' },
      },
      neighborChunks: [
        {
          id: 'chunk-1',
          documentId: 'doc-1',
          indexVersionId: 'index-1',
          chunkIndex: 1,
          text: 'helper setup',
          tokenCount: 20,
          startLine: 1,
          endLine: 3,
          metadata: { path: 'src/run.ts', language: 'typescript' },
        },
        {
          id: 'chunk-3',
          documentId: 'doc-1',
          indexVersionId: 'index-1',
          chunkIndex: 3,
          text: 'cleanup',
          tokenCount: 10,
          startLine: 12,
          endLine: 14,
          metadata: { path: 'src/run.ts', language: 'typescript' },
        },
      ],
    });

    const result = await service.getContextPackage('career-rag', {
      query: 'how run works',
      profileKey: 'code-debug',
      tokenBudget: 200,
    });

    expect(result.retrievalProfile).toMatchObject({
      key: 'code-debug',
      grouping: 'path',
      neighborBefore: 1,
      neighborAfter: 1,
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      title: 'src/run.ts',
      kind: 'code',
    });
    expect(result.groups[0].items).toHaveLength(3);
    expect(result.diagnostics).toMatchObject({
      denseCandidates: 1,
      reranked: false,
      expandedNeighbors: 2,
      neighborExpansionQueries: 2,
      droppedDuplicates: 0,
    });
    expect((service as any).__prisma.chunk.findUnique).not.toHaveBeenCalled();
  });

  it('trims the first oversized context item instead of admitting it over budget', async () => {
    const service = createService({
      hits: [
        {
          id: 'point-large',
          score: 0.9,
          payload: {
            documentId: 'doc-large',
            chunkId: 'chunk-large',
            indexVersionId: 'index-1',
            text: 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta eta theta iota kappa lambda',
            startLine: 10,
            endLine: 15,
            metadata: { path: 'docs/large.md' },
          },
        },
      ],
    });

    const result = await service.getContextPackage('career-rag', {
      query: 'alpha',
      tokenBudget: 5,
    });

    expect(result.budget.estimatedTokens).toBeLessThanOrEqual(result.diagnostics.budget.retrievalBudgetTokens);
    expect(result.diagnostics.budget).toMatchObject({
      tokenizer: expect.objectContaining({ id: 'contextforge-approx-v1', approximate: true }),
      trimmedItems: 1,
      droppedItems: 0,
      budgetReason: 'retrieval_budget_exhausted',
    });
    expect(result.groups[0].items[0].metadata).toMatchObject({
      budgetTrimmed: true,
      originalTokenCount: expect.any(Number),
      originalStartLine: 10,
      originalEndLine: 15,
    });
    expect(result.groups[0].items[0].startLine).toBe(10);
    expect(result.groups[0].items[0].endLine).toBeLessThanOrEqual(15);
    expect(result.groups[0].items[0].metadata.endLine).toBe(result.groups[0].items[0].endLine);
  });

  it('returns clamped chunk context for a document', async () => {
    const service = createService({
      document: {
        id: 'doc-1',
        path: 'docs/readme.md',
        mimeType: 'text/markdown',
        metadata: { path: 'docs/readme.md' },
      },
      latestDocumentVersion: {
        id: 'docv-1',
        normalizedText: 'unused',
      },
      chunk: {
        id: 'chunk-1',
        documentId: 'doc-1',
        indexVersionId: 'index-1',
        chunkIndex: 3,
        text: 'Chunk context text',
        startLine: 10,
        endLine: 12,
        metadata: { language: 'markdown' },
      },
    });

    await expect(
      service.getDocumentContext({
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        maxChars: 5,
      }),
    ).resolves.toEqual({
      documentId: 'doc-1',
      path: 'docs/readme.md',
      text: 'Chunk',
      metadata: expect.objectContaining({
        chunkId: 'chunk-1',
        chunkIndex: 3,
        startLine: 10,
        endLine: 12,
        language: 'markdown',
      }),
    });
  });

  it('returns a line range from normalized document text', async () => {
    const service = createService({
      document: {
        id: 'doc-1',
        path: 'docs/readme.md',
        metadata: {},
      },
      latestDocumentVersion: {
        id: 'docv-1',
        normalizedText: 'one\ntwo\nthree\nfour',
      },
    });

    await expect(
      service.getDocumentContext({
        documentId: 'doc-1',
        startLine: 2,
        endLine: 3,
      }),
    ).resolves.toEqual({
      documentId: 'doc-1',
      path: 'docs/readme.md',
      text: 'two\nthree',
      metadata: expect.objectContaining({
        startLine: 2,
        endLine: 3,
      }),
    });
  });

  it('rejects incomplete line range requests', async () => {
    const service = createService({
      document: {
        id: 'doc-1',
        path: 'docs/readme.md',
        metadata: {},
      },
    });

    await expect(
      service.getDocumentContext({
        documentId: 'doc-1',
        startLine: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns neighboring chunks around a target chunk', async () => {
    const service = createService({
      chunk: {
        id: 'chunk-2',
        documentId: 'doc-1',
        indexVersionId: 'index-1',
        chunkIndex: 2,
        text: 'middle',
        metadata: {},
      },
      neighborChunks: [
        {
          id: 'chunk-1',
          chunkIndex: 1,
          text: 'before',
          startLine: 1,
          endLine: 3,
          metadata: { path: 'src/a.ts' },
        },
        {
          id: 'chunk-3',
          chunkIndex: 3,
          text: 'after',
          startLine: 8,
          endLine: 10,
          metadata: { path: 'src/a.ts' },
        },
      ],
    });

    await expect(service.getChunkNeighbors('chunk-2', 1, 1)).resolves.toEqual({
      chunkId: 'chunk-2',
      neighbors: [
        expect.objectContaining({
          chunkId: 'chunk-1',
          chunkIndex: 1,
          text: 'before',
        }),
        expect.objectContaining({
          chunkId: 'chunk-3',
          chunkIndex: 3,
          text: 'after',
        }),
      ],
    });
  });

  it('searches memory entries without relying on file indexing', async () => {
    const service = createService({
      knowledgeBase: {
        id: 'kb-1',
        name: 'Agent Memory',
        activeIndexVersionId: 'index-1',
        defaultRetrievalProfile: 'memory-recall',
      },
      retrievalProfile: {
        id: 'rp-memory',
        knowledgeBaseId: 'kb-1',
        key: 'memory-recall',
        name: 'Memory Recall',
        intent: 'memory_search',
        denseTopK: 5,
        scoreThreshold: null,
        neighborBefore: 0,
        neighborAfter: 0,
        tokenBudget: null,
        grouping: 'document',
        recencyBoost: true,
      },
      memoryEntries: [
        {
          id: 'mem-1',
          entryType: 'decision',
          title: 'Use streamable HTTP for remote MCP',
          summary: 'Hermes needs a network transport',
          body: 'We added MCP over HTTP because Hermes runs on another machine.',
          tags: ['mcp', 'hermes'],
          authoredBy: 'agent',
          sessionId: 'session-1',
          occurredAt: new Date('2026-05-24T10:00:00.000Z'),
          createdAt: new Date('2026-05-24T10:05:00.000Z'),
          metadata: {},
        },
        {
          id: 'mem-archived',
          entryType: 'decision',
          title: 'Archived Hermes note',
          body: 'Hermes archived note should not appear.',
          tags: ['mcp'],
          authoredBy: 'agent',
          sessionId: 'session-1',
          occurredAt: new Date('2026-05-25T10:00:00.000Z'),
          createdAt: new Date('2026-05-25T10:05:00.000Z'),
          metadata: { lifecycleStatus: 'archived' },
        },
      ],
    });

    const result = await service.searchMemory('career-rag', {
      query: 'Hermes',
      topK: 5,
      profileKey: 'memory-recall',
    });

    expect(result.retrievalProfile).toMatchObject({
      key: 'memory-recall',
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      id: 'mem-1',
      entryType: 'decision',
      title: 'Use streamable HTTP for remote MCP',
    });
    expect((service as any).__prisma.memoryEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          knowledgeBaseId: 'kb-1',
          OR: expect.arrayContaining([{ body: { contains: 'Hermes', mode: 'insensitive' } }]),
        }),
        take: 100,
      }),
    );
  });

  it('returns recent decisions from memory entries', async () => {
    const service = createService({
      memoryEntries: [
        {
          id: 'mem-archived',
          entryType: 'decision',
          title: 'Archived decision',
          body: '...',
          tags: [],
          createdAt: new Date('2026-05-25T00:00:00.000Z'),
          occurredAt: null,
          metadata: { lifecycleStatus: 'archived' },
        },
        {
          id: 'mem-1',
          entryType: 'decision',
          title: 'Decision one',
          body: '...',
          tags: [],
          createdAt: new Date(),
          occurredAt: null,
          metadata: {},
        },
      ],
    });

    await expect(service.getRecentDecisions('career-rag', 3)).resolves.toEqual({
      knowledgeBaseId: 'kb-1',
      results: [
        expect.objectContaining({
          id: 'mem-1',
          entryType: 'decision',
        }),
      ],
      count: 1,
    });
  });

  it('returns retrieval trace stages and final context package diagnostics', async () => {
    const service = createService({
      knowledgeBase: {
        id: 'kb-1',
        name: 'Code KB',
        activeIndexVersionId: 'index-1',
        defaultRetrievalProfile: 'code-debug',
      },
      retrievalProfile: {
        id: 'rp-code',
        knowledgeBaseId: 'kb-1',
        key: 'code-debug',
        name: 'Code Debug',
        intent: 'code_search',
        denseTopK: 8,
        scoreThreshold: null,
        neighborBefore: 1,
        neighborAfter: 1,
        tokenBudget: 1200,
        grouping: 'path',
        recencyBoost: false,
      },
      hits: [
        {
          id: 'point-1',
          score: 0.94,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-2',
            indexVersionId: 'index-1',
            text: 'main body',
            tokenCount: 30,
            chunkIndex: 2,
            metadata: {
              path: 'src/run.ts',
              language: 'typescript',
            },
          },
        },
      ],
      chunk: {
        id: 'chunk-2',
        documentId: 'doc-1',
        indexVersionId: 'index-1',
        chunkIndex: 2,
        text: 'main body',
        metadata: { path: 'src/run.ts', language: 'typescript' },
      },
      neighborChunks: [
        {
          id: 'chunk-3',
          documentId: 'doc-1',
          indexVersionId: 'index-1',
          chunkIndex: 3,
          text: 'cleanup',
          tokenCount: 20,
          startLine: 10,
          endLine: 12,
          metadata: { path: 'src/run.ts', language: 'typescript' },
        },
      ],
    });

    const result = await service.traceRetrieval('career-rag', {
      query: 'how does run work',
      profileKey: 'code-debug',
      tokenBudget: 200,
      filters: {
        language: 'typescript',
      },
    });

    expect(result.stages.denseCandidates).toHaveLength(1);
    expect(result.stages.filteredCandidates).toHaveLength(1);
    expect(result.stages.expandedCandidates).toHaveLength(2);
    expect(result.contextPackage.count).toBe(2);
    expect(result.diagnostics).toMatchObject({
      denseCandidates: 1,
      lexicalCandidates: 0,
      mergedCandidates: 1,
      filteredCandidates: 1,
      expandedNeighbors: 1,
      neighborExpansionQueries: 2,
      finalCount: 2,
      reranked: false,
    });
  });

  it('applies answer reserves on the fresh-workspace fallback profile within the hard budget', async () => {
    const service = createService({
      retrievalProfile: null,
      hits: [
        {
          id: 'point-1',
          score: 0.9,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            indexVersionId: 'index-1',
            sourceRevisionId: 'revision-a1',
            text: 'PostgreSQL owns canonical application state.',
            metadata: {
              sourceRevisionId: 'revision-a1',
              path: 'docs/truth.md',
            },
          },
        },
      ],
    });

    const result = await service.traceRetrieval(
      'career-rag',
      { query: 'Where is canonical state?' },
      {
        systemTokens: 50,
        instructionTokens: 10,
        outputTokens: 1024,
        safetyTokens: 32,
      },
    );

    const budget = result.diagnostics.budget;
    const totalReserved = Object.values(budget.reservedTokens as Record<string, number>).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect((service as any).__prisma.retrievalProfile.findFirst).toHaveBeenCalledWith({
      where: { knowledgeBaseId: 'kb-1', key: 'default' },
    });
    expect(result.retrievalProfile.key).toBe('default');
    expect(result.contextPackage.count).toBe(1);
    expect(budget.reservedTokens).toMatchObject({
      system: 50,
      instruction: 10,
      output: 1024,
      safety: 32,
    });
    expect(budget.reservedTokens.output).toBeGreaterThan(0);
    expect(totalReserved + budget.retrievalBudgetTokens).toBe(budget.requestedTokens);
    expect(budget.usedTokens).toBeLessThanOrEqual(budget.retrievalBudgetTokens);
  });

  it('caps answer reserves at an explicit hard budget', async () => {
    const service = createService({ retrievalProfile: null });

    const result = await service.traceRetrieval(
      'career-rag',
      { query: 'budget', tokenBudget: 100 },
      {
        systemTokens: 20,
        instructionTokens: 10,
        outputTokens: 500,
        safetyTokens: 20,
      },
    );

    const budget = result.diagnostics.budget;
    expect(budget.requestedTokens).toBe(100);
    expect(budget.reservedTokens.output).toBe(49);
    expect(budget.retrievalBudgetTokens).toBe(0);
    expect(Object.values(budget.reservedTokens as Record<string, number>).reduce((sum, value) => sum + value, 0)).toBe(
      100,
    );
  });

  it.each([0, -10])(
    'does not admit answer or retrieval tokens for an explicit invalid budget of %s',
    async (tokenBudget) => {
      const service = createService({
        retrievalProfile: null,
        hits: [
          {
            id: 'point-1',
            score: 0.9,
            payload: {
              documentId: 'doc-1',
              chunkId: 'chunk-1',
              indexVersionId: 'index-1',
              text: 'must not fit',
              metadata: { path: 'docs/truth.md' },
            },
          },
        ],
      });

      const result = await service.traceRetrieval(
        'career-rag',
        { query: 'budget', tokenBudget },
        {
          systemTokens: 20,
          instructionTokens: 10,
          outputTokens: 100,
          safetyTokens: 20,
        },
      );

      expect(result.contextPackage.count).toBe(0);
      expect(result.diagnostics.budget).toMatchObject({
        requestedTokens: 0,
        reservedTokens: {
          system: 0,
          instruction: 0,
          query: 0,
          output: 0,
          safety: 0,
        },
        retrievalBudgetTokens: 0,
        budgetReason: 'reserved_tokens_exhausted_budget',
      });
    },
  );

  it('keeps exact dedupe scoped by source revision', async () => {
    const service = createService({
      sourceRevisionIds: ['revision-a1', 'revision-b1'],
      hits: [
        {
          id: 'point-a',
          score: 0.9,
          payload: {
            documentId: 'doc-1',
            chunkId: 'shared-chunk',
            indexVersionId: 'index-1',
            sourceRevisionId: 'revision-a1',
            text: 'same chunk id from revision A',
            metadata: { sourceRevisionId: 'revision-a1', path: 'docs/a.md' },
          },
        },
        {
          id: 'point-b',
          score: 0.8,
          payload: {
            documentId: 'doc-1',
            chunkId: 'shared-chunk',
            indexVersionId: 'index-1',
            sourceRevisionId: 'revision-b1',
            text: 'same chunk id from revision B',
            metadata: { sourceRevisionId: 'revision-b1', path: 'docs/b.md' },
          },
        },
      ],
    });

    const result = await service.traceRetrieval('career-rag', {
      query: 'revision',
      topK: 5,
    });

    expect(result.stages.dedupedCandidates.map((item) => item.metadata.sourceRevisionId)).toEqual([
      'revision-a1',
      'revision-b1',
    ]);
    expect(result.diagnostics.droppedDuplicates).toBe(0);
  });

  it('suppresses near duplicates after rerank and reports the drop', async () => {
    const repeatedText = 'repeatable context paragraph '.repeat(20);
    const service = createService({
      hits: [
        {
          id: 'point-1',
          score: 0.9,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            indexVersionId: 'index-1',
            sourceRevisionId: 'revision-a1',
            text: repeatedText,
            metadata: { sourceRevisionId: 'revision-a1', path: 'docs/a.md' },
          },
        },
        {
          id: 'point-2',
          score: 0.8,
          payload: {
            documentId: 'doc-2',
            chunkId: 'chunk-2',
            indexVersionId: 'index-1',
            sourceRevisionId: 'revision-a1',
            text: `${repeatedText} trailing words`,
            metadata: { sourceRevisionId: 'revision-a1', path: 'docs/b.md' },
          },
        },
      ],
    });

    const result = await service.traceRetrieval('career-rag', {
      query: 'repeatable',
      topK: 5,
    });

    expect(result.stages.rerankedCandidates).toHaveLength(2);
    expect(result.stages.nearDedupedCandidates).toHaveLength(1);
    expect(result.diagnostics.droppedNearDuplicates).toBe(1);
  });

  it('keeps dense-only retrieval usable when lexical search is not enabled', async () => {
    const service = createService({
      hits: [
        {
          id: 'point-1',
          score: 0.82,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            indexVersionId: 'index-1',
            text: 'dense result',
            metadata: { path: 'docs/a.md' },
          },
        },
      ],
      lexicalChunks: [
        {
          id: 'chunk-lexical',
          documentId: 'doc-2',
          indexVersionId: 'index-1',
          chunkIndex: 1,
          text: 'lexical term',
          metadata: { path: 'docs/lexical.md' },
        },
      ],
    });

    const result = await service.traceRetrieval('career-rag', {
      query: 'lexical term',
      topK: 5,
    });

    expect(result.stages.lexicalCandidates).toHaveLength(0);
    expect(result.stages.mergedCandidates).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({
      denseCandidates: 1,
      lexicalCandidates: 0,
      reranked: false,
      rerankerFallbackUsed: false,
    });
  });

  it('merges lexical candidates when the retrieval profile opts into hybrid search', async () => {
    const service = createService({
      retrievalProfile: {
        id: 'rp-hybrid',
        knowledgeBaseId: 'kb-1',
        key: 'hybrid',
        name: 'Hybrid',
        intent: 'code_search',
        denseTopK: 5,
        scoreThreshold: null,
        neighborBefore: 0,
        neighborAfter: 0,
        tokenBudget: null,
        grouping: 'path',
        recencyBoost: false,
        metadata: {
          lexicalEnabled: true,
          lexicalTopK: 5,
          denseWeight: 0.6,
          lexicalWeight: 0.4,
        },
      },
      hits: [
        {
          id: 'point-dense',
          score: 0.9,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-dense',
            indexVersionId: 'index-1',
            text: 'semantic result',
            metadata: { path: 'docs/semantic.md' },
          },
        },
      ],
      lexicalChunks: [
        {
          id: 'chunk-lexical',
          documentId: 'doc-2',
          indexVersionId: 'index-1',
          chunkIndex: 1,
          text: 'exact IdentifierName appears here',
          tokenCount: 12,
          startLine: 5,
          endLine: 8,
          metadata: { path: 'src/identifier.ts', language: 'typescript' },
        },
      ],
    });

    const result = await service.traceRetrieval('career-rag', {
      query: 'IdentifierName',
      profileKey: 'hybrid',
      topK: 5,
    });

    expect(result.retrievalProfile).toMatchObject({
      key: 'hybrid',
      lexicalEnabled: true,
      lexicalTopK: 5,
    });
    expect(result.stages.lexicalCandidates).toHaveLength(1);
    expect(result.stages.mergedCandidates.map((candidate) => candidate.chunkId)).toEqual([
      'chunk-dense',
      'chunk-lexical',
    ]);
    expect(result.stages.lexicalCandidates[0].metadata).toMatchObject({
      lexicalScore: expect.any(Number),
      retrievalSources: ['lexical'],
    });
    expect((service as any).__prisma.$queryRaw).toHaveBeenCalled();
    expect((service as any).__prisma.chunk.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.any(Array),
        }),
      }),
    );
    expect(result.diagnostics).toMatchObject({
      denseCandidates: 1,
      lexicalCandidates: 1,
      mergedCandidates: 2,
    });
  });

  it('serves the simple lexical preset without dense provider or placement access', async () => {
    const service = createService({
      indexVersion: {
        id: 'index-1',
        status: 'active',
        lifecycleStatus: 'unloaded',
        vectorCollectionName: 'unused-for-lexical',
      },
      retrievalProfile: null,
      lexicalChunks: [
        {
          id: 'chunk-lexical',
          documentId: 'doc-lexical',
          indexVersionId: 'index-1',
          chunkIndex: 0,
          text: 'exact lexical identifier',
          tokenCount: 4,
          metadata: { path: 'docs/lexical.md' },
        },
      ],
    });

    const result = await service.traceRetrieval('career-rag', {
      query: 'exact lexical identifier',
      profileKey: 'lexical',
      topK: 5,
    });

    expect(result.stages.denseCandidates).toEqual([]);
    expect(result.stages.lexicalCandidates).toHaveLength(1);
    expect(result.stages.mergedCandidates).toHaveLength(1);
    expect(result.retrievalProfile).toMatchObject({
      key: 'lexical',
      lexicalEnabled: true,
    });
    expect(result.diagnostics).toMatchObject({
      denseCandidates: 0,
      lexicalCandidates: 1,
    });
    expect(result.diagnostics.serving).toMatchObject({
      vectorBackendId: 'lexical-only',
      collectionName: 'lexical-only',
    });
    expect((service as any).__embeddings.resolveProvider).not.toHaveBeenCalled();
    expect((service as any).__embeddings.embedTexts).not.toHaveBeenCalled();
    expect((service as any).__vectorIndex.search).not.toHaveBeenCalled();
    expect((service as any).__placement.resolveForKnowledgeBase).not.toHaveBeenCalled();
  });

  it('reranks merged candidates when a reranker provider succeeds', async () => {
    const service = createService({
      retrievalProfile: {
        id: 'rp-rerank',
        knowledgeBaseId: 'kb-1',
        key: 'rerank',
        name: 'Rerank',
        intent: 'general_search',
        denseTopK: 5,
        scoreThreshold: null,
        neighborBefore: 0,
        neighborAfter: 0,
        tokenBudget: null,
        grouping: 'document',
        recencyBoost: false,
        metadata: {
          rerankerProviderId: 'reranker-1',
        },
      },
      hits: [
        {
          id: 'point-1',
          score: 0.9,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            indexVersionId: 'index-1',
            text: 'first dense result',
            metadata: { path: 'docs/first.md' },
          },
        },
        {
          id: 'point-2',
          score: 0.8,
          payload: {
            documentId: 'doc-2',
            chunkId: 'chunk-2',
            indexVersionId: 'index-1',
            text: 'better reranked result',
            metadata: { path: 'docs/second.md' },
          },
        },
      ],
      rerankerResolution: {
        requested: true,
        enabled: true,
        source: 'profile',
        providerConfigId: 'reranker-1',
        name: 'local-reranker',
        fallbackAllowed: true,
      },
      rerankRun: {
        reranked: true,
        fallbackUsed: false,
        candidateCount: 2,
        scores: [
          { id: 'chunk-1', score: 0.2 },
          { id: 'chunk-2', score: 0.95 },
        ],
      },
    });

    const result = await service.traceRetrieval('career-rag', {
      query: 'which result is better',
      profileKey: 'rerank',
    });

    expect(result.stages.rerankedCandidates.map((candidate) => candidate.chunkId)).toEqual(['chunk-2', 'chunk-1']);
    expect(result.diagnostics).toMatchObject({
      reranked: true,
      rerankerFallbackUsed: false,
      rerankerCandidateCount: 2,
    });
  });

  it('lets request overrides disable a profile reranker', async () => {
    const service = createService({
      retrievalProfile: {
        id: 'rp-rerank-disabled',
        knowledgeBaseId: 'kb-1',
        key: 'rerank-disabled',
        name: 'Rerank Disabled',
        intent: 'general_search',
        denseTopK: 5,
        scoreThreshold: null,
        neighborBefore: 0,
        neighborAfter: 0,
        tokenBudget: null,
        grouping: 'document',
        recencyBoost: false,
        metadata: {
          rerankerProviderName: 'local-reranker',
        },
      },
      hits: [
        {
          id: 'point-1',
          score: 0.9,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            indexVersionId: 'index-1',
            text: 'first dense result',
            metadata: { path: 'docs/first.md' },
          },
        },
      ],
      rerankerResolution: {
        requested: true,
        enabled: false,
        source: 'request',
        fallbackAllowed: true,
        reason: 'reranker_disabled_by_request',
      },
    });

    const result = await service.traceRetrieval('career-rag', {
      query: 'disable rerank',
      profileKey: 'rerank-disabled',
      rerank: { enabled: false },
    });

    expect((service as any).__providers.resolveRerankerProvider).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'rerank-disabled' }),
      { enabled: false },
    );
    expect(result.diagnostics).toMatchObject({
      reranked: false,
      rerankerReason: 'reranker_not_enabled',
      reranker: expect.objectContaining({
        source: 'request',
        reason: 'reranker_disabled_by_request',
      }),
    });
  });

  it('lets request overrides enable reranking for comparison', async () => {
    const service = createService({
      hits: [
        {
          id: 'point-1',
          score: 0.9,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            indexVersionId: 'index-1',
            text: 'first dense result',
            metadata: { path: 'docs/first.md' },
          },
        },
        {
          id: 'point-2',
          score: 0.8,
          payload: {
            documentId: 'doc-2',
            chunkId: 'chunk-2',
            indexVersionId: 'index-1',
            text: 'better reranked result',
            metadata: { path: 'docs/second.md' },
          },
        },
      ],
      rerankerResolution: {
        requested: true,
        enabled: true,
        source: 'request',
        providerConfigId: 'reranker-1',
        name: 'local-reranker',
        topN: 2,
        fallbackAllowed: true,
      },
      rerankRun: {
        reranked: true,
        fallbackUsed: false,
        candidateCount: 2,
        scores: [
          { id: 'chunk-1', score: 0.1 },
          { id: 'chunk-2', score: 0.95 },
        ],
      },
    });

    const result = await service.traceRetrieval('career-rag', {
      query: 'enable rerank',
      rerank: { enabled: true, providerName: 'local-reranker', topN: 2 },
    });

    expect((service as any).__providers.resolveRerankerProvider).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'default' }),
      { enabled: true, providerName: 'local-reranker', topN: 2 },
    );
    expect(result.stages.rerankedCandidates.map((candidate) => candidate.chunkId)).toEqual(['chunk-2', 'chunk-1']);
    expect(result.diagnostics).toMatchObject({
      reranked: true,
      rerankerCandidateCount: 2,
      reranker: expect.objectContaining({ source: 'request', topN: 2 }),
    });
  });

  it('keeps retrieval usable when reranker fallback is allowed', async () => {
    const service = createService({
      retrievalProfile: {
        id: 'rp-rerank-fallback',
        knowledgeBaseId: 'kb-1',
        key: 'rerank-fallback',
        name: 'Rerank Fallback',
        intent: 'general_search',
        denseTopK: 5,
        scoreThreshold: null,
        neighborBefore: 0,
        neighborAfter: 0,
        tokenBudget: null,
        grouping: 'document',
        recencyBoost: false,
        metadata: {
          rerankerProviderId: 'missing-reranker',
          rerankerFallbackAllowed: true,
        },
      },
      hits: [
        {
          id: 'point-1',
          score: 0.88,
          payload: {
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            indexVersionId: 'index-1',
            text: 'dense fallback result',
            metadata: { path: 'docs/fallback.md' },
          },
        },
      ],
      rerankerResolution: {
        requested: true,
        enabled: true,
        source: 'profile',
        providerConfigId: 'missing-reranker',
        name: 'missing-reranker',
        fallbackAllowed: true,
      },
      rerankRun: {
        reranked: false,
        fallbackUsed: true,
        reason: 'reranker_provider_not_found',
        candidateCount: 0,
        scores: [],
      },
    });

    const result = await service.getContextPackage('career-rag', {
      query: 'fallback',
      profileKey: 'rerank-fallback',
    });

    expect(result.groups[0].items[0]).toMatchObject({
      chunkId: 'chunk-1',
    });
    expect(result.diagnostics).toMatchObject({
      reranked: false,
      rerankerFallbackUsed: true,
      rerankerReason: 'reranker_provider_not_found',
    });
  });

  it('fails closed for the unsupported lexical reranker pairing', async () => {
    const service = createService({
      retrievalProfile: null,
      useActualProviders: true,
      providerConfigs: [
        {
          id: 'reranker-default',
          type: ProviderType.reranker,
          name: 'local-reranker',
          model: 'qwen-reranker',
          metadata: { default: true },
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      lexicalChunks: [
        {
          id: 'chunk-lexical',
          documentId: 'doc-lexical',
          indexVersionId: 'index-1',
          sourceRevisionId: 'revision-a1',
          text: 'lexical reranker result',
          score: 1,
          chunkIndex: 0,
          metadata: { path: 'docs/lexical.md' },
        },
      ],
    }) as any;

    await expect(
      service.traceRetrieval('career-rag', {
        query: 'lexical reranker',
        profileKey: 'lexical-structured-reranker',
      }),
    ).rejects.toMatchObject({ code: 'lexical_reranker_unsupported' });

    expect(service.__embeddings.embedTexts).not.toHaveBeenCalled();
    expect(service.__prisma.$queryRaw).not.toHaveBeenCalled();
    expect(service.__vectorIndex.search).not.toHaveBeenCalled();
    expect(service.__providers.rerankCandidates).not.toHaveBeenCalled();
  });

  function createService(options: {
    knowledgeBase?: any;
    indexVersion?: any;
    hits?: any[];
    sourceRevisionIds?: string[];
    lexicalChunks?: any[];
    pathDocuments?: any[];
    pathChunks?: any[];
    retrievalProfile?: any;
    document?: any;
    latestDocumentVersion?: any;
    chunk?: any;
    neighborChunks?: any[];
    memoryEntries?: any[];
    rerankerResolution?: any;
    rerankRun?: any;
    useActualProviders?: boolean;
    providerConfigs?: any[];
  }) {
    const lexicalRows = (options.lexicalChunks || []).map((chunk) => ({
      id: chunk.id,
      score: chunk.score ?? 1,
      documentId: chunk.documentId,
      indexVersionId: chunk.indexVersionId,
      sourceRevisionId: chunk.sourceRevisionId || chunk.metadata?.sourceRevisionId || 'revision-a1',
      text: chunk.text,
      tokenCount: chunk.tokenCount || 0,
      chunkIndex: chunk.chunkIndex,
      startLine: chunk.startLine ?? null,
      endLine: chunk.endLine ?? null,
      chunkMetadata: chunk.metadata || {},
      documentPath: chunk.metadata?.path || options.pathDocuments?.[0]?.path || 'docs/lexical.md',
      documentMetadata: options.pathDocuments?.[0]?.metadata || {},
    }));
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(lexicalRows),
      workspaceServingRevision: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'serving-1',
          status: 'active',
          manifestEntries: (options.sourceRevisionIds || ['revision-a1']).map((id) => ({
            sourceRevision: { id, status: 'ready' },
          })),
        }),
      },
      indexVersion: {
        findUnique: jest.fn().mockResolvedValue(
          options.indexVersion || {
            id: 'index-1',
            status: 'active',
            vectorCollectionName: 'kb-kb-1',
          },
        ),
      },
      document: {
        findUnique: jest.fn().mockResolvedValue(options.document || null),
        findMany: jest.fn().mockResolvedValue(options.pathDocuments || []),
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue(options.latestDocumentVersion || null),
      },
      chunk: {
        findUnique: jest.fn().mockResolvedValue(options.chunk || null),
        findMany: jest.fn().mockImplementation((args?: any) => {
          if (args?.where?.id?.in) {
            return Promise.resolve(options.chunk ? [options.chunk] : []);
          }
          if (args?.where?.OR?.some((item: any) => item.chunkIndex)) {
            return Promise.resolve(options.neighborChunks || []);
          }
          if (args?.where?.OR || args?.where?.AND) {
            return Promise.resolve(options.lexicalChunks || []);
          }
          if (args?.where?.documentId?.in) {
            return Promise.resolve(options.pathChunks || []);
          }
          return Promise.resolve(options.neighborChunks || []);
        }),
      },
      retrievalProfile: {
        findFirst: jest.fn().mockResolvedValue(
          options.retrievalProfile === undefined
            ? {
                id: 'rp-1',
                knowledgeBaseId: 'kb-1',
                key: 'default',
                name: 'Default Retrieval',
                intent: 'general_search',
                denseTopK: 10,
                scoreThreshold: null,
                neighborBefore: 0,
                neighborAfter: 0,
                tokenBudget: null,
                grouping: 'document',
                recencyBoost: false,
                metadata: {},
              }
            : options.retrievalProfile,
        ),
      },
      memoryEntry: {
        findMany: jest.fn().mockResolvedValue(options.memoryEntries || []),
      },
      providerConfig: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue(options.providerConfigs || []),
      },
    };
    const embeddings = {
      resolveProvider: jest.fn().mockResolvedValue({
        source: 'environment',
        name: 'environment',
        baseUrl: 'http://embedding.local/v1',
        model: 'test-embedding',
        dimension: 3,
        apiKey: 'test-key',
        apiKeyRef: 'EMBEDDING_API_KEY',
        timeoutMs: 1000,
        protocol: 'openai_compatible',
      }),
      embedTexts: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };
    const knowledgeBases = {
      resolveIdentifier: jest.fn().mockImplementation(async (identifier: string) => {
        if (identifier !== 'kb-1' && identifier !== 'career-rag') {
          throw new Error(`Unexpected knowledge base identifier: ${identifier}`);
        }

        return {
          id: 'kb-1',
          name: 'Test KB',
          activeIndexVersionId: 'index-1',
          activeServingRevisionId: 'serving-1',
          defaultRetrievalProfile: 'default',
          ...(options.knowledgeBase || {}),
        };
      }),
    };
    const vectorIndex = {
      search: jest.fn().mockResolvedValue(options.hits || []),
    };
    const providers = {
      resolveRerankerProvider: jest.fn().mockResolvedValue(
        options.rerankerResolution || {
          requested: false,
          enabled: false,
          source: 'none',
          fallbackAllowed: true,
          reason: 'no_reranker_configured',
        },
      ),
      rerankCandidates: jest.fn().mockResolvedValue(
        options.rerankRun || {
          reranked: false,
          fallbackUsed: false,
          reason: 'reranker_not_enabled',
          candidateCount: 0,
          scores: [],
        },
      ),
    };
    const resolvedProviders = options.useActualProviders
      ? new ProvidersService(prisma as any, { get: jest.fn() } as any)
      : providers;
    if (options.useActualProviders) {
      jest.spyOn(resolvedProviders as ProvidersService, 'rerankCandidates').mockResolvedValue({
        reranked: false,
        fallbackUsed: false,
        reason: 'test_default',
        candidateCount: 0,
        scores: [],
      });
    }
    const placement = {
      resolveForKnowledgeBase: jest.fn().mockResolvedValue({
        vectorBackendId: 'backend-1',
        servingRevisionId: 'serving-1',
        physicalCollectionName: 'kb-kb-1',
        collectionAlias: 'workspace-career-rag',
        activeIndexBuildId: 'build-1',
        state: 'loaded',
      }),
    };

    return Object.assign(
      new RetrievalService(
        prisma as any,
        knowledgeBases as any,
        embeddings as any,
        vectorIndex as any,
        resolvedProviders as any,
        placement as any,
      ),
      { __prisma: prisma },
      { __embeddings: embeddings },
      { __providers: resolvedProviders },
      { __vectorIndex: vectorIndex },
      { __placement: placement },
    );
  }
});
