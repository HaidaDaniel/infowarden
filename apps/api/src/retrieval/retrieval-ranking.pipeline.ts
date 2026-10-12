import { SearchHit } from '../vector-index/qdrant.adapter';
import { resolveCandidateStrategy, resolveFusionStrategy } from './retrieval-internal.types';

export type RankingProfile = {
  denseTopK: number;
  metadata: Record<string, unknown>;
};

type HybridSettings = {
  lexicalEnabled: boolean;
  lexicalTopK: number;
  denseWeight: number;
  lexicalWeight: number;
};

const DEFAULT_LEXICAL_TOP_K = 10;
const HARD_LEXICAL_TOP_K = 50;

export class RetrievalRankingPipeline {
  dedupeHits(hits: SearchHit[]): SearchHit[] {
    const seen = new Set<string>();
    const deduped: SearchHit[] = [];

    for (const hit of hits) {
      const key = this.hitKey(hit);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(hit);
    }

    return deduped;
  }

  suppressNearDuplicates(hits: SearchHit[]): { hits: SearchHit[]; dropped: number } {
    const kept: SearchHit[] = [];
    const signaturesByRevision = new Map<string, Set<string>>();
    let dropped = 0;

    for (const hit of hits) {
      const revision = hit.payload.sourceRevisionId || String(hit.payload.metadata?.sourceRevisionId || 'unknown');
      const signature = this.nearDuplicateSignature(hit.payload.text || '');
      if (!signature) {
        kept.push(hit);
        continue;
      }

      const signatures = signaturesByRevision.get(revision) || new Set<string>();
      if (signatures.has(signature)) {
        dropped += 1;
        continue;
      }
      signatures.add(signature);
      signaturesByRevision.set(revision, signatures);
      kept.push(hit);
    }

    return { hits: kept, dropped };
  }

  mergeCandidates(denseHits: SearchHit[], lexicalHits: SearchHit[], profile: RankingProfile): SearchHit[] {
    if (resolveCandidateStrategy(profile.metadata) === 'lexical') {
      return lexicalHits.map((hit) => ({
        ...hit,
        payload: {
          ...hit.payload,
          metadata: this.withRetrievalSource(hit.payload.metadata || {}, 'lexical', {
            lexicalScore: hit.score,
          }),
        },
      }));
    }

    const settings = this.resolveHybridSettings(profile.metadata);
    const fusionStrategy = resolveFusionStrategy(profile.metadata);
    if (!settings.lexicalEnabled) {
      return denseHits.map((hit) => ({
        ...hit,
        payload: {
          ...hit.payload,
          metadata: this.withRetrievalSource(hit.payload.metadata || {}, 'dense', {
            denseScore: hit.score,
          }),
        },
      }));
    }
    if (fusionStrategy === 'rrf') return this.mergeRrf(denseHits, lexicalHits, profile);
    if (fusionStrategy === 'dbsf') return this.mergeDbsf(denseHits, lexicalHits, profile);
    if (lexicalHits.length === 0) {
      return denseHits.map((hit) => ({
        ...hit,
        payload: {
          ...hit.payload,
          metadata: this.withRetrievalSource(hit.payload.metadata || {}, 'dense', {
            denseScore: hit.score,
          }),
        },
      }));
    }

    const byChunk = new Map<string, SearchHit>();
    const denseRankScores = this.rankScores(denseHits);
    const lexicalRankScores = this.rankScores(lexicalHits);

    denseHits.forEach((hit, index) => {
      const key = this.hitKey(hit);
      byChunk.set(key, {
        ...hit,
        score: denseRankScores[index] * settings.denseWeight,
        payload: {
          ...hit.payload,
          metadata: this.withRetrievalSource(hit.payload.metadata || {}, 'dense', {
            denseScore: hit.score,
          }),
        },
      });
    });

    lexicalHits.forEach((hit, index) => {
      const key = this.hitKey(hit);
      const lexicalComponent = lexicalRankScores[index] * settings.lexicalWeight;
      const existing = byChunk.get(key);

      if (!existing) {
        byChunk.set(key, {
          ...hit,
          score: lexicalComponent,
          payload: {
            ...hit.payload,
            metadata: this.withRetrievalSource(hit.payload.metadata || {}, 'lexical', {
              lexicalScore: hit.score,
            }),
          },
        });
        return;
      }

      byChunk.set(key, {
        ...existing,
        score: existing.score + lexicalComponent,
        payload: {
          ...existing.payload,
          metadata: this.withRetrievalSource(existing.payload.metadata || {}, 'lexical', {
            lexicalScore: hit.score,
          }),
        },
      });
    });

    return Array.from(byChunk.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(profile.denseTopK, settings.lexicalTopK));
  }

