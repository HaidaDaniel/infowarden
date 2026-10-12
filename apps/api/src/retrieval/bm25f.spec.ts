import { BM25F_WEIGHT_GRID, buildBm25fStatistics, scoreBm25f } from './bm25';

describe('BM25F product baseline', () => {
  it('weights a path/title field and keeps missing fields non-relevant', () => {
    const documents = [
      { id: 'path', fields: { chunkText: '', pathTitle: 'needle', identifierMetadata: '' } },
      { id: 'empty', fields: { chunkText: '', pathTitle: '', identifierMetadata: '' } },
    ];
    const statistics = buildBm25fStatistics(documents);

    expect(scoreBm25f('needle', documents[0], statistics, BM25F_WEIGHT_GRID[0].weights)).toBeGreaterThan(0);
    expect(scoreBm25f('needle', documents[1], statistics, BM25F_WEIGHT_GRID[0].weights)).toBe(0);
  });

  it('keeps the complete predeclared grid visible without selecting a winner', () => {
    expect(BM25F_WEIGHT_GRID).toEqual([
      { id: 'balanced', weights: { chunkText: 1, pathTitle: 1.5, identifierMetadata: 2 } },
      { id: 'text-first', weights: { chunkText: 2, pathTitle: 1, identifierMetadata: 1 } },
      { id: 'identifier-first', weights: { chunkText: 1, pathTitle: 2, identifierMetadata: 3 } },
    ]);
  });
});
