import { randomBytes } from 'node:crypto';

export interface KnowledgeBase {
  id: string;
  slug?: string;
  name: string;
  description?: string;
  workspaceKind?: string;
  defaultIndexProfile?: string;
  defaultRetrievalProfile?: string;
  activeIndexVersionId?: string;
  availability?: WorkspaceAvailability;
  createdAt: string;
  updatedAt: string;
  workspace?: {
    id: string;
    slug: string;
    name: string;
    kind: string;
    defaultIndexProfile?: string;
    defaultRetrievalProfile?: string;
    availability?: WorkspaceAvailability;
    compatibility?: Record<string, unknown>;
  };
}

export interface WorkspaceAvailability {
  status: 'available' | 'unavailable' | 'unindexed';
  reason?: string;
  retryable?: boolean;
  provider?: {
    source: 'provider_config' | 'environment';
    name: string;
    model: string;
    dimension: number;
  };
}

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
  metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  knowledgeBaseId: string;
  indexVersionId: string;
  retrievalProfile?: {
    key: string;
    name: string;
    intent: string;
    denseTopK: number;
    scoreThreshold?: number;
    neighborBefore: number;
    neighborAfter: number;
    tokenBudget?: number;
    grouping: string;
    recencyBoost: boolean;
  };
  results: SearchResult[];
  count: number;
}

export interface MemoryEntry {
  id: string;
  entryType: string;
  title?: string;
  summary?: string;
  body: string;
  tags: string[];
  authoredBy?: string;
  sessionId?: string;
  sourceRefs?: string[];
  occurredAt?: string;
  createdAt: string;
  updatedAt?: string;
  metadata: Record<string, unknown>;
  score?: number;
}

export interface MemorySearchResponse {
  knowledgeBaseId: string;
  retrievalProfile?: SearchResponse['retrievalProfile'];
  results: MemoryEntry[];
  count: number;
}

export interface ContextPackageResponse {
  knowledgeBaseId: string;
  indexVersionId: string;
  retrievalProfile: NonNullable<SearchResponse['retrievalProfile']>;
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
    denseCandidates: number;
    reranked: boolean;
    expandedNeighbors: number;
    droppedDuplicates: number;
  };
}

export type AskMode = 'chunks' | 'rag_answer';

export interface AskRequest {
  mode?: AskMode;
  query: string;
  topK?: number;
  profileKey?: string;
  tokenBudget?: number;
  filters?: Record<string, unknown>;
  llm?: {
    providerId?: string;
    providerName?: string;
    maxOutputTokens?: number;
    temperature?: number;
  };
}

