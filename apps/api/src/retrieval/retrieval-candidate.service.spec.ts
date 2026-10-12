import { RetrievalCandidateService } from './retrieval-candidate.service';

describe('RetrievalCandidateService lexical strategies', () => {
  it('keeps PostgreSQL FTS as a plain lexical score without structured boosts', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([lexicalRow(0.42)]),
    };
    const service = new RetrievalCandidateService(prisma as any, {} as any, {} as any);

    const [hit] = await service.retrieveLexicalCandidates(
      { id: 'kb-1' },
      { query: 'IdentifierName', topK: 5 },
      profile('pg-fts'),
      serving(),
    );

    expect(hit.score).toBe(0.42);
    expect(hit.payload.metadata).toMatchObject({
      lexicalScore: 0.42,
      lexicalStrategy: 'pg-fts',
      retrievalSources: ['lexical'],
    });
  });

  it('retains path and identifier boosts only for the structured strategy', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([lexicalRow(0.42)]),
    };
    const service = new RetrievalCandidateService(prisma as any, {} as any, {} as any);

    const [hit] = await service.retrieveLexicalCandidates(
      { id: 'kb-1' },
      { query: 'IdentifierName', topK: 5 },
      profile('structured'),
      serving(),
    );

    expect(hit.score).toBeGreaterThan(0.42);
    expect(hit.payload.metadata).toMatchObject({ lexicalStrategy: 'structured' });
  });

  it('scores BM25 from the revision-scoped corpus and provides stable ties', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([lexicalRowWithText('chunk-b', 'alpha', 1), lexicalRowWithText('chunk-a', 'alpha', 1)]),
    };
    const service = new RetrievalCandidateService(
      prisma as any,
      { resolveProvider: jest.fn() } as any,
      {
        search: jest.fn(),
      } as any,
    );

    const hits = await service.retrieveLexicalCandidates(
      { id: 'kb-1' },
      { query: 'alpha', topK: 5 },
      profile('bm25'),
      serving(),
    );

    expect(hits.map((hit) => hit.id)).toEqual(['chunk-a', 'chunk-b']);
    expect(hits[0].payload.metadata).toMatchObject({
      lexicalStrategy: 'bm25',
      bm25K1: 1.2,
      bm25B: 0.75,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('re-reads active rows after a deletion instead of serving a warm stale corpus', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([lexicalRowWithText('chunk-old', 'alpha', 1)])
        .mockResolvedValueOnce([]),
    };
    const service = new RetrievalCandidateService(prisma as any, {} as any, {} as any);

    await expect(
      service.retrieveLexicalCandidates({ id: 'kb-1' }, { query: 'alpha', topK: 5 }, profile('bm25'), serving()),
    ).resolves.toHaveLength(1);
    await expect(
      service.retrieveLexicalCandidates({ id: 'kb-1' }, { query: 'alpha', topK: 5 }, profile('bm25'), serving()),
    ).resolves.toHaveLength(0);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('serves BM25F through the lexical product path with frozen grid metadata', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { ...lexicalRowWithText('chunk-title', 'body', 1), documentMetadata: { title: 'needle' } },
        { ...lexicalRowWithText('chunk-body', 'needle', 1), documentMetadata: {} },
      ]),
    };
    const service = new RetrievalCandidateService(prisma as any, {} as any, {} as any);

    const hits = await service.retrieveLexicalCandidates(
      { id: 'kb-1' },
      { query: 'needle', topK: 5 },
      profile('bm25f'),
      serving(),
    );

    expect(hits).toHaveLength(2);
    expect(hits[0].payload.metadata).toMatchObject({
      lexicalStrategy: 'bm25f',
      bm25fWeightGrid: ['balanced', 'text-first', 'identifier-first'],
    });
  });
});

function profile(lexicalStrategy: 'pg-fts' | 'structured' | 'bm25' | 'bm25f') {
  return {
    knowledgeBaseId: 'kb-1',
    key: `lexical-${lexicalStrategy}`,
    name: lexicalStrategy,
    intent: 'general_search',
    denseTopK: 5,
    lexicalEnabled: true,
    lexicalTopK: 5,
    neighborBefore: 0,
    neighborAfter: 0,
    grouping: 'document',
    recencyBoost: false,
    metadata: { candidateStrategy: 'lexical', lexicalStrategy },
  } as any;
}

function serving() {
  return {
    servingRevisionId: 'serving-1',
    sourceRevisionIds: ['revision-1'],
    vectorBackendId: 'lexical-only',
    collectionName: 'lexical-only',
    filterPlacement: 'pre_topk' as const,
  };
}

function lexicalRow(score: number) {
  return {
    id: 'chunk-1',
    score,
    documentId: 'doc-1',
    indexVersionId: 'index-1',
    sourceRevisionId: 'revision-1',
    text: 'IdentifierName appears in this chunk',
    tokenCount: 6,
    chunkIndex: 0,
    startLine: null,
    endLine: null,
    chunkMetadata: { path: 'src/IdentifierName.ts' },
    documentPath: 'src/IdentifierName.ts',
    documentMetadata: {},
  };
}

function lexicalRowWithText(id: string, text: string, tokenCount: number) {
  return {
    ...lexicalRow(0),
    id,
    text,
    tokenCount,
  };
}
