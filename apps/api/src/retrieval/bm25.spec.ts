import { BM25F_WEIGHT_GRID, buildBm25Statistics, buildBm25fStatistics, scoreBm25, scoreBm25f } from './bm25';

describe('BM25 scoring', () => {
  const documents = [
    { id: 'short', text: 'alpha alpha beta', tokenCount: 3 },
    { id: 'long', text: 'alpha beta gamma delta epsilon zeta', tokenCount: 6 },
    { id: 'other', text: 'gamma delta', tokenCount: 2 },
  ];

  it('uses corpus document frequency, term frequency, and average length', () => {
    const statistics = buildBm25Statistics(documents);

    expect(statistics).toMatchObject({ documentCount: 3, averageDocumentLength: 11 / 3 });
    expect(statistics.documentFrequency.get('alpha')).toBe(2);
    expect(statistics.documentFrequency.get('gamma')).toBe(2);
    expect(scoreBm25('alpha', documents[0], statistics)).toBeCloseTo(0.6810831035, 8);
    expect(scoreBm25('alpha', documents[1], statistics)).toBeCloseTo(0.3729209124, 8);
    expect(scoreBm25('alpha', documents[0], statistics)).toBeGreaterThan(scoreBm25('alpha', documents[1], statistics));
  });

  it('rewards repeated terms but keeps absent terms and empty corpora at zero', () => {
    const statistics = buildBm25Statistics(documents);

    expect(scoreBm25('alpha alpha', documents[0], statistics)).toBeGreaterThan(
      scoreBm25('alpha', documents[0], statistics),
    );
    expect(scoreBm25('missing', documents[0], statistics)).toBe(0);
    expect(scoreBm25('alpha', documents[0], buildBm25Statistics([]))).toBe(0);
  });

  it('changes statistics only when the revision-scoped corpus changes', () => {
    const firstRevision = buildBm25Statistics([documents[0]]);
    const secondRevision = buildBm25Statistics([documents[0], documents[2]]);
    const isolatedWorkspace = buildBm25Statistics([documents[2]]);

    expect(firstRevision.documentCount).toBe(1);
    expect(secondRevision.documentCount).toBe(2);
    expect(secondRevision.documentFrequency.get('alpha')).toBe(1);
    expect(isolatedWorkspace.documentFrequency.get('alpha')).toBeUndefined();
    expect(scoreBm25('alpha', documents[0], firstRevision)).toBeGreaterThan(0);
    expect(scoreBm25('alpha', documents[0], isolatedWorkspace)).toBe(0);
  });

  it('honors k1 and b as explicit BM25 parameters', () => {
    const statistics = buildBm25Statistics(documents);

    expect(scoreBm25('alpha', documents[0], statistics, 0, 0)).toBeCloseTo(0.4700036292, 8);
    expect(scoreBm25('alpha', documents[0], statistics, 1.2, 1)).not.toBe(
      scoreBm25('alpha', documents[0], statistics, 1.2, 0),
    );
  });

  it('uses tokenized text when a canonical token count is unavailable', () => {
    const withFallbackLength = [{ id: 'fallback', text: 'alpha beta', tokenCount: 0 }];
    const statistics = buildBm25Statistics(withFallbackLength);

    expect(statistics.averageDocumentLength).toBe(2);
    expect(scoreBm25('alpha', withFallbackLength[0], statistics)).toBeGreaterThan(0);
  });

  it('scores declared BM25F fields and leaves missing fields at zero', () => {
    const documents = [
      { id: 'path', fields: { chunkText: 'common', pathTitle: 'needle', identifierMetadata: '' } },
      { id: 'text', fields: { chunkText: 'needle', pathTitle: '', identifierMetadata: '' } },
    ] as const;
    const statistics = buildBm25fStatistics([...documents]);
    const pathScore = scoreBm25f('needle', documents[0], statistics, BM25F_WEIGHT_GRID[0].weights);
    const textScore = scoreBm25f('needle', documents[1], statistics, BM25F_WEIGHT_GRID[0].weights);

    expect(pathScore).toBeGreaterThan(0);
    expect(textScore).toBeGreaterThan(0);
    expect(pathScore).not.toBe(textScore);
    expect(statistics.averageFieldLengths.identifierMetadata).toBe(0);
  });

  it('exposes exactly the frozen BM25F grid without selecting a winner', () => {
    expect(BM25F_WEIGHT_GRID.map((entry) => entry.id)).toEqual(['balanced', 'text-first', 'identifier-first']);
    expect(BM25F_WEIGHT_GRID.map((entry) => entry.weights)).toEqual([
      { chunkText: 1, pathTitle: 1.5, identifierMetadata: 2 },
      { chunkText: 2, pathTitle: 1, identifierMetadata: 1 },
      { chunkText: 1, pathTitle: 2, identifierMetadata: 3 },
    ]);
  });
});
