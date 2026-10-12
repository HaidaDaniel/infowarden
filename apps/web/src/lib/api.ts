import type {
  AskRequest,
  AskResponse,
  DashboardResponse,
  CreatedSourceResponse,
  CreateSourceRequest,
  EnqueueIndexingJobResponse,
  EvalProfileComparisonResponse,
  EvalQuestionsResponse,
  EvalRun,
  EvalRunComparisonResponse,
  EvalRunsResponse,
  JobDetailResponse,
  KnowledgeBaseDetailResponse,
  KnowledgeBaseListResponse,
  ManagedUploadSourceResponse,
  MemoryEntry,
  MemoryEntryType,
  MemorySearchResponse,
  RecentJobsResponse,
  RecentDecisionsResponse,
  RetrievalTraceResponse,
  RunEvalRequest,
  SourceRefreshRequest,
  SourceRefreshResponse,
  SourcePolicyResponse,
  SourcePolicyUpdateRequest,
  StandardBenchmarkImportResponse,
  WorkspaceKind,
  WorkspaceLifecycleResponse,
  WorkspaceRecord,
  WorkspaceResourceStatus,
  VectorBackendsReadModel,
  WorkspaceVectorPlacement,
  VectorMaterializationOperation,
  WorkspacesResponse,
  WorkspaceExportManifest,
} from './types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const API_BASE_URL =
  configuredApiBaseUrl === undefined || configuredApiBaseUrl === '' ? '/__api' : configuredApiBaseUrl;
const API_KEY_STORAGE_KEY = 'contextforge.studio.adminApiKey';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly code?: string,
    readonly stage?: string,
    readonly retryable?: boolean,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStoredApiKey() {
  return getStorage()?.getItem(API_KEY_STORAGE_KEY) ?? '';
}

export function setStoredApiKey(apiKey: string) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const trimmed = apiKey.trim();
  if (trimmed) {
    storage.setItem(API_KEY_STORAGE_KEY, trimmed);
  } else {
    storage.removeItem(API_KEY_STORAGE_KEY);
  }
}

function getAuthHeaders(): HeadersInit {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    return {};
  }

  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

async function assertOk(response: Response, path: string) {
  if (response.ok) {
    return;
  }

  if (response.status === 401) {
    throw new ApiRequestError(
      'API key required or invalid. Add the admin API key in Studio connection settings.',
      response.status,
      path,
    );
  }

  let responseMessage = '';
  let errorCode: string | undefined;
  let errorStage: string | undefined;
  let errorRetryable: boolean | undefined;
  let errorDetails: Record<string, unknown> | undefined;
  try {
    const body = (await response.clone().json()) as {
      message?: string | string[];
      error?:
        | string
        | { message?: string; code?: string; stage?: string; retryable?: boolean; details?: Record<string, unknown> };
    };
    if (Array.isArray(body.message)) {
      responseMessage = body.message.join('; ');
    } else if (body.message) {
      responseMessage = body.message;
    } else if (typeof body.error === 'string') {
      responseMessage = body.error;
    } else if (body.error?.message) {
      errorCode = body.error.code;
      errorStage = body.error.stage;
      errorRetryable = body.error.retryable;
      errorDetails = body.error.details;
      responseMessage = body.error.code ? `${body.error.code}: ${body.error.message}` : body.error.message;
    }
  } catch {
    responseMessage = '';
  }

  const suffix = responseMessage ? `: ${responseMessage}` : '';
  throw new ApiRequestError(
    `Request failed for ${path} with status ${response.status}${suffix}`,
    response.status,
    path,
    errorCode,
    errorStage,
    errorRetryable,
    errorDetails,
  );
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: getAuthHeaders(),
  });
  await assertOk(response, path);

  return (await response.json()) as T;
}

