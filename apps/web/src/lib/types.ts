export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type WorkspaceKind =
  | 'general'
  | 'codebase'
  | 'docs'
  | 'agent_memory'
  | 'ops_context'
  | 'personal_work_history'
  | 'benchmarks'
  | 'contracts'
  | 'datasets'
  | 'custom';

export type JobProgress = {
  added: number | null;
  changed: number | null;
  deleted: number | null;
  unchanged: number | null;
  filesScanned: number | null;
  filesParsed: number | null;
  filesIgnored: number | null;
  parseFailures: number | null;
  chunksCreated: number | null;
  chunksDeleted?: number | null;
  chunksReused?: number | null;
  vectorsDeleted: number | null;
  vectorsUpserted: number | null;
  payloadsUpdated?: number | null;
  documentsCreated: number | null;
  documentsChanged: number | null;
  documentsDeleted: number | null;
  documentsSkipped: number | null;
  validationReportId: string | null;
};

export type JobErrorSummary = {
  at: string | null;
  message: string;
  code: string | null;
  stage: string | null;
} | null;

export type JobSummary = {
  id: string;
  knowledgeBase: {
    id: string;
    slug: string;
    name: string;
  };
  source: {
    id: string;
    type: string;
    uri: string;
    status: string;
  } | null;
  type: string;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: JobProgress;
  lastErrorSummary: JobErrorSummary;
  lastLogAt: string | null;
};

export type DashboardResponse = {
  totals: {
    knowledgeBases: number;
    sources: number;
    documents: number;
    activeIndexes: number;
  };
  jobs: Record<JobStatus, number>;
  lastSuccessfulIndexAt: string | null;
  recentJobs: JobSummary[];
  system: {
    health: {
      status: 'healthy' | 'degraded';
      timestamp: string;
      services: Record<
        string,
        {
          status: 'up' | 'down' | 'not_configured';
          error?: string;
          code?: string;
          retryable?: boolean;
          details?: Record<string, unknown>;
        }
      >;
    };
    queue: {
      queued: number;
      running: number;
      succeededLastHour: number;
      failedLast24Hours: number;
      pressure: 'idle' | 'active' | 'backlogged';
    };
    workspaceKinds: Record<string, number>;
    collections: {
      totalActiveCollections: number;
      totalChunks: number;
      items: Array<{
        knowledgeBaseId: string;
        knowledgeBaseSlug: string;
        knowledgeBaseName: string;
        workspaceKind: string;
        indexVersionId: string;
        vectorCollectionName: string;
        materializationMode: string;
        chunkCount: number;
        createdAt: string;
        embeddingModel: string;
        embeddingDimension: number;
      }>;
    };
  };
};

export type KnowledgeBaseCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  activeIndexVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    sources: number;
    activeSources: number;
    documents: number;
    indexVersions: number;
    jobs: number;
  };
  lastSuccessfulIndexAt: string | null;
  lastJobStatus: JobStatus | null;
  lastErrorSummary: JobErrorSummary;
};

export type KnowledgeBaseListResponse = {
  knowledgeBases: KnowledgeBaseCard[];
};

export type WorkspaceRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  workspaceKind: WorkspaceKind;
  defaultIndexProfile: string;
  defaultRetrievalProfile: string;
  activeIndexVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspacesResponse = WorkspaceRecord[];

export type StorageProfile = 'fast' | 'balanced' | 'low_memory' | 'benchmark_remote';

export type ResourceWarning = {
  code: string;
  message: string;
};

export type VectorBackendRecord = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyRef: string | null;
  hasApiKeyRef: boolean;
  tlsVerify: boolean;
  labels: string[];
  state: 'enabled' | 'draining' | 'disabled' | 'offline' | string;
  capacityHints: Record<string, unknown>;
  observedResources: Record<string, unknown>;
  healthMetadata: Record<string, unknown>;
  lastHealthAt: string | null;
  lastErrorCode: string | null;
  assignedWorkspaceCount?: number;
  assignedWorkspaces?: Array<{
    workspace: {
      id: string;
      slug: string;
      name: string;
      workspaceKind: string;
      servingRevisionState: string;
      activeIndexVersionId: string | null;
    };
    placement: WorkspaceVectorPlacement;
    lifecycleErrors: Array<Record<string, unknown>>;
  }>;
  operations?: VectorMaterializationOperation[];
};

