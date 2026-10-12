import {
  BackendApiClient,
  DocumentContextResponse,
  KnowledgeBase,
  MemoryEntry,
  SearchResponse,
} from '../backend-client';

const MAX_TOP_K = 50;

export interface RetrieveContextInput {
  workspaceId: string;
  query: string;
  topK?: number;
  pathPrefix?: string;
  language?: string;
  branch?: string;
  scoreThreshold?: number;
  tokenBudget?: number;
}

export interface CompactSearchResult {
  chunkId: string;
  documentId: string;
  path?: string;
  sourceId?: string;
  text: string;
  score: number;
  startLine?: number;
  endLine?: number;
  language?: string;
  branch?: string;
  commit?: string;
}

export interface CompactSearchResponse {
  workspaceId: string;
  query: string;
  indexVersionId: string;
  count: number;
  results: CompactSearchResult[];
  budget?: { estimatedTokens: number };
}

export function toCompactSearchResponse(query: string, response: SearchResponse): CompactSearchResponse {
  const results = response.results.map((result) => ({
    chunkId: result.chunkId,
    documentId: result.documentId,
    ...(result.path ? { path: result.path } : {}),
    ...(result.sourceId ? { sourceId: result.sourceId } : {}),
    text: result.text,
    score: result.score,
    ...(result.startLine !== undefined ? { startLine: result.startLine } : {}),
    ...(result.endLine !== undefined ? { endLine: result.endLine } : {}),
    ...(result.language ? { language: result.language } : {}),
    ...(result.branch ? { branch: result.branch } : {}),
    ...(result.commit ? { commit: result.commit } : {}),
  }));

  const hasTokenCounts =
    response.results.length > 0 && response.results.every((result) => typeof result.tokenCount === 'number');
  const estimatedTokens = response.results.reduce(
    (sum, result) => sum + (typeof result.tokenCount === 'number' ? result.tokenCount : 0),
    0,
  );

  return {
    workspaceId: response.knowledgeBaseId,
    query,
    indexVersionId: response.indexVersionId,
    count: response.count,
    results,
    ...(hasTokenCounts ? { budget: { estimatedTokens } } : {}),
  };
}

export class RetrieveContextTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(input: RetrieveContextInput): Promise<CompactSearchResponse> {
    const topK = Math.min(Math.max(input.topK ?? 10, 1), MAX_TOP_K);
    const filters: Record<string, unknown> = {};
    if (input.pathPrefix) {
      filters.pathPrefix = input.pathPrefix;
    }
    if (input.language) {
      filters.language = input.language;
    }
    if (input.branch) {
      filters.branch = input.branch;
    }

    const response = await this.client.search(
      input.workspaceId,
      input.query,
      topK,
      Object.keys(filters).length > 0 ? filters : undefined,
      {
        scoreThreshold: input.scoreThreshold,
        tokenBudget: input.tokenBudget,
      },
    );

    return toCompactSearchResponse(input.query, response);
  }
}

export interface ReadDocumentInput {
  documentId: string;
  chunkId?: string;
  startLine?: number;
  endLine?: number;
  maxChars?: number;
}

export interface CompactDocumentResponse {
  documentId: string;
  path: string;
  text: string;
  chunkId?: string;
  startLine?: number;
  endLine?: number;
  mimeType?: string;
  language?: string;
  branch?: string;
  commit?: string;
  sourceId?: string;
}

export class ReadDocumentTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(input: ReadDocumentInput): Promise<CompactDocumentResponse> {
    const response = await this.client.getDocumentContext(input);
    return toCompactDocumentResponse(response);
  }
}

export interface CompactWorkspaceListResponse {
  workspaces: Array<{
    workspaceId: string;
    slug?: string;
    name: string;
    kind: string;
    activeIndexVersionId?: string;
    status: string;
    unavailableReason?: string;
  }>;
  count: number;
}

export class ListConsumerWorkspacesTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(): Promise<CompactWorkspaceListResponse> {
    const workspaces = await this.client.listWorkspaces();
    return {
      workspaces: workspaces.map((workspace: KnowledgeBase) => ({
        workspaceId: workspace.id,
        ...(workspace.slug ? { slug: workspace.slug } : {}),
        name: workspace.name,
        kind: workspace.workspaceKind || workspace.workspace?.kind || 'general',
        ...(workspace.activeIndexVersionId ? { activeIndexVersionId: workspace.activeIndexVersionId } : {}),
        status: workspaceStatus(workspace),
        ...(workspace.availability?.status === 'unavailable' && workspace.availability.reason
          ? { unavailableReason: workspace.availability.reason }
          : {}),
      })),
      count: workspaces.length,
    };
  }
}

function workspaceStatus(workspace: KnowledgeBase): string {
  if (workspace.availability?.status === 'available') {
    return 'ready';
  }
  if (workspace.availability?.status) {
    return workspace.availability.status;
  }
  return workspace.activeIndexVersionId ? 'ready' : 'unindexed';
}

export interface CompactMemoryItem {
  id: string;
  kind: string;
  body: string;
  title?: string;
  summary?: string;
  tags: string[];
  authoredBy?: string;
  sessionId?: string;
  occurredAt?: string;
  createdAt: string;
  updatedAt?: string;
  score?: number;
}

export interface CompactMemorySearchResponse {
  workspaceId: string;
  query: string;
  results: CompactMemoryItem[];
  count: number;
}

export interface CompactDecisionListResponse {
  workspaceId: string;
  results: CompactMemoryItem[];
  count: number;
}

export class SearchConsumerMemoryTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string, query: string, topK = 10): Promise<CompactMemorySearchResponse> {
    const response = await this.client.searchMemory(workspaceId, query, {
      topK: Math.min(Math.max(topK, 1), MAX_TOP_K),
      profileKey: 'memory-recall',
    });
    return {
      workspaceId: response.knowledgeBaseId,
      query,
      results: response.results.map(toCompactMemoryItem),
      count: response.count,
    };
  }
}

export class GetConsumerDecisionsTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string, limit = 5): Promise<CompactDecisionListResponse> {
    const response = await this.client.getRecentDecisions(workspaceId, limit);
    return {
      workspaceId: response.knowledgeBaseId,
      results: response.results.map(toCompactMemoryItem),
      count: response.count,
    };
  }
}

function toCompactDocumentResponse(response: DocumentContextResponse): CompactDocumentResponse {
  const { metadata } = response;
  return {
    documentId: response.documentId,
    path: response.path,
    text: response.text,
    ...optionalMetadataString(metadata, 'chunkId'),
    ...optionalMetadataNumber(metadata, 'startLine'),
    ...optionalMetadataNumber(metadata, 'endLine'),
    ...optionalMetadataString(metadata, 'mimeType'),
    ...optionalMetadataString(metadata, 'language'),
    ...optionalMetadataString(metadata, 'branch'),
    ...optionalMetadataString(metadata, 'commit'),
    ...optionalMetadataString(metadata, 'sourceId'),
  };
}

function toCompactMemoryItem(entry: MemoryEntry): CompactMemoryItem {
  return {
    id: entry.id,
    kind: entry.entryType,
    body: entry.body,
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.summary ? { summary: entry.summary } : {}),
    tags: entry.tags,
    ...(entry.authoredBy ? { authoredBy: entry.authoredBy } : {}),
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
    createdAt: entry.createdAt,
    ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    ...(typeof entry.score === 'number' ? { score: entry.score } : {}),
  };
}

function optionalMetadataString(metadata: Record<string, unknown>, key: string): Record<string, string> {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {};
}

function optionalMetadataNumber(metadata: Record<string, unknown>, key: string): Record<string, number> {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } : {};
}