export function getApiBaseUrl() {
  if (API_BASE_URL) {
    if (API_BASE_URL.startsWith('/')) {
      return typeof window !== 'undefined' ? `${window.location.origin}${API_BASE_URL}` : API_BASE_URL;
    }
    return API_BASE_URL;
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return '';
}

export function fetchDashboard() {
  return getJson<DashboardResponse>('/admin/dashboard');
}

export function fetchKnowledgeBases() {
  return getJson<KnowledgeBaseListResponse>('/admin/knowledge-bases');
}

export function createWorkspace(body: {
  name: string;
  slug?: string;
  description?: string;
  workspaceKind?: WorkspaceKind;
}) {
  return postJson<WorkspaceRecord>('/workspaces', body);
}

export function fetchWorkspaces() {
  return getJson<WorkspacesResponse>('/workspaces');
}

export function fetchKnowledgeBaseOverview(identifier: string) {
  return getJson<KnowledgeBaseDetailResponse>(`/admin/knowledge-bases/${identifier}`);
}

export function fetchRecentJobs(limit = 8) {
  return getJson<RecentJobsResponse>(`/admin/jobs/recent?limit=${limit}`);
}

export function fetchJobDetail(jobId: string) {
  return getJson<JobDetailResponse>(`/jobs/indexing/${jobId}`);
}

export function fetchWorkspaceExportManifest(identifier: string) {
  return getJson<WorkspaceExportManifest>(`/workspaces/${identifier}/export-manifest`);
}

export function fetchWorkspaceResources(identifier: string) {
  return getJson<WorkspaceResourceStatus>(`/workspaces/${identifier}/resources`);
}

export function fetchVectorBackendsReadModel() {
  return getJson<VectorBackendsReadModel>('/vector-backends/read-model');
}

export function fetchWorkspaceVectorPlacement(identifier: string) {
  return getJson<WorkspaceVectorPlacement>(`/workspaces/${identifier}/vector-placement`);
}

export function pinWorkspaceVectorBackend(identifier: string, vectorBackendId: string) {
  return postJson<WorkspaceVectorPlacement>(`/workspaces/${identifier}/vector-placement/pin`, {
    vectorBackendId,
  });
}

export function createWorkspaceVectorOperation(
  identifier: string,
  body: {
    kind: 'full_rebuild' | 'backend_move';
    targetVectorBackendId?: string;
    rollbackRetentionHours?: number;
  },
) {
  return postJson<VectorMaterializationOperation>(`/workspaces/${identifier}/vector-operations`, body);
}

export function buildCompatibleVectorOperation(operationId: string) {
  return postJson<VectorMaterializationOperation>(`/vector-operations/${operationId}/build-compatible-copy`, {});
}

export function cutoverVectorOperation(operationId: string) {
  return postJson<VectorMaterializationOperation>(`/vector-operations/${operationId}/cutover`, {});
}

export function rollbackVectorOperation(operationId: string) {
  return postJson<VectorMaterializationOperation>(`/vector-operations/${operationId}/rollback`, {});
}

export function scheduleVectorOperationCleanup(operationId: string) {
  return postJson<VectorMaterializationOperation>(`/vector-operations/${operationId}/cleanup`, {});
}

export function loadWorkspace(identifier: string, body: { storageProfile?: string } = {}) {
  return postJson<WorkspaceLifecycleResponse>(`/workspaces/${identifier}/load`, body);
}

export function unloadWorkspace(identifier: string) {
  return postJson<WorkspaceLifecycleResponse>(`/workspaces/${identifier}/unload`, {});
}

export function createSource(body: CreateSourceRequest) {
  return postJson<CreatedSourceResponse>('/sources', body);
}

export function fetchWorkspaceSourcePolicy(identifier: string, sourceId: string) {
  return getJson<SourcePolicyResponse>(`/workspaces/${identifier}/sources/${sourceId}/policy`);
}

export function updateWorkspaceSourcePolicy(identifier: string, sourceId: string, body: SourcePolicyUpdateRequest) {
  return putJson<SourcePolicyResponse>(`/workspaces/${identifier}/sources/${sourceId}/policy`, body);
}

export function refreshWorkspaceSource(identifier: string, sourceId: string, body: SourceRefreshRequest) {
  return postJson<SourceRefreshResponse>(`/workspaces/${identifier}/sources/${sourceId}/refresh`, body);
}

export function uploadWorkspaceSource(
  identifier: string,
  body: {
    file: File;
    includeRules?: string;
    excludeRules?: string;
    sourceName?: string;
  },
) {
  const formData = new FormData();
  formData.set('file', body.file);
  if (body.includeRules?.trim()) {
    formData.set('includeRules', body.includeRules.trim());
  }
  if (body.excludeRules?.trim()) {
    formData.set('excludeRules', body.excludeRules.trim());
  }
  if (body.sourceName?.trim()) {
    formData.set('sourceName', body.sourceName.trim());
  }

  return postFormData<ManagedUploadSourceResponse>(`/workspaces/${identifier}/sources/upload`, formData);
}

export function enqueueIndexingJob(body: {
  knowledgeBaseId?: string;
  knowledgeBaseSlug?: string;
  sourceId: string;
  type: 'scan_source';
}) {
  return postJson<EnqueueIndexingJobResponse>('/jobs/indexing', body);
}

export function fetchMemoryEntries(
  identifier: string,
  filters: { entryType?: MemoryEntryType | ''; sessionId?: string; tag?: string } = {},
) {
  const params = new URLSearchParams();
  if (filters.entryType) {
    params.set('entryType', filters.entryType);
  }
  if (filters.sessionId?.trim()) {
    params.set('sessionId', filters.sessionId.trim());
  }
  if (filters.tag?.trim()) {
    params.set('tag', filters.tag.trim());
  }

  const query = params.toString();
  return getJson<MemoryEntry[]>(`/workspaces/${identifier}/memory${query ? `?${query}` : ''}`);
}

export function fetchRecentDecisions(identifier: string, limit = 5) {
  return getJson<RecentDecisionsResponse>(`/workspaces/${identifier}/recent-decisions?limit=${limit}`);
}

export async function createFactMemoryEntry(
  identifier: string,
  body: {
    title?: string;
    body: string;
    summary?: string;
    tags?: string[];
    authoredBy?: string;
    sessionId?: string;
  },
) {
  return postJson<MemoryEntry>(`/workspaces/${identifier}/memory`, {
    entryType: 'fact',
    ...body,
  });
}

export async function createDecisionMemoryEntry(
  identifier: string,
  body: {
    title: string;
    body: string;
    summary?: string;
    tags?: string[];
    authoredBy?: string;
    sessionId?: string;
  },
) {
  return postJson<MemoryEntry>(`/workspaces/${identifier}/memory/decisions`, body);
}

export async function createSessionSummaryMemoryEntry(
  identifier: string,
  body: {
    title?: string;
    body: string;
    summary?: string;
    tags?: string[];
    authoredBy?: string;
    sessionId: string;
  },
) {
  return postJson<MemoryEntry>(`/workspaces/${identifier}/memory/session-summaries`, body);
}

export async function searchMemoryEntries(
  identifier: string,
  body: {
    query: string;
    topK?: number;
    profileKey?: string;
  },
) {
  return postJson<MemorySearchResponse>(`/workspaces/${identifier}/search-memory`, body);
}

export async function runRetrievalPlayground(
  identifier: string,
  body: {
    query: string;
    topK?: number;
    tokenBudget?: number;
    profileKey?: string;
    pathPrefix?: string;
    language?: string;
    branch?: string;
    rerank?: RunEvalRequest['rerank'];
  },
) {
  const path = `/admin/knowledge-bases/${identifier}/retrieval-playground`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(body),
  });
  await assertOk(response, path);

  return (await response.json()) as RetrievalTraceResponse;
}