export type WorkspaceVectorPlacement = {
  id: string;
  knowledgeBaseId?: string;
  vectorBackendId: string;
  servingRevisionId: string | null;
  activeIndexBuildId: string | null;
  collectionAlias: string;
  physicalCollectionName: string | null;
  mode: 'pinned' | 'capacity_assisted' | string;
  state: 'unloaded' | 'loading' | 'loaded' | 'partially_loaded' | 'degraded' | 'failed' | 'migrating' | string;
  reasonSnapshot: Record<string, unknown>;
  capacitySnapshot: Record<string, unknown>;
  updatedAt?: string;
  vectorBackend?: VectorBackendRecord;
};

export type VectorMaterializationOperation = {
  id: string;
  knowledgeBaseId: string;
  kind: 'full_rebuild' | 'backend_move' | string;
  state: string;
  sourceVectorBackendId: string | null;
  targetVectorBackendId: string;
  sourceCollectionName: string | null;
  targetCollectionName: string;
  servingRevisionId: string | null;
  rollbackUntil: string | null;
  cleanupAfter: string | null;
  validationSummary: Record<string, unknown>;
  errorSummary: Record<string, unknown>;
  updatedAt: string;
};

export type VectorBackendsReadModel = {
  policy: {
    topology: string;
    oneWorkspaceOneBackend: boolean;
    automaticFailover: boolean;
    transparentSharding: boolean;
    replicas: boolean;
    note: string;
  };
  backends: VectorBackendRecord[];
};

export type WorkspaceResourceStatus = {
  workspace: {
    id: string;
    slug: string;
    name: string;
    workspaceKind: string;
  };
  lifecycle: {
    status: 'loaded' | 'unloaded' | 'loading' | 'unloading' | 'failed' | string;
    activeIndexVersionId: string | null;
    vectorCollectionName: string | null;
    vectorBackendId?: string | null;
    placementState?: string | null;
    collectionAvailable: boolean;
  };
  activeIndexVersion: {
    id: string;
    status: string;
    lifecycleStatus: string;
    embeddingModel: string;
    embeddingDimension: number;
    storageProfile: StorageProfile | string;
    storageConfig: Record<string, unknown>;
    resourceEstimate: Record<string, unknown>;
    resourceRequested?: Record<string, unknown>;
    resourceAllocated?: Record<string, unknown>;
    resourceObserved?: Record<string, unknown>;
    resourceActual: Record<string, unknown>;
    createdAt: string;
  } | null;
  resources?: {
    estimate: Record<string, unknown>;
    requested: Record<string, unknown>;
    allocated: Record<string, unknown>;
    observed: Record<string, unknown>;
  };
  estimate: {
    storageProfile: StorageProfile | string;
    documentCount: number;
    sourceFileCount: number;
    sourceContentBytes: number;
    estimatedChunks: number;
    embeddingDimension: number;
    rawVectorBytes: number;
    qdrantDiskBytesLow: number;
    qdrantDiskBytesHigh: number;
    estimatedRamBytes: number;
    warnings: ResourceWarning[];
    generatedAt: string;
  };
};

export type WorkspaceLifecycleResponse = {
  workspace: WorkspaceResourceStatus['workspace'];
  lifecycle: WorkspaceResourceStatus['lifecycle'];
  job?: { id: string } | null;
};

export type KnowledgeBaseSource = {
  id: string;
  type: string;
  uri: string;
  status: string;
  includeRules: string[];
  excludeRules: string[];
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
  lastSnapshot: {
    at: string;
    ref: string | null;
    snapshotType: string;
    fileCount: number;
    contentBytes: number;
  } | null;
  lastSuccessfulIndexAt: string | null;
  lastJob: JobSummary | null;
  lastErrorSummary: JobErrorSummary;
};

export type SourceRefreshMode = 'incremental' | 'force_reembed' | 'force_rechunk' | 'rebuild_collection';

export type SourceSyncTriggerMode = 'manual' | 'schedule' | 'webhook' | 'watch';

