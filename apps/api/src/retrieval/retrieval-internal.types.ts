import type { RetrievalProfileSummary } from './retrieval.types';

export type ResolvedRetrievalProfile = RetrievalProfileSummary & {
  knowledgeBaseId: string;
  metadata: Record<string, unknown>;
};

export type HybridSettings = {
  lexicalEnabled: boolean;
  lexicalTopK: number;
  denseWeight: number;
  lexicalWeight: number;
};

export type CandidateStrategy = 'dense' | 'lexical' | 'hybrid';

export type LexicalStrategy = 'pg-fts' | 'structured' | 'bm25' | 'bm25f';
export type FusionStrategy = 'legacy-weighted-rank' | 'rrf' | 'dbsf';

export type RerankerProfileSettings = {
  enabled: boolean;
};

export function resolveBuiltInLexicalMetadata(key: string, metadata: Record<string, unknown>): Record<string, unknown> {
  const baseKey = key.endsWith('-reranker') ? key.slice(0, -'-reranker'.length) : key;
  const rerankerBaseKeys = new Set([
    'dense',
    'lexical',
    'lexical-pg-fts',
    'lexical-structured',
    'lexical-bm25',
    'lexical-bm25f',
    'hybrid-legacy',
    'hybrid',
    'hybrid-rrf',
    'hybrid-dbsf',
  ]);
  const rerankerEnabled = key.endsWith('-reranker') && rerankerBaseKeys.has(baseKey);
  const resolved = { ...metadata };

  if (baseKey === 'lexical-pg-fts') {
    resolved.candidateStrategy = 'lexical';
    resolved.lexicalEnabled = true;
    resolved.lexicalStrategy = 'pg-fts';
  }
  if (baseKey === 'lexical-structured') {
    resolved.candidateStrategy = 'lexical';
    resolved.lexicalEnabled = true;
    resolved.lexicalStrategy = 'structured';
  }
  if (baseKey === 'lexical-bm25') {
    resolved.candidateStrategy = 'lexical';
    resolved.lexicalEnabled = true;
    resolved.lexicalStrategy = 'bm25';
  }
  if (baseKey === 'lexical-bm25f') {
    resolved.candidateStrategy = 'lexical';
    resolved.lexicalEnabled = true;
    resolved.lexicalStrategy = 'bm25f';
  }
  if (baseKey === 'dense') {
    resolved.candidateStrategy = 'dense';
    resolved.lexicalEnabled = false;
  }
  if (baseKey === 'lexical') {
    resolved.candidateStrategy = 'lexical';
    resolved.lexicalEnabled = true;
    resolved.lexicalStrategy = 'bm25';
    resolved.bm25K1 = 1.5;
    resolved.bm25B = 0.75;
  }
  if (
    baseKey === 'default' &&
    resolved.candidateStrategy === undefined &&
    resolved.lexicalEnabled !== true &&
    resolved.hybridSearch !== true &&
    resolved.hybridEnabled !== true
  ) {
    // Keep the public `default` profile key while making its v0.1 dense
    // semantics explicit. Custom persisted metadata that opts into lexical or
    // hybrid retrieval remains authoritative and backward compatible.
    resolved.candidateStrategy = 'dense';
  }
  if (baseKey === 'hybrid-legacy') {
    resolved.candidateStrategy = 'hybrid';
    resolved.lexicalEnabled = true;
    resolved.fusionStrategy = 'legacy-weighted-rank';
  }
  if (baseKey === 'hybrid') {
    resolved.candidateStrategy = 'hybrid';
    resolved.lexicalEnabled = true;
    resolved.lexicalStrategy = 'bm25';
    resolved.bm25K1 = 1.5;
    resolved.bm25B = 0.75;
    resolved.fusionStrategy = 'legacy-weighted-rank';
  }
  if (baseKey === 'hybrid-rrf') {
    resolved.candidateStrategy = 'hybrid';
    resolved.lexicalEnabled = true;
    resolved.fusionStrategy = 'rrf';
  }
  if (baseKey === 'hybrid-dbsf') {
    resolved.candidateStrategy = 'hybrid';
    resolved.lexicalEnabled = true;
    resolved.fusionStrategy = 'dbsf';
  }

  if (rerankerEnabled) {
    resolved.reranker = {
      ...(typeof resolved.reranker === 'object' && resolved.reranker !== null ? resolved.reranker : {}),
      enabled: true,
    } satisfies RerankerProfileSettings;
  }

  return resolved;
}

