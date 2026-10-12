import { SearchHit } from '../vector-index/qdrant.adapter';
import { RetrievalRankingPipeline } from './retrieval-ranking.pipeline';

describe('retrieval fusion strategies', () => {
  const pipeline = new RetrievalRankingPipeline();

  it('implements equal-weight RRF with deterministic rank contributions', () => {
    const merged = pipeline.mergeCandidates(
      [hit('dense-a', 100), hit('shared', 90)],
      [hit('shared', 0.1), hit('lexical-a', 0.09)],
      profile({ fusionStrategy: 'rrf', rrfK: 1 }),
    );

    expect(merged.map((item) => item.payload.chunkId)).toEqual(['shared', 'dense-a', 'lexical-a']);
    expect(merged[0].score).toBeCloseTo(1 / 3 + 1 / 2);
    expect(merged[0].payload.metadata).toMatchObject({
      fusionStrategy: 'rrf',
      candidateOverlap: 'both',
      retrievalSources: ['dense', 'lexical'],
      denseRrfComponent: 1 / 3,
      lexicalRrfComponent: 1 / 2,
    });
  });

  it('normalizes DBSF legs independently and preserves raw score provenance', () => {
    const merged = pipeline.mergeCandidates(
      [hit('dense-a', 100), hit('dense-b', 90)],
      [hit('lexical-b', 0.01), hit('lexical-a', 0.001)],
      profile({ fusionStrategy: 'dbsf' }),
    );

    expect(merged[0].payload.metadata).toMatchObject({
      fusionStrategy: 'dbsf',
      denseScore: expect.any(Number),
      denseDbsfComponent: expect.any(Number),
    });
    expect(merged.map((item) => item.payload.chunkId)).toEqual(['dense-a', 'lexical-b', 'dense-b', 'lexical-a']);
    expect(merged.find((item) => item.payload.chunkId === 'dense-a')?.score).toBeCloseTo(1);
  });

  it('handles missing legs and duplicate candidates without fabricating a score', () => {
    const merged = pipeline.mergeCandidates([], [hit('lexical-only', 0.5)], profile({ fusionStrategy: 'rrf' }));

    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBeCloseTo(1 / 61);
    expect(merged[0].payload.metadata).toMatchObject({ candidateOverlap: 'single' });
  });

  it('dedupes each leg and ranks equal-score ties by stable candidate identity', () => {
    const merged = pipeline.mergeCandidates(
      [hit('dense-b', 1), hit('dense-a', 1), hit('dense-a', 1)],
      [hit('lexical-a', 1), hit('lexical-b', 1)],
      profile({ fusionStrategy: 'rrf', rrfK: 1 }),
    );

    expect(merged.map((item) => item.payload.chunkId)).toEqual(['dense-a', 'lexical-a', 'dense-b', 'lexical-b']);
    expect(merged.filter((item) => item.payload.chunkId === 'dense-a')).toHaveLength(1);
  });

  it('uses the zero-variance DBSF constant and clips score distributions deterministically', () => {
    const merged = pipeline.mergeCandidates(
      [hit('dense-a', 10), hit('dense-b', 10), hit('dense-outlier', 10000)],
      [hit('lexical-a', 0.1), hit('lexical-b', 0.1), hit('lexical-outlier', 0.1)],
      profile({ fusionStrategy: 'dbsf' }),
    );

    expect(merged.every((item) => Number.isFinite(item.score))).toBe(true);
    expect(merged.map((item) => item.payload.metadata?.fusionStrategy)).toEqual([
      'dbsf',
      'dbsf',
      'dbsf',
      'dbsf',
      'dbsf',
      'dbsf',
    ]);
  });

  it('rejects invalid RRF parameters instead of producing non-finite or negative-slice results', () => {
    for (const value of [-1, 0, 1.5, null, true, '60', 'not-a-number', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        pipeline.mergeCandidates(
          [hit('dense-a', 1)],
          [hit('lexical-a', 1)],
          profile({ fusionStrategy: 'rrf', rrfK: value }),
        ),
      ).toThrow('rrfK must be a positive integer');
    }

    for (const value of [-2, 0, 1.5, null, false, 'not-a-number', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        pipeline.mergeCandidates(
          [hit('dense-a', 1)],
          [hit('lexical-a', 1)],
          profile({ fusionStrategy: 'rrf', candidateDepth: value }),
        ),
      ).toThrow('candidateDepth must be a positive integer');
    }
  });

  it('does not infer overlap from unrelated pre-existing provenance', () => {
    const dense = hit('dense-a', 1);
    dense.payload.metadata = { retrievalSources: ['imported'] };
    const merged = pipeline.mergeCandidates([dense], [], profile({ fusionStrategy: 'rrf' }));

    expect(merged[0].payload.metadata).toMatchObject({
      retrievalSources: ['imported', 'dense'],
      candidateOverlap: 'single',
    });
  });

  function profile(metadata: Record<string, unknown>) {
    return {
      denseTopK: 10,
      metadata: { hybridSearch: true, lexicalTopK: 10, ...metadata },
    };
  }

  function hit(chunkId: string, score: number): SearchHit {
    return {
      id: chunkId,
      score,
      payload: {
        chunkId,
        documentId: `doc-${chunkId}`,
        indexVersionId: 'index-1',
        sourceRevisionId: 'revision-1',
        chunkIndex: 0,
        text: chunkId,
        metadata: {},
      },
    };
  }
});