export type SourceTruthPolicy = {
  truthMode: 'read_only';
  writePolicy: 'disabled';
  reason?: string;
};

export type SourceSyncPolicy = {
  triggerMode: SourceSyncTriggerMode;
  enabled: boolean;
  schedule?: string;
  webhookSecretRef?: string;
  watchDebounceMs?: number;
  mode: SourceRefreshMode;
  reason?: string;
};

export type SourcePolicyResponse = {
  source: {
    id: string;
    knowledgeBaseId: string;
    type: string;
    uri: string;
    status: string;
  };
  sourceTruthPolicy: SourceTruthPolicy;
  syncPolicy: SourceSyncPolicy;
  autoRefreshEnabled: boolean;
  lastSyncedAt: string | null;
  nextTriggerAt: string | null;
};

export type SourcePolicyUpdateRequest = {
  sourceTruthPolicy?: Partial<SourceTruthPolicy>;
  syncPolicy?: Partial<SourceSyncPolicy> & Pick<SourceSyncPolicy, 'triggerMode'>;
};

export type CreateSourceRequest = {
  knowledgeBaseId?: string;
  knowledgeBaseSlug?: string;
  type: 'local_folder' | 'obsidian_vault' | 'git_repo' | 'url' | 'upload' | string;
  uri: string;
  includeRules?: string[];
  excludeRules?: string[];
};