  rerankKey(hit: SearchHit): string {
    return hit.payload.chunkId || `${hit.payload.documentId}:${hit.payload.chunkIndex ?? ''}`;
  }

  private resolveHybridSettings(metadata: Record<string, unknown>): HybridSettings {
    const lexicalEnabled =
      metadata.lexicalEnabled === true || metadata.hybridSearch === true || metadata.hybridEnabled === true;
    const lexicalTopK = Math.min(
      Math.max(this.numberValue(metadata.lexicalTopK) || DEFAULT_LEXICAL_TOP_K, 1),
      HARD_LEXICAL_TOP_K,
    );
    const denseWeight = this.numberValue(metadata.denseWeight) || this.numberValue(metadata.hybridDenseWeight) || 0.7;
    const lexicalWeight =
      this.numberValue(metadata.lexicalWeight) || this.numberValue(metadata.hybridLexicalWeight) || 0.3;

    return {
      lexicalEnabled,
      lexicalTopK,
      denseWeight,
      lexicalWeight,
    };
  }

  private withRetrievalSource(
    metadata: Record<string, unknown>,
    source: 'dense' | 'lexical',
    scores: Record<string, unknown>,
  ): Record<string, unknown> {
    const existingSources = Array.isArray(metadata.retrievalSources) ? metadata.retrievalSources.map(String) : [];
    return {
      ...metadata,
      ...scores,
      retrievalSources: Array.from(new Set([...existingSources, source])),
    };
  }

  private rankScores(hits: SearchHit[]): number[] {
    return hits.map((_, index) => 1 / (index + 1));
  }

  private mergeRrf(denseHits: SearchHit[], lexicalHits: SearchHit[], profile: RankingProfile): SearchHit[] {
    const candidateDepth = this.positiveIntegerValue(profile.metadata.candidateDepth, 'candidateDepth');
    const dense = candidateDepth
      ? this.canonicalizeLeg(denseHits).slice(0, candidateDepth)
      : this.canonicalizeLeg(denseHits);
    const lexical = candidateDepth
      ? this.canonicalizeLeg(lexicalHits).slice(0, candidateDepth)
      : this.canonicalizeLeg(lexicalHits);
    const rankConstant = this.positiveIntegerValue(profile.metadata.rrfK, 'rrfK') || 60;
    return this.mergeFusionLegs(
      [
        { source: 'dense', hits: dense, components: dense.map((_, index) => 1 / (rankConstant + index + 1)) },
        { source: 'lexical', hits: lexical, components: lexical.map((_, index) => 1 / (rankConstant + index + 1)) },
      ],
      'rrf',
      profile,
    );
  }

  private mergeDbsf(denseHits: SearchHit[], lexicalHits: SearchHit[], profile: RankingProfile): SearchHit[] {
    const candidateDepth = this.positiveIntegerValue(profile.metadata.candidateDepth, 'candidateDepth');
    const dense = candidateDepth
      ? this.canonicalizeLeg(denseHits).slice(0, candidateDepth)
      : this.canonicalizeLeg(denseHits);
    const lexical = candidateDepth
      ? this.canonicalizeLeg(lexicalHits).slice(0, candidateDepth)
      : this.canonicalizeLeg(lexicalHits);
    return this.mergeFusionLegs(
      [
        { source: 'dense', hits: dense, components: this.normalizeDistribution(dense.map((hit) => hit.score)) },
        { source: 'lexical', hits: lexical, components: this.normalizeDistribution(lexical.map((hit) => hit.score)) },
      ],
      'dbsf',
      profile,
    );
  }

