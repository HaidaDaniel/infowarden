import { RetrievalRankingPipeline } from './retrieval-ranking.pipeline';
import { SearchHit } from '../vector-index/qdrant.adapter';

describe('RetrievalRankingPipeline', () => {
  const pipeline = new RetrievalRankingPipeline();

  it('dedupes by source revision and chunk identity', () => {
    const hits = [
      hit('chunk-1', 'rev-1', 0.9),
      hit('chunk-1', 'rev-1', 0.8),
      hit('chunk-1', 'rev-2', 0.7),
    ];

    expect(pipeline.dedupeHits(hits).map((item) => item.payload.sourceRevisionId)).toEqual([
      'rev-1',
      'rev-2',
    ]);
  });

  it('merges dense and lexical candidates while preserving source metadata', () => {
    const dense = [hit('chunk-1', 'rev-1', 0.8), hit('chunk-2', 'rev-1', 0.7)];
    const lexical = [hit('chunk-1', 'rev-1', 0.6), hit('chunk-3', 'rev-1', 0.5)];

    const merged = pipeline.mergeCandidates(dense, lexical, {
      denseTopK: 3,
      metadata: {
        hybridSearch: true,
        denseWeight: 0.6,
        lexicalWeight: 0.4,
        lexicalTopK: 3,
      },
    });

    expect(merged.map((item) => item.payload.chunkId)).toEqual([
      'chunk-1',
      'chunk-2',
      'chunk-3',
    ]);
    expect(merged[0].payload.metadata).toMatchObject({
      denseScore: 0.8,
      lexicalScore: 0.6,
      retrievalSources: ['dense', 'lexical'],
    });
  });

  it('suppresses long near-duplicates within the same source revision only', () => {
    const longText = `${'same words '.repeat(20)}tail`;
    const kept = pipeline.suppressNearDuplicates([
      hit('chunk-1', 'rev-1', 0.9, longText),
      hit('chunk-2', 'rev-1', 0.8, longText),
      hit('chunk-3', 'rev-2', 0.7, longText),
      hit('chunk-4', 'rev-1', 0.6, 'short duplicate'),
    ]);

    expect(kept.dropped).toBe(1);
    expect(kept.hits.map((item) => item.payload.chunkId)).toEqual([
      'chunk-1',
      'chunk-3',
      'chunk-4',
    ]);
  });

  function hit(chunkId: string, revision: string, score: number, text = 'result text'): SearchHit {
    return {
      id: chunkId,
      score,
      payload: {
        text,
        documentId: `doc-${chunkId}`,
        indexVersionId: 'index-1',
        chunkId,
        chunkIndex: Number(chunkId.replace('chunk-', '')) || 0,
        sourceRevisionId: revision,
        metadata: {},
      },
    };
  }
});
