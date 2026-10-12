import type { LlmProviderOverride } from '../providers/providers.service';
import type {
  RetrievalTraceResponse,
  SearchRequest,
  SearchResult,
} from '../retrieval/retrieval.types';

export type AskMode = 'chunks' | 'rag_answer';

export interface AskRequest extends SearchRequest {
  mode?: AskMode;
  llm?: LlmProviderOverride;
}

export interface AnswerCitation {
  id: string;
  chunkId: string;
  documentId: string;
  sourceId?: string;
  sourceRevisionId?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
}

export interface AnswerProviderSummary {
  providerConfigId: string;
  name: string;
  model: string;
  protocol: 'openai_compatible';
}

export interface AskResponse {
  mode: AskMode;
  knowledgeBaseId: string;
  indexVersionId: string;
  query: string;
  retrievalTraceId: string;
  retrievalTrace: RetrievalTraceResponse;
  contextPackage: RetrievalTraceResponse['contextPackage'];
  answer?: string;
  citations: AnswerCitation[];
  sourceIds: string[];
  provider?: AnswerProviderSummary;
  diagnostics: {
    retrievalLatencyMs: number;
    generationLatencyMs: number;
    totalLatencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    estimatedInputTokens: number;
    estimatedOutputTokens?: number;
    maxOutputTokens?: number;
    temperature?: number;
    finishReason?: string;
    retrievalBudget: RetrievalTraceResponse['diagnostics']['budget'];
  };
}

export interface CitationContext {
  citation: AnswerCitation;
  item: SearchResult;
}