export interface AskResponse {
  mode: AskMode;
  knowledgeBaseId: string;
  indexVersionId: string;
  query: string;
  retrievalTraceId: string;
  retrievalTrace: Record<string, unknown>;
  contextPackage: Record<string, unknown>;
  answer?: string;
  citations: Array<{
    id: string;
    chunkId: string;
    documentId: string;
    sourceId?: string;
    sourceRevisionId?: string;
    path?: string;
    startLine?: number;
    endLine?: number;
  }>;
  sourceIds: string[];
  provider?: {
    providerConfigId: string;
    name: string;
    model: string;
    protocol: string;
  };
  diagnostics: Record<string, unknown>;
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

export interface IndexVersion {
  id: string;
  knowledgeBaseId: string;
  embeddingModel: string;
  embeddingDimension: number;
  vectorCollectionName: string;
  status: 'building' | 'active' | 'failed' | 'archived';
  createdAt: string;
}

export interface SystemResourceStatus {
  target: Record<string, unknown>;
  host: Record<string, unknown>;
  disks: unknown[];
  qdrant: {
    collections: number;
    items: unknown[];
  };
  warnings: unknown[];
}

export interface WorkspaceResourceStatus {
  workspace: {
    id: string;
    slug?: string;
    name: string;
    kind: string;
  };
  lifecycle: {
    status: string;
    activeIndexVersionId?: string | null;
    vectorCollectionName?: string | null;
    collectionAvailable: boolean;
  };
  activeIndexVersion?: {
    id: string;
    status: string;
    lifecycleStatus: string;
    embeddingModel: string;
    embeddingDimension: number;
    storageProfile: string;
    storageConfig?: Record<string, unknown>;
    resourceEstimate?: Record<string, unknown>;
    resourceActual?: Record<string, unknown>;
    createdAt: string;
  } | null;
  estimate?: Record<string, unknown>;
  qdrantCollection?: unknown;
}

export interface WorkspaceLifecycleResponse {
  workspace: WorkspaceResourceStatus['workspace'];
  lifecycle: WorkspaceResourceStatus['lifecycle'];
  job?: unknown;
}

export interface VectorBackendsReadModel {
  policy: Record<string, unknown>;
  backends: Array<Record<string, unknown>>;
}

export interface WorkspaceVectorPlacement {
  id: string;
  vectorBackendId: string;
  collectionAlias: string;
  physicalCollectionName?: string | null;
  mode: string;
  state: string;
  reasonSnapshot?: Record<string, unknown>;
  capacitySnapshot?: Record<string, unknown>;
}

export interface VectorMaterializationOperation {
  id: string;
  knowledgeBaseId: string;
  kind: string;
  state: string;
  targetVectorBackendId: string;
  rollbackUntil?: string | null;
  cleanupAfter?: string | null;
}

export interface ApiError extends Error {
  status: number;
  body: unknown;
}

export class BackendApiClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      traceparent: this.traceparent(),
      ...((options?.headers as Record<string, string>) || {}),
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => ({}));
      const bodyRecord =
        body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const nestedError =
        bodyRecord.error && typeof bodyRecord.error === 'object' && !Array.isArray(bodyRecord.error)
          ? (bodyRecord.error as Record<string, unknown>)
          : {};
      const message =
        bodyRecord.message ||
        nestedError.message ||
        (typeof bodyRecord.error === 'string' ? bodyRecord.error : undefined) ||
        `API Error: ${response.status}`;
      const error: ApiError = new Error(`Backend API ${response.status}: ${message}`) as ApiError;
      error.status = response.status;
      error.body = body;
      throw error;
    }

    return (await response.json()) as T;
  }

  private traceparent(): string {
    return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    return this.request<KnowledgeBase[]>('/knowledge-bases');
  }

  async listWorkspaces(): Promise<KnowledgeBase[]> {
    return this.request<KnowledgeBase[]>('/workspaces');
  }

  async getKnowledgeBase(id: string): Promise<KnowledgeBase> {
    return this.request<KnowledgeBase>(`/knowledge-bases/${id}`);
  }

  async getWorkspace(id: string): Promise<KnowledgeBase> {
    return this.request<KnowledgeBase>(`/workspaces/${id}`);
  }

  async getIndexStatus(knowledgeBaseId: string): Promise<IndexVersion | null> {
    try {
      const kb = await this.getKnowledgeBase(knowledgeBaseId);
      if (!kb.activeIndexVersionId) {
        return null;
      }
      return {
        id: kb.activeIndexVersionId,
        knowledgeBaseId,
        embeddingModel: '',
        embeddingDimension: 0,
        vectorCollectionName: '',
        status: 'active',
        createdAt: kb.createdAt,
      };
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getResourceStatus(): Promise<SystemResourceStatus> {
    return this.request<SystemResourceStatus>('/resources/system');
  }

  async getWorkspaceResourceStatus(workspaceId: string): Promise<WorkspaceResourceStatus> {
    return this.request<WorkspaceResourceStatus>(`/workspaces/${workspaceId}/resources`);
  }

  async unloadWorkspace(workspaceId: string): Promise<WorkspaceLifecycleResponse> {
    return this.request<WorkspaceLifecycleResponse>(`/workspaces/${workspaceId}/unload`, {
      method: 'POST',
    });
  }

  async loadWorkspace(
    workspaceId: string,
    options: { storageProfile?: string } = {},
  ): Promise<WorkspaceLifecycleResponse> {
    return this.request<WorkspaceLifecycleResponse>(`/workspaces/${workspaceId}/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storageProfile: options.storageProfile,
      }),
    });
  }

  async getVectorBackends(): Promise<VectorBackendsReadModel> {
    return this.request<VectorBackendsReadModel>('/vector-backends/read-model');
  }

  async getWorkspaceVectorPlacement(workspaceId: string): Promise<WorkspaceVectorPlacement> {
    return this.request<WorkspaceVectorPlacement>(`/workspaces/${workspaceId}/vector-placement`);
  }

  async pinWorkspaceVectorBackend(workspaceId: string, vectorBackendId: string): Promise<WorkspaceVectorPlacement> {
    return this.request<WorkspaceVectorPlacement>(`/workspaces/${workspaceId}/vector-placement/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectorBackendId }),
    });
  }

  async createVectorOperation(
    workspaceId: string,
    body: {
      kind: 'full_rebuild' | 'backend_move';
      targetVectorBackendId?: string;
      rollbackRetentionHours?: number;
    },
  ): Promise<VectorMaterializationOperation> {
    return this.request<VectorMaterializationOperation>(`/workspaces/${workspaceId}/vector-operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async rollbackVectorOperation(operationId: string): Promise<VectorMaterializationOperation> {
    return this.request<VectorMaterializationOperation>(`/vector-operations/${operationId}/rollback`, {
      method: 'POST',
    });
  }

  async cleanupVectorOperation(operationId: string): Promise<VectorMaterializationOperation> {
    return this.request<VectorMaterializationOperation>(`/vector-operations/${operationId}/cleanup`, {
      method: 'POST',
    });
  }

  async search(
    knowledgeBaseId: string,
    query: string,
    topK: number = 10,
    filters?: Record<string, unknown>,
    options?: { profileKey?: string; tokenBudget?: number; scoreThreshold?: number },
  ): Promise<SearchResponse> {
    return this.request<SearchResponse>(`/knowledge-bases/${knowledgeBaseId}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        topK,
        filters,
        profileKey: options?.profileKey,
        tokenBudget: options?.tokenBudget,
        scoreThreshold: options?.scoreThreshold,
      }),
    });
  }

  async searchCode(
    knowledgeBaseId: string,
    query: string,
    options: {
      topK?: number;
      pathPrefix?: string;
      language?: string;
      branch?: string;
      profileKey?: string;
      tokenBudget?: number;
    } = {},
  ): Promise<SearchResponse> {
    return this.request<SearchResponse>(`/knowledge-bases/${knowledgeBaseId}/search-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        topK: options.topK,
        pathPrefix: options.pathPrefix,
        language: options.language,
        branch: options.branch,
        profileKey: options.profileKey,
        tokenBudget: options.tokenBudget,
      }),
    });
  }

  async searchMemory(
    knowledgeBaseId: string,
    query: string,
    options: { topK?: number; profileKey?: string } = {},
  ): Promise<MemorySearchResponse> {
    return this.request<MemorySearchResponse>(`/knowledge-bases/${knowledgeBaseId}/search-memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        topK: options.topK,
        profileKey: options.profileKey,
      }),
    });
  }

  async getContextPackage(
    knowledgeBaseId: string,
    query: string,
    options: {
      topK?: number;
      profileKey?: string;
      tokenBudget?: number;
      pathPrefix?: string;
      language?: string;
      branch?: string;
      filters?: Record<string, unknown>;
    } = {},
  ): Promise<ContextPackageResponse> {
    return this.request<ContextPackageResponse>(`/knowledge-bases/${knowledgeBaseId}/context-package`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        topK: options.topK,
        profileKey: options.profileKey,
        tokenBudget: options.tokenBudget,
        pathPrefix: options.pathPrefix,
        language: options.language,
        branch: options.branch,
        filters: options.filters,
      }),
    });
  }

  async ask(workspaceId: string, input: AskRequest): Promise<AskResponse> {
    return this.request<AskResponse>(`/workspaces/${workspaceId}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async getRecentDecisions(
    knowledgeBaseId: string,
    limit = 5,
  ): Promise<{ knowledgeBaseId: string; results: MemoryEntry[]; count: number }> {
    return this.request(`/knowledge-bases/${knowledgeBaseId}/recent-decisions${this.buildQuery({ limit })}`);
  }

  async saveSessionSummary(
    knowledgeBaseId: string,
    input: {
      title?: string;
      body: string;
      summary?: string;
      sessionId: string;
      authoredBy?: string;
      tags?: string[];
      sourceRefs?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<MemoryEntry> {
    return this.request<MemoryEntry>(`/knowledge-bases/${knowledgeBaseId}/memory/session-summaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async rememberFact(
    knowledgeBaseId: string,
    input: {
      body: string;
      title?: string;
      summary?: string;
      tags?: string[];
      authoredBy?: string;
      sessionId?: string;
      sourceRefs?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<MemoryEntry> {
    return this.request<MemoryEntry>(`/knowledge-bases/${knowledgeBaseId}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        entryType: 'fact',
      }),
    });
  }

  async createMemoryEntry(
    knowledgeBaseId: string,
    input: {
      entryType: string;
      body: string;
      title?: string;
      summary?: string;
      tags?: string[];
      authoredBy?: string;
      sessionId?: string;
      sourceRefs?: string[];
      occurredAt?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<MemoryEntry> {
    return this.request<MemoryEntry>(`/knowledge-bases/${knowledgeBaseId}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async updateMemoryEntry(
    knowledgeBaseId: string,
    entryId: string,
    input: {
      entryType?: string;
      body?: string;
      title?: string;
      summary?: string;
      tags?: string[];
      authoredBy?: string;
      sessionId?: string;
      sourceRefs?: string[];
      occurredAt?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<MemoryEntry> {
    return this.request<MemoryEntry>(`/knowledge-bases/${knowledgeBaseId}/memory/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async archiveMemoryEntry(knowledgeBaseId: string, entryId: string, reason?: string): Promise<MemoryEntry> {
    return this.request<MemoryEntry>(`/knowledge-bases/${knowledgeBaseId}/memory/${entryId}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
  }

  async deleteMemoryEntry(
    knowledgeBaseId: string,
    entryId: string,
  ): Promise<{ id: string; knowledgeBaseId: string; deleted: boolean }> {
    return this.request(`/knowledge-bases/${knowledgeBaseId}/memory/${entryId}`, {
      method: 'DELETE',
    });
  }

  async getDocumentContext(options: {
    documentId: string;
    chunkId?: string;
    startLine?: number;
    endLine?: number;
    maxChars?: number;
  }): Promise<DocumentContextResponse> {
    return this.request<DocumentContextResponse>(
      `/documents/${options.documentId}${this.buildQuery({
        chunkId: options.chunkId,
        startLine: options.startLine,
        endLine: options.endLine,
        maxChars: options.maxChars,
      })}`,
    );
  }

  async getChunkNeighbors(
    chunkId: string,
    options: { before?: number; after?: number } = {},
  ): Promise<ChunkNeighborsResponse> {
    return this.request<ChunkNeighborsResponse>(
      `/chunks/${chunkId}/neighbors${this.buildQuery({
        before: options.before,
        after: options.after,
      })}`,
    );
  }

  private buildQuery(params: Record<string, unknown>): string {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    }

    const query = searchParams.toString();
    return query ? `?${query}` : '';
  }
}
