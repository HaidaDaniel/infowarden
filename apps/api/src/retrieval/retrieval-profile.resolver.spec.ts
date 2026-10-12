import { RetrievalProfileResolver } from './retrieval-profile.resolver';

describe('RetrievalProfileResolver built-in lexical profiles', () => {
  it('keeps the compatibility default key while resolving it to dense retrieval', async () => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, 'default');

    expect(profile.metadata).toMatchObject({ candidateStrategy: 'dense' });
    expect(profile.lexicalEnabled).toBe(false);
  });

  it('resolves the simple lexical preset to the canonical BM25 configuration', async () => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, 'lexical');

    expect(profile.metadata).toMatchObject({
      candidateStrategy: 'lexical',
      lexicalEnabled: true,
      lexicalStrategy: 'bm25',
      bm25K1: 1.5,
      bm25B: 0.75,
    });
    expect(profile.lexicalEnabled).toBe(true);
  });

  it('resolves the simple hybrid preset to BM25 plus legacy fusion', async () => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, 'hybrid');

    expect(profile.metadata).toMatchObject({
      candidateStrategy: 'hybrid',
      lexicalEnabled: true,
      lexicalStrategy: 'bm25',
      bm25K1: 1.5,
      bm25B: 0.75,
      fusionStrategy: 'legacy-weighted-rank',
    });
    expect(profile.lexicalEnabled).toBe(true);
  });

  it('preserves an explicitly configured legacy hybrid profile', async () => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, 'hybrid-legacy');

    expect(profile.metadata).toMatchObject({
      candidateStrategy: 'hybrid',
      fusionStrategy: 'legacy-weighted-rank',
    });
    expect(profile.lexicalEnabled).toBe(true);
  });

  it('resolves lexical-pg-fts without a persisted profile', async () => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, 'lexical-pg-fts');

    expect(profile.metadata).toMatchObject({
      candidateStrategy: 'lexical',
      lexicalEnabled: true,
      lexicalStrategy: 'pg-fts',
    });
    expect(profile.lexicalEnabled).toBe(true);
  });

  it('normalizes a persisted lexical-structured profile without losing custom metadata', async () => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: {
        findFirst: jest.fn().mockResolvedValue({
          key: 'lexical-structured',
          name: 'Structured lexical',
          intent: 'general_search',
          denseTopK: 10,
          lexicalTopK: 10,
          neighborBefore: 0,
          neighborAfter: 0,
          grouping: 'document',
          recencyBoost: false,
          metadata: { lexicalTopK: 25, custom: 'preserved' },
        }),
      },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, 'lexical-structured');

    expect(profile.metadata).toMatchObject({
      candidateStrategy: 'lexical',
      lexicalStrategy: 'structured',
      custom: 'preserved',
    });
    expect(profile.lexicalTopK).toBe(25);
  });

  it('composes a built-in lexical profile with an independent reranker capability', async () => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, 'lexical-bm25-reranker');

    expect(profile.metadata).toMatchObject({
      candidateStrategy: 'lexical',
      lexicalStrategy: 'bm25',
      reranker: { enabled: true },
    });
  });

  it('bridges nested reranker settings to the existing provider metadata contract', async () => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: {
        findFirst: jest.fn().mockResolvedValue({
          key: 'hybrid-rrf',
          name: 'Hybrid RRF',
          intent: 'general_search',
          denseTopK: 10,
          lexicalTopK: 10,
          neighborBefore: 0,
          neighborAfter: 0,
          grouping: 'document',
          recencyBoost: false,
          metadata: {
            candidateStrategy: 'hybrid',
            fusionStrategy: 'rrf',
            reranker: { enabled: true, providerId: 'reranker-1', topN: 12 },
          },
        }),
      },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, 'hybrid-rrf');

    expect(profile.metadata).toMatchObject({
      reranker: { enabled: true, providerId: 'reranker-1', topN: 12 },
      rerankerProviderId: 'reranker-1',
      rerankerTopN: 12,
    });
  });

  it('makes a nested profile disable remove legacy reranker selectors', async () => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: {
        findFirst: jest.fn().mockResolvedValue({
          key: 'hybrid-rrf',
          name: 'Hybrid RRF',
          intent: 'general_search',
          denseTopK: 10,
          lexicalTopK: 10,
          neighborBefore: 0,
          neighborAfter: 0,
          grouping: 'document',
          recencyBoost: false,
          metadata: {
            rerankerProviderId: 'legacy-reranker',
            reranker: { enabled: false },
          },
        }),
      },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, 'hybrid-rrf');

    expect(profile.metadata).toMatchObject({ reranker: { enabled: false } });
    expect(profile.metadata).not.toHaveProperty('rerankerProviderId');
  });

  it.each([
    ['dense', { candidateStrategy: 'dense' }],
    ['dense-reranker', { candidateStrategy: 'dense', reranker: { enabled: true } }],
    ['lexical-reranker', { candidateStrategy: 'lexical', lexicalStrategy: 'bm25', bm25K1: 1.5, bm25B: 0.75 }],
    ['hybrid-reranker', { candidateStrategy: 'hybrid', lexicalStrategy: 'bm25', bm25K1: 1.5, bm25B: 0.75 }],
    ['hybrid-legacy-reranker', { candidateStrategy: 'hybrid', fusionStrategy: 'legacy-weighted-rank' }],
    ['hybrid-rrf-reranker', { candidateStrategy: 'hybrid', fusionStrategy: 'rrf' }],
    ['hybrid-dbsf-reranker', { candidateStrategy: 'hybrid', fusionStrategy: 'dbsf' }],
  ])('keeps candidate/fusion identity independent from reranker suffix: %s', async (key, expected) => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, key);

    expect(profile.metadata).toMatchObject(expected);
    expect(profile.key).toBe(key);
  });

  it('does not reinterpret a custom profile that happens to end in -reranker', async () => {
    const resolver = new RetrievalProfileResolver({
      retrievalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);

    const profile = await resolver.resolve('kb-1', undefined, 'team-reranker');

    expect(profile.metadata).not.toHaveProperty('reranker');
  });
});
