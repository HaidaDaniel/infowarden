export type Bm25Document = {
  id: string;
  text: string;
  tokenCount: number;
};

export type Bm25Statistics = {
  documentCount: number;
  averageDocumentLength: number;
  documentFrequency: Map<string, number>;
};

export type Bm25fField = 'chunkText' | 'pathTitle' | 'identifierMetadata';

export type Bm25fDocument = {
  id: string;
  fields: Partial<Record<Bm25fField, string>>;
};

export type Bm25fWeights = Record<Bm25fField, number>;

export type Bm25fStatistics = {
  documentCount: number;
  averageFieldLengths: Record<Bm25fField, number>;
  documentFrequency: Map<string, number>;
};

export const BM25F_WEIGHT_GRID: ReadonlyArray<{ id: string; weights: Bm25fWeights }> = [
  { id: 'balanced', weights: { chunkText: 1, pathTitle: 1.5, identifierMetadata: 2 } },
  { id: 'text-first', weights: { chunkText: 2, pathTitle: 1, identifierMetadata: 1 } },
  { id: 'identifier-first', weights: { chunkText: 1, pathTitle: 2, identifierMetadata: 3 } },
];

export const DEFAULT_BM25_K1 = 1.2;
export const DEFAULT_BM25_B = 0.75;

export function tokenizeBm25(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
}

export function buildBm25Statistics(documents: Bm25Document[]): Bm25Statistics {
  const documentFrequency = new Map<string, number>();
  let totalLength = 0;

  for (const document of documents) {
    const terms = new Set(tokenizeBm25(document.text));
    totalLength += documentLength(document);
    for (const term of terms) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }

  return {
    documentCount: documents.length,
    averageDocumentLength: documents.length ? totalLength / documents.length : 0,
    documentFrequency,
  };
}

export function scoreBm25(
  query: string,
  document: Bm25Document,
  statistics: Bm25Statistics,
  k1 = DEFAULT_BM25_K1,
  b = DEFAULT_BM25_B,
): number {
  if (!statistics.documentCount || !statistics.averageDocumentLength) return 0;
  const frequencies = new Map<string, number>();
  for (const term of tokenizeBm25(document.text)) frequencies.set(term, (frequencies.get(term) || 0) + 1);

  let score = 0;
  for (const term of tokenizeBm25(query)) {
    const frequency = frequencies.get(term) || 0;
    const documentFrequency = statistics.documentFrequency.get(term) || 0;
    if (!frequency || !documentFrequency) continue;
    const idf = Math.log(1 + (statistics.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
    const denominator = frequency + k1 * (1 - b + b * (documentLength(document) / statistics.averageDocumentLength));
    score += idf * ((frequency * (k1 + 1)) / denominator);
  }
  return score;
}

export function buildBm25fStatistics(documents: Bm25fDocument[]): Bm25fStatistics {
  const documentFrequency = new Map<string, number>();
  const totals: Record<Bm25fField, number> = { chunkText: 0, pathTitle: 0, identifierMetadata: 0 };

  for (const document of documents) {
    const documentTerms = new Set<string>();
    for (const field of Object.keys(totals) as Bm25fField[]) {
      const terms = tokenizeBm25(document.fields[field] || '');
      totals[field] += terms.length;
      for (const term of terms) documentTerms.add(term);
    }
    for (const term of documentTerms) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }

  return {
    documentCount: documents.length,
    averageFieldLengths: {
      chunkText: documents.length ? totals.chunkText / documents.length : 0,
      pathTitle: documents.length ? totals.pathTitle / documents.length : 0,
      identifierMetadata: documents.length ? totals.identifierMetadata / documents.length : 0,
    },
    documentFrequency,
  };
}

export function scoreBm25f(
  query: string,
  document: Bm25fDocument,
  statistics: Bm25fStatistics,
  weights: Bm25fWeights,
  k1 = DEFAULT_BM25_K1,
  b = DEFAULT_BM25_B,
): number {
  if (!statistics.documentCount) return 0;
  const frequencies = new Map<Bm25fField, Map<string, number>>();
  for (const field of Object.keys(weights) as Bm25fField[]) {
    const fieldFrequency = new Map<string, number>();
    for (const term of tokenizeBm25(document.fields[field] || '')) {
      fieldFrequency.set(term, (fieldFrequency.get(term) || 0) + 1);
    }
    frequencies.set(field, fieldFrequency);
  }

  let score = 0;
  for (const term of tokenizeBm25(query)) {
    const documentFrequency = statistics.documentFrequency.get(term) || 0;
    if (!documentFrequency) continue;
    let weightedTermFrequency = 0;
    for (const field of Object.keys(weights) as Bm25fField[]) {
      const averageLength = statistics.averageFieldLengths[field];
      const fieldLength = tokenizeBm25(document.fields[field] || '').length;
      const frequency = frequencies.get(field)?.get(term) || 0;
      if (!frequency || !averageLength) continue;
      const normalization = 1 - b + b * (fieldLength / averageLength);
      weightedTermFrequency += weights[field] * (frequency / normalization);
    }
    if (!weightedTermFrequency) continue;
    const idf = Math.log(1 + (statistics.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
    score += idf * ((weightedTermFrequency * (k1 + 1)) / (weightedTermFrequency + k1));
  }
  return score;
}

function documentLength(document: Bm25Document): number {
  return document.tokenCount > 0 ? document.tokenCount : tokenizeBm25(document.text).length;
}