export function askWorkspace(identifier: string, body: AskRequest) {
  return postJson<AskResponse>(`/workspaces/${identifier}/ask`, body);
}

export function fetchEvalQuestions(identifier: string, datasetId?: string) {
  const params = new URLSearchParams();
  if (datasetId?.trim()) {
    params.set('datasetId', datasetId.trim());
  }
  const query = params.toString();
  return getJson<EvalQuestionsResponse>(`/workspaces/${identifier}/eval/questions${query ? `?${query}` : ''}`);
}

export function fetchEvalRuns(identifier: string, limit = 10) {
  return getJson<EvalRunsResponse>(`/workspaces/${identifier}/eval/runs?limit=${limit}`);
}

export function runRetrievalEval(identifier: string, body: RunEvalRequest) {
  return postJson<EvalRun>(`/workspaces/${identifier}/eval/runs`, body);
}

export function importStandardBenchmark(
  identifier: string,
  body: { profile?: string; force?: boolean; maxDocs?: number; maxQuestions?: number } = {},
) {
  return postJson<StandardBenchmarkImportResponse>(
    `/workspaces/${identifier}/benchmarks/cf-standard-benchmark/import`,
    body,
  );
}

export function compareEvalProfiles(identifier: string, body: RunEvalRequest & { profileKeys: string[] }) {
  return postJson<EvalProfileComparisonResponse>(`/workspaces/${identifier}/eval/profile-comparison`, body);
}

export function compareEvalRuns(identifier: string, body: { baselineRunId: string; candidateRunId: string }) {
  return postJson<EvalRunComparisonResponse>(`/workspaces/${identifier}/eval/run-comparison`, body);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(body),
  });
  await assertOk(response, path);

  return (await response.json()) as T;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(body),
  });
  await assertOk(response, path);

  return (await response.json()) as T;
}

async function postFormData<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body,
  });
  await assertOk(response, path);

  return (await response.json()) as T;
}