export function isBuiltInLexicalProfileKey(key: string): boolean {
  const baseKey = key.endsWith('-reranker') ? key.slice(0, -'-reranker'.length) : key;
  return (
    baseKey === 'lexical' ||
    baseKey === 'lexical-pg-fts' ||
    baseKey === 'lexical-structured' ||
    baseKey === 'lexical-bm25' ||
    baseKey === 'lexical-bm25f'
  );
}

export function resolveRetrievalProfileMetadata(
  key: string,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = resolveBuiltInLexicalMetadata(key, metadata);
  const reranker =
    typeof resolved.reranker === 'object' && resolved.reranker !== null && !Array.isArray(resolved.reranker)
      ? (resolved.reranker as Record<string, unknown>)
      : undefined;

  if (!reranker) return resolved;

  if (reranker.enabled === false) {
    const withoutLegacyRerankerFields = { ...resolved };
    for (const field of [
      'rerankerProviderId',
      'rerankerId',
      'rerankerProviderName',
      'rerankerTopN',
      'rerankTopN',
      'rerankerFallbackAllowed',
    ]) {
      delete withoutLegacyRerankerFields[field];
    }
    return withoutLegacyRerankerFields;
  }

  return {
    ...resolved,
    ...(reranker.providerId && resolved.rerankerProviderId === undefined
      ? { rerankerProviderId: reranker.providerId }
      : {}),
    ...(reranker.id && resolved.rerankerId === undefined ? { rerankerId: reranker.id } : {}),
    ...(reranker.providerName && resolved.rerankerProviderName === undefined
      ? { rerankerProviderName: reranker.providerName }
      : {}),
    ...(reranker.topN !== undefined && resolved.rerankerTopN === undefined ? { rerankerTopN: reranker.topN } : {}),
    ...(reranker.fallbackAllowed !== undefined && resolved.rerankerFallbackAllowed === undefined
      ? { rerankerFallbackAllowed: reranker.fallbackAllowed }
      : {}),
  };
}

export function resolveCandidateStrategy(metadata: Record<string, unknown>): CandidateStrategy {
  if (metadata.candidateStrategy === 'lexical') return 'lexical';
  if (metadata.candidateStrategy === 'hybrid') return 'hybrid';
  return 'dense';
}

export function resolveLexicalStrategy(metadata: Record<string, unknown>): LexicalStrategy {
  if (metadata.lexicalStrategy === 'pg-fts') return 'pg-fts';
  if (metadata.lexicalStrategy === 'bm25') return 'bm25';
  if (metadata.lexicalStrategy === 'bm25f') return 'bm25f';
  return 'structured';
}

export function resolveFusionStrategy(metadata: Record<string, unknown>): FusionStrategy {
  if (metadata.fusionStrategy === 'rrf') return 'rrf';
  if (metadata.fusionStrategy === 'dbsf') return 'dbsf';
  return 'legacy-weighted-rank';
}

export type ResolvedServingContext = {
  servingRevisionId: string;
  sourceRevisionIds: string[];
  vectorBackendId: string;
  collectionName: string;
  collectionAlias?: string;
  indexBuildId?: string;
  filterPlacement: 'pre_topk';
};

export type LexicalCandidateRow = {
  id: string;
  score: number;
  documentId: string;
  indexVersionId: string;
  sourceRevisionId?: string | null;
  text: string;
  tokenCount: number;
  chunkIndex: number;
  startLine?: number | null;
  endLine?: number | null;
  chunkMetadata: Record<string, unknown> | null;
  documentPath: string;
  documentMetadata: Record<string, unknown> | null;
};