export type CreatedSourceResponse = {
  id: string;
  knowledgeBaseId: string;
  type: string;
  uri: string;
  includeRules: string[];
  excludeRules: string[];
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SourceRefreshRequest = {
  mode?: SourceRefreshMode;
  reason?: string;
  dryRun?: boolean;
};

export type SourceRefreshPlan = {
  dryRun: true;
  mode: SourceRefreshMode;
  reason?: string;
  workspace: {
    id: string;
    slug: string;
    name: string;
    workspaceKind: string;
  };
  source: {
    id: string;
    type: string;
    uri: string;
    status: string;
  };
  preparedSource?: {
    scanRoot: string;
    git?: {
      branch: string;
      commit: string;
      clonePath: string;
    };
  };
  plan: {
    stats: {
      filesParsed?: number;
      filesIgnored?: number;
      parseFailures?: number;
      added?: number;
      changed?: number;
      unchanged?: number;
      deleted?: number;
      documentsDeleted?: number;
      documentsSkipped?: number;
      dependencyCandidates?: number;
    };
    addedPaths: string[];
    changedPaths: string[];
    unchangedCount: number;
    deletedPaths: string[];
    dependencyHints: Array<{
      path: string;
      dependsOn: string[];
    }>;
    validationIssues: Array<{
      severity?: string;
      code?: string;
      message: string;
      metadata?: Record<string, unknown>;
    }>;
  };
};

export type SourceRefreshJobResponse = {
  dryRun: false;
  mode: SourceRefreshMode;
  reason?: string;
  workspace: {
    id: string;
    slug: string;
    name: string;
    workspaceKind: string;
  };
  source: {
    id: string;
    type: string;
    uri: string;
    status: string;
  };
  job: {
    id: string;
  };
};

export type SourceRefreshResponse = SourceRefreshPlan | SourceRefreshJobResponse;

export type ManagedUploadSourceResponse = {
  workspace: {
    id: string;
    slug: string;
    name: string;
    workspaceKind: string;
  };
  upload: {
    id: string;
    originalFileName: string;
    archiveFormat: 'single_file' | 'zip';
    sizeBytes: number;
    fileCount: number;
    contentBytes: number;
    uploadedAt: string;
  };
  source: {
    id: string;
    knowledgeBaseId: string;
    type: string;
    uri: string;
    includeRules: string[];
    excludeRules: string[];
    status: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  next: {
    enqueueIndexing: {
      method: 'POST';
      path: string;
      body: {
        knowledgeBaseId: string;
        sourceId: string;
        type: 'scan_source';
      };
    };
  };
};

export type EnqueueIndexingJobResponse = {
  id: string;
};

export type KnowledgeBaseDetailResponse = {
  knowledgeBase: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    workspaceKind: string;
    defaultRetrievalProfile: string;
    activeIndexVersionId: string | null;
    createdAt: string;
    updatedAt: string;
    counts: {
      sources: number;
      documents: number;
      indexVersions: number;
      jobs: number;
    };
    lastSuccessfulIndexAt: string | null;
    lastJobStatus: JobStatus | null;
    lastErrorSummary: JobErrorSummary;
    activeIndexVersion: {
      id: string;
      status?: string;
      createdAt?: string;
      embeddingModel?: string;
      embeddingDimension?: number;
      vectorCollectionName?: string;
      materializationMode?: string;
    } | null;
    indexVersions: Array<{
      id: string;
      status: string;
      createdAt: string;
      embeddingModel: string;
      embeddingDimension: number;
      vectorCollectionName: string;
      materializationMode: string;
    }>;
    sources: KnowledgeBaseSource[];
  };
  recentJobs: JobSummary[];
  explorer: {
    documentLimit: number;
    documents: Array<{
      id: string;
      sourceId: string;
      path: string;
      mimeType: string;
      contentHash: string;
      status: string;
      chunkCount: number;
      metadata: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  retrievalPlayground: {
    defaultProfileKey: string;
    profiles: Array<{
      key: string;
      name: string;
      intent: string;
      denseTopK: number;
      scoreThreshold: number | null;
      neighborBefore: number;
      neighborAfter: number;
      tokenBudget: number | null;
      grouping: string;
      recencyBoost: boolean;
    }>;
    activeCollection: {
      indexVersionId: string;
      vectorCollectionName: string;
      materializationMode: string;
      embeddingModel: string;
      embeddingDimension: number;
      createdAt: string;
    } | null;
    suggestedRequest: {
      queryPlaceholder: string;
      topK: number;
      tokenBudget: number;
    };
  };
};

export type RecentJobsResponse = {
  filters: {
    knowledgeBaseId: string | null;
    knowledgeBaseSlug: string | null;
    sourceId: string | null;
    limit: number;
  };
  jobs: JobSummary[];
};

export type JobDetailResponse = {
  id: string;
  knowledgeBaseId: string;
  sourceId: string | null;
  type: string;
  status: JobStatus;
  stats: Record<string, unknown>;
  logs: Array<{
    at: string;
    level: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  error?: string;
};

export type RetrievalTraceResponse = {
  knowledgeBase: {
    id: string;
    slug: string;
    name: string;
    workspaceKind: string;
    defaultRetrievalProfile: string;
  };
  request: {
    query: string;
    topK: number | null;
    tokenBudget: number | null;
    profileKey: string;
    filters: Record<string, unknown> | null;
  };
  trace: {
    knowledgeBaseId: string;
    indexVersionId: string;
    query: string;
    retrievalProfile: {
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
    appliedFilters?: Record<string, unknown>;
    stages: {
      denseCandidates: RetrievalTraceItem[];
      lexicalCandidates?: RetrievalTraceItem[];
      mergedCandidates?: RetrievalTraceItem[];
      filteredCandidates: RetrievalTraceItem[];
      dedupedCandidates: RetrievalTraceItem[];
      rerankedCandidates?: RetrievalTraceItem[];
      expandedCandidates: RetrievalTraceItem[];
      finalCandidates?: RetrievalTraceItem[];
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
        items: RetrievalTraceItem[];
      }>;
    };
    diagnostics: {
      denseCandidates: number;
      filteredCandidates: number;
      droppedByFilters: number;
      droppedDuplicates: number;
      expandedNeighbors: number;
      finalCount: number;
      reranked: boolean;
      rerankerFallbackUsed?: boolean;
      rerankerReason?: string;
      rerankerCandidateCount?: number;
      reranker?: RerankerDiagnostics;
    };
  };
};

export type RerankRequest = {
  enabled?: boolean;
  providerId?: string;
  providerName?: string;
  topN?: number;
  fallbackAllowed?: boolean;
};

export type RerankerDiagnostics = {
  enabled?: boolean;
  source?: 'profile' | 'request' | 'none' | string;
  reason?: string;
  providerId?: string;
  providerName?: string;
  model?: string;
  topN?: number;
  fallbackAllowed?: boolean;
  [key: string]: unknown;
};

export type RetrievalTraceItem = {
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
};

export type EvalMetrics = {
  profileKey?: string;
  datasetId?: string;
  datasetVersion?: string;
  datasetVersionId?: string;
  questionCount?: number;
  topK?: number;
  hitAt1?: number;
  hitAt3?: number;
  hitAtK?: number;
  mrr?: number;
  expectedDocumentHitRate?: number;
  expectedChunkHitRate?: number;
  emptyResultRate?: number;
  duplicateRate?: number;
  latencyMs?: {
    p50?: number;
    p95?: number;
    min?: number;
    max?: number;
  };
  reranker?: {
    comparedQuestions?: number;
    meanReciprocalRankDelta?: number;
    changedTopRate?: number;
  };
  configHash?: string;
  config?: Record<string, unknown>;
  error?: Record<string, unknown>;
  [key: string]: unknown;
};

export type EvalQuestion = {
  id: string;
  knowledgeBaseId: string;
  text: string;
  expectedDocumentIds: string[];
  expectedChunkIds: string[];
  metadata: Record<string, unknown>;
  createdAt?: string;
};

export type EvalResult = {
  id: string;
  evalRunId: string;
  evalQuestionId: string;
  retrievedChunkIds: string[];
  scores: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type EvalRun = {
  id: string;
  knowledgeBaseId: string;
  indexVersionId: string;
  name: string;
  status: string;
  metrics: EvalMetrics;
  createdAt: string;
  finishedAt: string | null;
  results?: EvalResult[];
};

export type EvalQuestionsResponse = {
  knowledgeBaseId: string;
  questions: EvalQuestion[];
};

export type EvalRunsResponse = {
  knowledgeBaseId: string;
  runs: EvalRun[];
};

export type StandardBenchmarkImportResponse = {
  datasetId: string;
  datasetVersion: string;
  profile: string;
  packPath: string;
  documents: number;
  questions: number;
  source: {
    id: string;
    uri: string;
    created: boolean;
  };
  indexingJob: {
    id: string;
  };
  next: {
    datasetId: string;
    profileKey: string;
    topK: number;
  };
};

export type RunEvalRequest = {
  name?: string;
  profileKey?: string;
  datasetId?: string;
  datasetVersion?: string;
  topK?: number;
  rerank?: RerankRequest;
};

export type EvalProfileComparisonResponse = {
  profileKeys: string[];
  runs: EvalRun[];
  summary: Array<{
    runId: string;
    profileKey?: string;
    metrics: EvalMetrics;
    deltasFromBaseline?: Record<string, number>;
  }>;
};

export type EvalRunComparisonResponse = {
  baselineRunId: string;
  candidateRunId: string;
  baselineMetrics: EvalMetrics;
  candidateMetrics: EvalMetrics;
  metricDeltas: Record<string, number>;
  config: {
    baselineHash?: unknown;
    candidateHash?: unknown;
    changed: boolean;
  };
  perQuestionDeltas: Array<{
    evalQuestionId: string;
    deltas: Record<string, number>;
  }>;
};

export type MemoryEntryType =
  | 'decision'
  | 'session_summary'
  | 'runbook'
  | 'infra_note'
  | 'deployment_note'
  | 'benchmark_result'
  | 'incident_note'
  | 'fact';

export type MemoryEntry = {
  id: string;
  knowledgeBaseId: string;
  entryType: MemoryEntryType;
  title: string | null;
  body: string;
  summary: string | null;
  tags: string[];
  authoredBy: string | null;
  sessionId: string | null;
  sourceRefs: string[];
  occurredAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

export type MemorySearchResult = Omit<
  MemoryEntry,
  'knowledgeBaseId' | 'sourceRefs' | 'updatedAt' | 'title' | 'summary' | 'authoredBy' | 'sessionId' | 'occurredAt'
> & {
  title?: string;
  summary?: string;
  authoredBy?: string;
  sessionId?: string;
  occurredAt?: string;
  score: number;
};

export type MemorySearchResponse = {
  knowledgeBaseId: string;
  retrievalProfile: {
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
  results: MemorySearchResult[];
  count: number;
};

export type RecentDecisionsResponse = {
  knowledgeBaseId: string;
  results: MemoryEntry[];
  count: number;
};

export type AskMode = 'chunks' | 'rag_answer';

export type AskSearchFilters = {
  sourceRevisionIds?: string[];
  pathPrefix?: string;
  language?: string;
  branch?: string;
  metadata?: Record<string, unknown>;
};

export type LlmProviderOverride = {
  providerId?: string;
  providerName?: string;
  maxOutputTokens?: number;
  temperature?: number;
};

export type AskRequest = {
  query: string;
  mode?: AskMode;
  topK?: number;
  limit?: number;
  scoreThreshold?: number;
  profileKey?: string;
  tokenBudget?: number;
  filters?: AskSearchFilters;
  rerank?: RerankRequest;
  llm?: LlmProviderOverride;
};

export type AnswerCitation = {
  id: string;
  chunkId: string;
  documentId: string;
  sourceId?: string;
  sourceRevisionId?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
};

export type AnswerProviderSummary = {
  providerConfigId: string;
  name: string;
  model: string;
  protocol: 'openai_compatible';
};

export type AskBudgetDiagnostics = {
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
};

export type AskServingTrace = {
  servingRevisionId: string;
  sourceRevisionIds: string[];
  vectorBackendId: string;
  collectionName: string;
  collectionAlias?: string;
  indexBuildId?: string;
  filterPlacement: 'pre_topk';
};

export type AskContextPackage = {
  count: number;
  budget: {
    requestedTokens?: number;
    estimatedTokens: number;
  };
  groups: Array<{
    title: string;
    kind: 'code' | 'docs' | 'memory' | 'ops' | 'mixed';
    items: RetrievalTraceItem[];
  }>;
};

export type AskRetrievalTrace = {
  knowledgeBaseId: string;
  indexVersionId: string;
  query: string;
  retrievalProfile: {
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
  };
  appliedFilters?: AskSearchFilters;
  stages: {
    denseCandidates: RetrievalTraceItem[];
    lexicalCandidates?: RetrievalTraceItem[];
    mergedCandidates?: RetrievalTraceItem[];
    filteredCandidates: RetrievalTraceItem[];
    dedupedCandidates: RetrievalTraceItem[];
    rerankedCandidates?: RetrievalTraceItem[];
    nearDedupedCandidates?: RetrievalTraceItem[];
    expandedCandidates: RetrievalTraceItem[];
    finalCandidates?: RetrievalTraceItem[];
  };
  contextPackage: AskContextPackage;
  diagnostics: {
    serving: AskServingTrace;
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
    rerankerCandidateCount: number;
    budget: AskBudgetDiagnostics;
  };
};

export type AskDiagnostics = {
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
  retrievalBudget: AskBudgetDiagnostics;
};

export type AskResponse = {
  mode: AskMode;
  knowledgeBaseId: string;
  indexVersionId: string;
  query: string;
  retrievalTraceId: string;
  retrievalTrace: AskRetrievalTrace;
  contextPackage: AskContextPackage;
  answer?: string;
  citations: AnswerCitation[];
  sourceIds: string[];
  provider?: AnswerProviderSummary;
  diagnostics: AskDiagnostics;
};

export type WorkspaceExportManifest = {
  formatVersion: string;
  exportedAt: string;
  exportScope: {
    kind: string;
    includes: string[];
    excludes: string[];
  };
  workspace: {
    id: string;
    slug: string;
    name: string;
    description?: string | null;
    kind: string;
    activeIndexVersionId?: string | null;
  };
  sources: Array<{
    id: string;
    type: string;
    uri: string;
    metadata: unknown;
  }>;
  restorePlan: {
    mode: string;
    supportedFirstRestoreModes: string[];
    recommendedSteps: string[];
    requiresReindexForSearch: boolean;
    sourceWarnings: Array<{
      type: string;
      uri: string;
      message: string;
    }>;
    notes: string[];
  };
  counts: {
    sources: number;
    retrievalProfiles: number;
    memoryEntries: number;
    documents: number;
    chunks: number;
    sourceSnapshots: number;
    indexVersions: number;
    validationReports: number;
  };
};