  private mergeFusionLegs(
    legs: Array<{ source: 'dense' | 'lexical'; hits: SearchHit[]; components: number[] }>,
    strategy: 'rrf' | 'dbsf',
    profile: RankingProfile,
  ): SearchHit[] {
    const byChunk = new Map<string, SearchHit>();
    const contributingSources = new Map<string, Set<'dense' | 'lexical'>>();
    for (const leg of legs) {
      leg.hits.forEach((hit, index) => {
        const key = this.hitKey(hit);
        const sources = contributingSources.get(key) || new Set<'dense' | 'lexical'>();
        sources.add(leg.source);
        contributingSources.set(key, sources);
        const sourceMetadata = this.withRetrievalSource(hit.payload.metadata || {}, leg.source, {
          [`${leg.source}Score`]: hit.score,
          [`${leg.source}${strategy === 'rrf' ? 'Rrf' : 'Dbsf'}Component`]: leg.components[index],
          fusionStrategy: strategy,
        });
        const existing = byChunk.get(key);
        if (!existing) {
          byChunk.set(key, {
            ...hit,
            score: leg.components[index],
            payload: { ...hit.payload, metadata: sourceMetadata },
          });
          return;
        }
        byChunk.set(key, {
          ...existing,
          score: existing.score + leg.components[index],
          payload: {
            ...existing.payload,
            metadata: this.withRetrievalSource(existing.payload.metadata || {}, leg.source, {
              [`${leg.source}Score`]: hit.score,
              [`${leg.source}${strategy === 'rrf' ? 'Rrf' : 'Dbsf'}Component`]: leg.components[index],
              fusionStrategy: strategy,
            }),
          },
        });
      });
    }

    return Array.from(byChunk.values())
      .map((hit) => ({
        ...hit,
        payload: {
          ...hit.payload,
          metadata: {
            ...(hit.payload.metadata || {}),
            candidateOverlap:
              contributingSources.get(this.hitKey(hit))?.has('dense') &&
              contributingSources.get(this.hitKey(hit))?.has('lexical')
                ? 'both'
                : 'single',
          },
        },
      }))
      .sort((a, b) => b.score - a.score || this.hitKey(a).localeCompare(this.hitKey(b)))
      .slice(0, Math.max(profile.denseTopK, this.resolveHybridSettings(profile.metadata).lexicalTopK));
  }

  private normalizeDistribution(scores: number[]): number[] {
    if (scores.length === 0) return [];
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
    const standardDeviation = Math.sqrt(variance);
    if (standardDeviation === 0) return scores.map(() => 0.5);
    const lower = mean - 3 * standardDeviation;
    const upper = mean + 3 * standardDeviation;
    const clipped = scores.map((score) => Math.min(Math.max(score, lower), upper));
    const min = Math.min(...clipped);
    const max = Math.max(...clipped);
    if (max === min) return scores.map(() => 0.5);
    return clipped.map((score) => (score - min) / (max - min));
  }

  private canonicalizeLeg(hits: SearchHit[]): SearchHit[] {
    return this.dedupeHits(hits).sort((a, b) => b.score - a.score || this.hitKey(a).localeCompare(this.hitKey(b)));
  }

  private hitKey(hit: SearchHit): string {
    const revision = hit.payload.sourceRevisionId || String(hit.payload.metadata?.sourceRevisionId || 'no-revision');
    return hit.payload.chunkId
      ? `${revision}:${hit.payload.chunkId}`
      : `${revision}:${hit.payload.documentId}:${hit.payload.chunkIndex ?? ''}`;
  }

  private nearDuplicateSignature(text: string): string | undefined {
    const normalized = text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\p{L}\p{N}_./:-]+/gu, ' ')
      .trim();
    if (normalized.length < 80) {
      return undefined;
    }
    return normalized.slice(0, 240);
  }

  private numberValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private positiveIntegerValue(value: unknown, name: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
    return value;
  }
}
