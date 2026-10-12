import type { RerankOverride, RerankerResolution } from '../providers/providers.service';
import type { VectorSearchFilters } from '../vector-index/qdrant.adapter';

export interface SearchResult {
  text: string;
  score: number;
  documentId: string;
  chunkId: string;
  sourceId?: string;
  path?: string;
  mimeType?: string;
  language?: string;
  branch?: string;
  commit?: string;
  startLine?: number;
  endLine?: number;
  tokenCount?: number;
  metadata: Record<string, unknown>;
}

export interface SearchRequest {
  query: string;
  topK?: number;
  limit?: number;
  scoreThreshold?: number;
  profileKey?: string;
  tokenBudget?: number;
  filters?: VectorSearchFilters;
  rerank?: RerankOverride;
}

export interface RetrievalBudgetReserves {
  systemTokens: number;
  instructionTokens: number;
  outputTokens: number;
  safetyTokens: number;
}

export interface SearchResponse {
  knowledgeBaseId: string;
  indexVersionId: string;
  retrievalProfile: RetrievalProfileSummary;
  results: SearchResult[];
  count: number;
}

export interface RetrievalProfileSummary {
  key: string;
  name: string;
  intent: string;
  denseTopK: number;
  lexicalEnabled: boolean;
  lexicalTopK: number;
  scoreThreshold?: number;
  neighborBefore: number;
  neighborAfter: number;
  tokenBudget?: number;
  grouping: string;
  recencyBoost: boolean;
}

export interface ContextPackageResponse {
  knowledgeBaseId: string;
  indexVersionId: string;
  retrievalProfile: RetrievalProfileSummary;
  query: string;
  count: number;
  budget: {
    requestedTokens?: number;
    estimatedTokens: number;
  };
  groups: Array<{
    title: string;
    kind: 'code' | 'docs' | 'memory' | 'ops' | 'mixed';
    items: SearchResult[];
  }>;
  diagnostics: {
    serving: ServingTrace;
    denseCandidates: number;
    lexicalCandidates: number;
    mergedCandidates: number;
    reranked: boolean;
    rerankerFallbackUsed: boolean;
    rerankerReason?: string;
    reranker?: RerankerResolution;
    rerankerCandidateCount: number;
    expandedNeighbors: number;
    neighborExpansionQueries: number;
    droppedDuplicates: number;
    droppedNearDuplicates: number;
    budget: BudgetDiagnostics;
  };
}

export interface RetrievalTraceResponse {
  knowledgeBaseId: string;
  indexVersionId: string;
  query: string;
  retrievalProfile: RetrievalProfileSummary;
  appliedFilters: VectorSearchFilters | undefined;
  stages: {
    denseCandidates: SearchResult[];
    lexicalCandidates: SearchResult[];
    mergedCandidates: SearchResult[];
    filteredCandidates: SearchResult[];
    dedupedCandidates: SearchResult[];
    rerankedCandidates: SearchResult[];
    nearDedupedCandidates: SearchResult[];
    expandedCandidates: SearchResult[];
    finalCandidates: SearchResult[];
  };
  contextPackage: {
    count: number;
    budget: {
      requestedTokens?: number;
      estimatedTokens: number;
    };
    groups: Array<{
      title: string;
      kind: 'code' | 'docs' | 'memory' | 'ops' | 'mixed';
      items: SearchResult[];
    }>;
  };
  diagnostics: {
    serving: ServingTrace;
    denseCandidates: number;
    lexicalCandidates: number;
    mergedCandidates: number;
    filteredCandidates: number;
    droppedByFilters: number;
    droppedDuplicates: number;
    droppedNearDuplicates: number;
    expandedNeighbors: number;
    neighborExpansionQueries: number;
    finalCount: number;
    reranked: boolean;
    rerankerFallbackUsed: boolean;
    rerankerReason?: string;
    reranker?: RerankerResolution;
    rerankerCandidateCount: number;
    budget: BudgetDiagnostics;
  };
}

export interface BudgetDiagnostics {
  tokenizer: {
    id: string;
    modelFamily: string;
    approximate: boolean;
  };
  requestedTokens: number;
  reservedTokens: {
    system: number;
    instruction: number;
    query: number;
    output: number;
    safety: number;
  };
  retrievalBudgetTokens: number;
  usedTokens: number;
  droppedItems: number;
  trimmedItems: number;
  budgetReason: string;
}

export interface ServingTrace {
  servingRevisionId: string;
  sourceRevisionIds: string[];
  vectorBackendId: string;
  collectionName: string;
  collectionAlias?: string;
  indexBuildId?: string;
  filterPlacement: 'pre_topk';
}

export interface MemorySearchResult {
  id: string;
  entryType: string;
  title?: string;
  summary?: string;
  body: string;
  tags: string[];
  authoredBy?: string;
  sessionId?: string;
  occurredAt?: Date;
  createdAt: Date;
  metadata: Record<string, unknown>;
  score: number;
}

export interface MemorySearchResponse {
  knowledgeBaseId: string;
  retrievalProfile: RetrievalProfileSummary;
  results: MemorySearchResult[];
  count: number;
}

export interface DocumentContextRequest {
  documentId: string;
  chunkId?: string;
  startLine?: number;
  endLine?: number;
  maxChars?: number;
}

export interface DocumentContextResponse {
  documentId: string;
  path: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface ChunkNeighborsResponse {
  chunkId: string;
  neighbors: Array<{
    chunkId: string;
    chunkIndex: number;
    text: string;
    startLine?: number;
    endLine?: number;
    metadata: Record<string, unknown>;
  }>;
}
