import type { SearchResult } from './retrieval.types';

export type EvalQuestionRow = {
  id: string;
  knowledgeBaseId: string;
  text: string;
  expectedDocumentIds: string[];
  expectedChunkIds: string[];
  metadata: unknown;
  createdAt?: Date;
};

export type PerQuestionScore = {
  hitAtK: number;
  hitAt1: number;
  hitAt3: number;
  reciprocalRank: number;
  expectedDocumentHit: number;
  expectedChunkHit?: number;
  resultCount: number;
  duplicateCount: number;
  expectedRankBeforeRerank?: number;
  expectedRankAfterRerank?: number;
  rerankReciprocalRankDelta?: number;
  rerankerChangedTop?: number;
  latencyMs?: number;
};

export class RetrievalEvalMetrics {
  scoreQuestion(
    question: EvalQuestionRow,
    results: SearchResult[],
    topK: number,
    options: { beforeRerank?: SearchResult[] } = {},
  ): PerQuestionScore {
    const expectedDocuments = new Set(question.expectedDocumentIds || []);
    const expectedChunks = new Set(question.expectedChunkIds || []);
    const rankedMatches = results.map((result) => ({
      documentHit: this.matchesExpectedDocument(result, expectedDocuments),
      chunkHit: this.matchesExpectedChunk(result, expectedChunks),
    }));
    const firstHitIndex = rankedMatches.findIndex((match) => match.documentHit || match.chunkHit);
    const firstDocumentHit = rankedMatches.findIndex((match) => match.documentHit);
    const firstChunkHit = rankedMatches.findIndex((match) => match.chunkHit);
    const top = results.slice(0, topK);
    const duplicateCount = top.length - new Set(top.map((result) => result.chunkId)).size;
    const rankBeforeRerank = options.beforeRerank ? this.firstExpectedRank(question, options.beforeRerank) : undefined;
    const rankAfterRerank = this.firstExpectedRank(question, results);

    return {
      hitAtK: firstHitIndex >= 0 && firstHitIndex < topK ? 1 : 0,
      hitAt1: firstHitIndex === 0 ? 1 : 0,
      hitAt3: firstHitIndex >= 0 && firstHitIndex < 3 ? 1 : 0,
      reciprocalRank: firstHitIndex >= 0 ? 1 / (firstHitIndex + 1) : 0,
      expectedDocumentHit: firstDocumentHit >= 0 && firstDocumentHit < topK ? 1 : 0,
      ...(expectedChunks.size ? { expectedChunkHit: firstChunkHit >= 0 && firstChunkHit < topK ? 1 : 0 } : {}),
      resultCount: top.length,
      duplicateCount,
      ...(rankBeforeRerank !== undefined
        ? {
            expectedRankBeforeRerank: rankBeforeRerank,
            expectedRankAfterRerank: rankAfterRerank,
            rerankReciprocalRankDelta: this.reciprocalRank(rankAfterRerank) - this.reciprocalRank(rankBeforeRerank),
            rerankerChangedTop: rankAfterRerank !== undefined && rankBeforeRerank !== rankAfterRerank ? 1 : 0,
          }
        : {}),
    };
  }

  aggregateMetrics(
    scores: PerQuestionScore[],
    metadata: Record<string, unknown>,
    latencies: number[] = [],
  ): Record<string, unknown> {
    const questionCount = scores.length || 1;
    const totalResults = scores.reduce((sum, score) => sum + score.resultCount, 0);
    const duplicateCount = scores.reduce((sum, score) => sum + score.duplicateCount, 0);
    const chunkScores = scores.filter((score) => score.expectedChunkHit !== undefined);
    const rerankScores = scores.filter((score) => score.rerankReciprocalRankDelta !== undefined);
    return {
      ...metadata,
      hitAtK: this.mean(
        scores.map((score) => score.hitAtK),
        questionCount,
      ),
      hitAt1: this.mean(
        scores.map((score) => score.hitAt1),
        questionCount,
      ),
      hitAt3: this.mean(
        scores.map((score) => score.hitAt3),
        questionCount,
      ),
      mrr: this.mean(
        scores.map((score) => score.reciprocalRank),
        questionCount,
      ),
      expectedDocumentHitRate: this.mean(
        scores.map((score) => score.expectedDocumentHit),
        questionCount,
      ),
      ...(chunkScores.length
        ? {
            expectedChunkHitRate: this.mean(
              chunkScores.map((score) => score.expectedChunkHit || 0),
              chunkScores.length,
            ),
          }
        : {}),
      emptyResultRate: this.mean(
        scores.map((score) => (score.resultCount === 0 ? 1 : 0)),
        questionCount,
      ),
      duplicateRate: totalResults ? duplicateCount / totalResults : 0,
      latencyMs: {
        p50: this.percentile(latencies, 50),
        p95: this.percentile(latencies, 95),
        min: latencies.length ? Math.min(...latencies) : 0,
        max: latencies.length ? Math.max(...latencies) : 0,
      },
      ...(rerankScores.length
        ? {
            reranker: {
              comparedQuestions: rerankScores.length,
              meanReciprocalRankDelta: this.mean(
                rerankScores.map((score) => score.rerankReciprocalRankDelta || 0),
                rerankScores.length,
              ),
              changedTopRate: this.mean(
                rerankScores.map((score) => score.rerankerChangedTop || 0),
                rerankScores.length,
              ),
            },
          }
        : {}),
    };
  }

  private matchesExpectedDocument(result: SearchResult, expectedDocuments: Set<string>): boolean {
    if (expectedDocuments.size === 0) return false;
    return this.candidateDocumentIds(result).some((candidate) => expectedDocuments.has(candidate));
  }

  private matchesExpectedChunk(result: SearchResult, expectedChunks: Set<string>): boolean {
    if (expectedChunks.size === 0) return false;
    return this.candidateChunkIds(result).some((candidate) => expectedChunks.has(candidate));
  }

  private candidateDocumentIds(result: SearchResult): string[] {
    const metadata = this.asRecord(result.metadata);
    return [
      result.documentId,
      result.path,
      metadata.externalDocumentId,
      metadata.evalDocumentId,
      metadata.documentExternalId,
      metadata.stableDocumentId,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  }

  private candidateChunkIds(result: SearchResult): string[] {
    const metadata = this.asRecord(result.metadata);
    return [result.chunkId, metadata.externalChunkId, metadata.evalChunkId, metadata.stableChunkId].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  }

  private firstExpectedRank(question: EvalQuestionRow, results: SearchResult[]): number | undefined {
    const expectedDocuments = new Set(question.expectedDocumentIds || []);
    const expectedChunks = new Set(question.expectedChunkIds || []);
    const index = results.findIndex(
      (result) =>
        this.matchesExpectedDocument(result, expectedDocuments) || this.matchesExpectedChunk(result, expectedChunks),
    );
    return index >= 0 ? index + 1 : undefined;
  }

  private reciprocalRank(rank?: number): number {
    return rank ? 1 / rank : 0;
  }

  private mean(values: number[], denominator: number): number {
    return values.reduce((sum, value) => sum + value, 0) / denominator;
  }

  private percentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
    return sorted[index];
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }
}
