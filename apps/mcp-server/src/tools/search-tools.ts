import { BackendApiClient, SearchResult } from '../backend-client';

const MAX_TOP_K = 50;

export interface SearchKbResult {
  results: Array<{
    chunkId: string;
    text: string;
    score: number;
    documentId: string;
    path?: string;
    language?: string;
    startLine?: number;
    endLine?: number;
    metadata?: Record<string, unknown>;
  }>;
  count: number;
  kbId: string;
  indexVersionId: string;
}

export interface SearchCodebaseResult {
  results: Array<{
    chunkId: string;
    text: string;
    score: number;
    documentId: string;
    path?: string;
    language?: string;
    branch?: string;
    commit?: string;
    startLine?: number;
    endLine?: number;
    metadata?: Record<string, unknown>;
  }>;
  count: number;
  kbId: string;
  indexVersionId: string;
}

export class SearchKbTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    kbId: string,
    query: string,
    topK: number = 10
  ): Promise<SearchKbResult> {
    const clampedTopK = Math.min(Math.max(topK, 1), MAX_TOP_K);
    const response = await this.client.search(kbId, query, clampedTopK);

    return {
      kbId,
      indexVersionId: response.indexVersionId,
      results: response.results.map((r: SearchResult) => ({
        chunkId: r.chunkId,
        text: r.text,
        score: r.score,
        documentId: r.documentId,
        path: r.path,
        language: r.language,
        startLine: r.startLine,
        endLine: r.endLine,
        metadata: r.metadata,
      })),
      count: response.results.length,
    };
  }
}

export class SearchCodebaseTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    kbId: string,
    query: string,
    options: { topK?: number; pathPrefix?: string; language?: string; branch?: string } = {}
  ): Promise<SearchCodebaseResult> {
    const clampedTopK = Math.min(
      Math.max(options.topK || 10, 1),
      MAX_TOP_K
    );
    const results = await this.client.searchCode(kbId, query, {
      topK: clampedTopK,
      pathPrefix: options.pathPrefix,
      language: options.language,
      branch: options.branch,
    });

    return {
      kbId,
      indexVersionId: results.indexVersionId,
      results: results.results.map((r: SearchResult) => ({
        chunkId: r.chunkId,
        text: r.text,
        score: r.score,
        documentId: r.documentId,
        path: r.path,
        language: r.language,
        branch: r.branch,
        commit: r.commit,
        startLine: r.startLine,
        endLine: r.endLine,
        metadata: r.metadata,
      })),
      count: results.results.length,
    };
  }
}
