import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

describe('App workspace detail explorer', () => {
  it('renders document and index explorer data from the admin read model', async () => {
    const refreshBodies: Array<{ mode?: string; reason?: string; dryRun?: boolean }> = [];
    const policyBodies: Array<Record<string, unknown>> = [];
    const createSourceBodies: Array<Record<string, unknown>> = [];
    const evalRunBodies: Array<Record<string, unknown>> = [];
    const benchmarkImportBodies: Array<Record<string, unknown>> = [];
    const profileCompareBodies: Array<Record<string, unknown>> = [];
    const runCompareBodies: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith('/admin/knowledge-bases/career-rag')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                knowledgeBase: {
                  id: 'kb-1',
                  slug: 'career-rag',
                  name: 'Career RAG',
                  description: 'Profile workspace',
                  workspaceKind: 'codebase',
                  defaultRetrievalProfile: 'code-debug',
                  activeIndexVersionId: 'idx-1',
                  createdAt: '2026-05-12T16:49:36.320Z',
                  updatedAt: '2026-05-12T16:56:07.305Z',
                  counts: {
                    sources: 1,
                    documents: 1,
                    indexVersions: 1,
                    jobs: 0,
                  },
                  lastSuccessfulIndexAt: '2026-05-12T16:56:07.305Z',
                  lastJobStatus: 'succeeded',
                  lastErrorSummary: null,
                  activeIndexVersion: {
                    id: 'idx-1',
                    status: 'active',
                    createdAt: '2026-05-12T16:56:07.305Z',
                    embeddingModel: 'qwen3-embedding-4b',
                    embeddingDimension: 2560,
                    vectorCollectionName: 'kb-kb-1',
                    materializationMode: 'mutable_collection',
                  },
                  indexVersions: [
                    {
                      id: 'idx-1',
                      status: 'active',
                      createdAt: '2026-05-12T16:56:07.305Z',
                      embeddingModel: 'qwen3-embedding-4b',
                      embeddingDimension: 2560,
                      vectorCollectionName: 'kb-kb-1',
                      materializationMode: 'mutable_collection',
                    },
                  ],
                  sources: [
                    {
                      id: 'src-1',
                      type: 'local_folder',
                      uri: '/data/career',
                      status: 'active',
                      includeRules: ['**/*.md'],
                      excludeRules: [],
                      lastSyncedAt: '2026-05-12T16:56:07.305Z',
                      createdAt: '2026-05-12T16:49:36.329Z',
                      updatedAt: '2026-05-12T16:56:07.305Z',
                      documentCount: 1,
                      lastSnapshot: {
                        at: '2026-05-12T16:56:07.305Z',
                        ref: null,
                        snapshotType: 'local_folder_scan',
                        fileCount: 1,
                        contentBytes: 2048,
                      },
                      lastSuccessfulIndexAt: '2026-05-12T16:56:07.305Z',
                      lastJob: null,
                      lastErrorSummary: null,
                    },
                  ],
                },
                recentJobs: [],
                explorer: {
                  documentLimit: 50,
                  documents: [
                    {
                      id: 'doc-1',
                      sourceId: 'src-1',
                      path: 'notes/profile.md',
                      mimeType: 'text/markdown',
                      contentHash: 'hash-1',
                      status: 'active',
                      chunkCount: 4,
                      metadata: { language: 'markdown' },
                      createdAt: '2026-05-12T16:50:00.000Z',
                      updatedAt: '2026-05-12T16:56:07.305Z',
                    },
                  ],
                },
                retrievalPlayground: {
                  defaultProfileKey: 'code-debug',
                  profiles: [
                    {
                      key: 'code-debug',
                      name: 'Code Debug',
                      intent: 'code_search',
                      denseTopK: 10,
                      scoreThreshold: null,
                      neighborBefore: 1,
                      neighborAfter: 1,
                      tokenBudget: 1500,
                      grouping: 'path',
                      recencyBoost: false,
                    },
                    {
                      key: 'docs-qa',
                      name: 'Docs QA',
                      intent: 'docs_search',
                      denseTopK: 8,
                      scoreThreshold: null,
                      neighborBefore: 0,
                      neighborAfter: 1,
                      tokenBudget: 1200,
                      grouping: 'document',
                      recencyBoost: false,
                    },
                  ],
                  activeCollection: {
                    indexVersionId: 'idx-1',
                    vectorCollectionName: 'kb-kb-1',
                    materializationMode: 'mutable_collection',
                    embeddingModel: 'qwen3-embedding-4b',
                    embeddingDimension: 2560,
                    createdAt: '2026-05-12T16:56:07.305Z',
                  },
                  suggestedRequest: {
                    queryPlaceholder: 'Find the relevant code paths',
                    topK: 6,
                    tokenBudget: 1200,
                  },
                },
              }),
            ),
          );
        }

        if (url.includes('/workspaces/career-rag/eval/questions')) {
          const datasetId = new URL(url, 'http://localhost:3000').searchParams.get('datasetId');
          return Promise.resolve(
            new Response(
              JSON.stringify({
                knowledgeBaseId: 'kb-1',
                questions:
                  datasetId === 'cf-standard-benchmark'
                    ? [
                        {
                          id: 'q-scifact-1',
                          knowledgeBaseId: 'kb-1',
                          text: 'Which trial evidence supports the claim?',
                          expectedDocumentIds: ['beir_scifact_doc_1'],
                          expectedChunkIds: [],
                          metadata: { datasetId: 'cf-standard-benchmark' },
                          createdAt: '2026-07-15T09:00:00.000Z',
                        },
                      ]
                    : [
                        {
                          id: 'q-refresh-policy',
                          knowledgeBaseId: 'kb-1',
                          text: 'Where is source refresh policy stored?',
                          expectedDocumentIds: ['doc-source-policy'],
                          expectedChunkIds: [],
                          metadata: { datasetId: 'cf-smoke-mini' },
                          createdAt: '2026-07-15T09:00:00.000Z',
                        },
                      ],
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/benchmarks/cf-standard-benchmark/import') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
          benchmarkImportBodies.push(body);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                datasetId: 'cf-standard-benchmark',
                datasetVersion: '2026-07-15',
                profile: 'cpu-mini',
                packPath: '/repo/.contextforge/benchmarks/cf-standard-benchmark/beir-scifact-cpu-mini',
                documents: 500,
                questions: 50,
                source: {
                  id: 'src-benchmark',
                  uri: '/repo/.contextforge/benchmarks/cf-standard-benchmark/beir-scifact-cpu-mini/documents',
                  created: true,
                },
                indexingJob: { id: 'job-benchmark-import' },
                next: {
                  datasetId: 'cf-standard-benchmark',
                  profileKey: 'docs-qa',
                  topK: 10,
                },
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/eval/runs?limit=10')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                knowledgeBaseId: 'kb-1',
                runs: [
                  evalRunFixture('run-current', 'Docs QA eval', 'docs-qa', 0.86, 'hash-current'),
                  evalRunFixture('run-baseline', 'Code Debug eval', 'code-debug', 0.71, 'hash-base'),
                ],
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/eval/runs') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
          evalRunBodies.push(body);
          return Promise.resolve(
            new Response(
              JSON.stringify(
                evalRunFixture(
                  `run-new-${evalRunBodies.length}`,
                  'Candidate eval',
                  String(body.profileKey),
                  0.9,
                  `hash-new-${evalRunBodies.length}`,
                  body,
                ),
              ),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/eval/profile-comparison') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
          profileCompareBodies.push(body);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                profileKeys: ['code-debug', 'docs-qa'],
                runs: [
                  evalRunFixture('run-profile-a', 'Profile comparison - code-debug', 'code-debug', 0.7, 'hash-a'),
                  evalRunFixture('run-profile-b', 'Profile comparison - docs-qa', 'docs-qa', 0.9, 'hash-b'),
                ],
                summary: [
                  {
                    runId: 'run-profile-a',
                    profileKey: 'code-debug',
                    metrics: evalRunFixture(
                      'run-profile-a',
                      'Profile comparison - code-debug',
                      'code-debug',
                      0.7,
                      'hash-a',
                    ).metrics,
                    deltasFromBaseline: {},
                  },
                  {
                    runId: 'run-profile-b',
                    profileKey: 'docs-qa',
                    metrics: evalRunFixture('run-profile-b', 'Profile comparison - docs-qa', 'docs-qa', 0.9, 'hash-b')
                      .metrics,
                    deltasFromBaseline: { hitAtK: 0.2, mrr: 0.18, emptyResultRate: -0.1 },
                  },
                ],
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/eval/run-comparison') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
          runCompareBodies.push(body);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                baselineRunId: body.baselineRunId,
                candidateRunId: body.candidateRunId,
                baselineMetrics: evalRunFixture('run-baseline', 'Code Debug eval', 'code-debug', 0.71, 'hash-base')
                  .metrics,
                candidateMetrics: evalRunFixture('run-current', 'Docs QA eval', 'docs-qa', 0.86, 'hash-current')
                  .metrics,
                metricDeltas: { hitAtK: 0.15, mrr: 0.11, emptyResultRate: -0.2 },
                config: {
                  baselineHash: 'hash-base',
                  candidateHash: 'hash-current',
                  changed: true,
                },
                perQuestionDeltas: [
                  {
                    evalQuestionId: 'q-refresh-policy',
                    deltas: { hitAtK: 1, reciprocalRank: 0.5 },
                  },
                ],
              }),
            ),
          );
        }

        if (url.endsWith('/admin/knowledge-bases/career-rag/retrieval-playground')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          const rerank = body.rerank as { enabled?: boolean; providerName?: string; topN?: number } | undefined;
          const reranked = rerank?.enabled === true;
          const traceItem = {
            text: 'Queue pressure comes from queued and running job counts.',
            score: 0.91,
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            sourceId: 'src-1',
            path: 'notes/profile.md',
            mimeType: 'text/markdown',
            language: 'markdown',
            branch: 'main',
            commit: 'abc1234',
            startLine: 12,
            endLine: 18,
            tokenCount: 32,
            metadata: {
              section: 'queue',
              ...(reranked ? { rerankerScore: 0.77, originalRank: 2, rerankerRanked: true } : {}),
            },
          };

          return Promise.resolve(
            new Response(
              JSON.stringify({
                knowledgeBase: {
                  id: 'kb-1',
                  slug: 'career-rag',
                  name: 'Career RAG',
                  workspaceKind: 'codebase',
                  defaultRetrievalProfile: 'code-debug',
                },
                request: {
                  query: 'Find the relevant code paths',
                  topK: 6,
                  tokenBudget: 1200,
                  profileKey: 'code-debug',
                  filters: null,
                },
                trace: {
                  knowledgeBaseId: 'kb-1',
                  indexVersionId: 'idx-1',
                  query: 'Find the relevant code paths',
                  retrievalProfile: {
                    key: 'code-debug',
                    name: 'Code Debug',
                    intent: 'code_search',
                    denseTopK: 10,
                    scoreThreshold: undefined,
                    neighborBefore: 1,
                    neighborAfter: 1,
                    tokenBudget: 1500,
                    grouping: 'path',
                    recencyBoost: false,
                  },
                  appliedFilters: {},
                  stages: {
                    denseCandidates: [traceItem],
                    filteredCandidates: [traceItem],
                    dedupedCandidates: [traceItem],
                    rerankedCandidates: reranked ? [traceItem] : [],
                    expandedCandidates: [traceItem],
                  },
                  contextPackage: {
                    count: 1,
                    budget: {
                      requestedTokens: 1200,
                      estimatedTokens: 32,
                    },
                    groups: [
                      {
                        title: 'notes/profile.md',
                        kind: 'docs',
                        items: [traceItem],
                      },
                    ],
                  },
                  diagnostics: {
                    denseCandidates: 1,
                    filteredCandidates: 1,
                    droppedByFilters: 0,
                    droppedDuplicates: 0,
                    expandedNeighbors: 0,
                    finalCount: 1,
                    reranked,
                    rerankerFallbackUsed: false,
                    rerankerCandidateCount: reranked ? 1 : 0,
                    reranker: reranked
                      ? {
                          enabled: true,
                          source: 'request',
                          providerName: rerank?.providerName || 'local-cpu-reranker',
                          model: 'cross-encoder/ms-marco-MiniLM-L6-v2',
                          topN: rerank?.topN || 3,
                          fallbackAllowed: true,
                        }
                      : { enabled: false, source: 'request', reason: 'reranker_disabled_by_request' },
                  },
                },
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/export-manifest')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                formatVersion: 'workspace-export-manifest.v1',
                exportedAt: '2026-05-26T12:00:00.000Z',
                exportScope: {
                  kind: 'metadata_manifest',
                  includes: ['workspace_metadata', 'source_definitions', 'restore_plan'],
                  excludes: ['provider_api_keys', 'git_credentials'],
                },
                workspace: {
                  id: 'kb-1',
                  slug: 'career-rag',
                  name: 'Career RAG',
                  kind: 'codebase',
                  activeIndexVersionId: 'idx-1',
                },
                sources: [
                  {
                    id: 'src-1',
                    type: 'local_folder',
                    uri: '/data/career',
                    metadata: {},
                  },
                ],
                restorePlan: {
                  mode: 'plan_only',
                  supportedFirstRestoreModes: ['metadata_only'],
                  recommendedSteps: ['create_workspace_with_same_slug_or_new_slug', 'run_reindex_to_recreate_vectors'],
                  requiresReindexForSearch: true,
                  sourceWarnings: [
                    {
                      type: 'local_folder',
                      uri: '/data/career',
                      message: 'Local folder paths must exist on the restore host or be remapped.',
                    },
                  ],
                  notes: ['Provider secrets and credentials are intentionally omitted.'],
                },
                counts: {
                  sources: 1,
                  retrievalProfiles: 1,
                  memoryEntries: 0,
                  documents: 1,
                  chunks: 4,
                  sourceSnapshots: 1,
                  indexVersions: 1,
                  validationReports: 0,
                },
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/sources/src-1/policy')) {
          if (init?.method === 'PUT') {
            const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
            policyBodies.push(body);
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  source: {
                    id: 'src-1',
                    knowledgeBaseId: 'kb-1',
                    type: 'local_folder',
                    uri: '/data/career',
                    status: 'active',
                  },
                  sourceTruthPolicy: {
                    truthMode: 'read_only',
                    writePolicy: 'disabled',
                  },
                  syncPolicy: body.syncPolicy,
                  autoRefreshEnabled: true,
                  lastSyncedAt: '2026-05-12T16:56:07.305Z',
                  nextTriggerAt: '2026-05-12T17:01:07.305Z',
                }),
              ),
            );
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                source: {
                  id: 'src-1',
                  knowledgeBaseId: 'kb-1',
                  type: 'local_folder',
                  uri: '/data/career',
                  status: 'active',
                },
                sourceTruthPolicy: {
                  truthMode: 'read_only',
                  writePolicy: 'disabled',
                },
                syncPolicy: {
                  triggerMode: 'manual',
                  enabled: false,
                  mode: 'incremental',
                },
                autoRefreshEnabled: false,
                lastSyncedAt: '2026-05-12T16:56:07.305Z',
                nextTriggerAt: null,
              }),
            ),
          );
        }

        if (url.endsWith('/sources') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
          createSourceBodies.push(body);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'src-obsidian',
                knowledgeBaseId: 'kb-1',
                type: 'obsidian_vault',
                uri: body.uri,
                includeRules: [],
                excludeRules: ['**/.obsidian/**'],
                status: 'active',
                metadata: {
                  sourceTruthPolicy: {
                    truthMode: 'read_only',
                    writePolicy: 'disabled',
                  },
                },
                createdAt: '2026-05-26T12:30:00.000Z',
                updatedAt: '2026-05-26T12:30:00.000Z',
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/sources/src-1/refresh')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            mode?: string;
            reason?: string;
            dryRun?: boolean;
          };
          refreshBodies.push(body);

          if (body.dryRun) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  dryRun: true,
                  mode: body.mode ?? 'incremental',
                  reason: body.reason,
                  workspace: {
                    id: 'kb-1',
                    slug: 'career-rag',
                    name: 'Career RAG',
                    workspaceKind: 'codebase',
                  },
                  source: {
                    id: 'src-1',
                    type: 'local_folder',
                    uri: '/data/career',
                    status: 'active',
                  },
                  preparedSource: {
                    scanRoot: '/data/career',
                  },
                  plan: {
                    stats: {
                      filesParsed: 2,
                      filesIgnored: 0,
                      parseFailures: 0,
                      added: 1,
                      changed: 1,
                      unchanged: 0,
                      deleted: 0,
                      dependencyCandidates: 1,
                    },
                    addedPaths: ['notes/new.md'],
                    changedPaths: ['notes/profile.md'],
                    unchangedCount: 0,
                    deletedPaths: [],
                    dependencyHints: [
                      {
                        path: 'notes/profile.md',
                        dependsOn: ['notes/new.md'],
                      },
                    ],
                    validationIssues: [],
                  },
                }),
              ),
            );
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                dryRun: false,
                mode: body.mode ?? 'incremental',
                reason: body.reason,
                workspace: {
                  id: 'kb-1',
                  slug: 'career-rag',
                  name: 'Career RAG',
                  workspaceKind: 'codebase',
                },
                source: {
                  id: 'src-1',
                  type: 'local_folder',
                  uri: '/data/career',
                  status: 'active',
                },
                job: {
                  id: 'job-refresh-1',
                },
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/memory')) {
          if (init?.method === 'POST') {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: 'mem-new',
                  knowledgeBaseId: 'kb-1',
                  entryType: 'fact',
                  title: 'New fact',
                  body: 'The Studio can write memory entries.',
                  summary: null,
                  tags: ['studio'],
                  authoredBy: 'operator',
                  sessionId: null,
                  sourceRefs: [],
                  occurredAt: null,
                  createdAt: '2026-05-26T12:30:00.000Z',
                  updatedAt: '2026-05-26T12:30:00.000Z',
                  metadata: {},
                }),
              ),
            );
          }

          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  id: 'mem-1',
                  knowledgeBaseId: 'kb-1',
                  entryType: 'fact',
                  title: 'API auth fact',
                  body: 'Studio memory requests reuse the configured admin API key.',
                  summary: 'Auth-aware memory calls',
                  tags: ['studio', 'auth'],
                  authoredBy: 'operator',
                  sessionId: 'session-1',
                  sourceRefs: [],
                  occurredAt: null,
                  createdAt: '2026-05-26T12:10:00.000Z',
                  updatedAt: '2026-05-26T12:10:00.000Z',
                  metadata: {},
                },
                {
                  id: 'mem-2',
                  knowledgeBaseId: 'kb-1',
                  entryType: 'decision',
                  title: 'Use backend memory retrieval',
                  body: 'Studio should call search-memory instead of duplicating MCP behavior.',
                  summary: 'Backend memory retrieval remains source of truth.',
                  tags: ['retrieval'],
                  authoredBy: 'codex',
                  sessionId: 'session-1',
                  sourceRefs: [],
                  occurredAt: null,
                  createdAt: '2026-05-26T12:20:00.000Z',
                  updatedAt: '2026-05-26T12:20:00.000Z',
                  metadata: {},
                },
              ]),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/recent-decisions?limit=5')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                knowledgeBaseId: 'kb-1',
                count: 1,
                results: [
                  {
                    id: 'mem-2',
                    knowledgeBaseId: 'kb-1',
                    entryType: 'decision',
                    title: 'Use backend memory retrieval',
                    body: 'Studio should call search-memory instead of duplicating MCP behavior.',
                    summary: 'Backend memory retrieval remains source of truth.',
                    tags: ['retrieval'],
                    authoredBy: 'codex',
                    sessionId: 'session-1',
                    sourceRefs: [],
                    occurredAt: null,
                    createdAt: '2026-05-26T12:20:00.000Z',
                    updatedAt: '2026-05-26T12:20:00.000Z',
                    metadata: {},
                  },
                ],
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/search-memory')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                knowledgeBaseId: 'kb-1',
                retrievalProfile: {
                  key: 'memory-recall',
                  name: 'Memory Recall',
                  intent: 'memory_search',
                  denseTopK: 6,
                  neighborBefore: 0,
                  neighborAfter: 0,
                  grouping: 'memory-thread',
                  recencyBoost: true,
                },
                count: 1,
                results: [
                  {
                    id: 'mem-2',
                    entryType: 'decision',
                    title: 'Use backend memory retrieval',
                    body: 'Studio should call search-memory instead of duplicating MCP behavior.',
                    summary: 'Backend memory retrieval remains source of truth.',
                    tags: ['retrieval'],
                    authoredBy: 'codex',
                    sessionId: 'session-1',
                    occurredAt: null,
                    createdAt: '2026-05-26T12:20:00.000Z',
                    metadata: {},
                    score: 1.7,
                  },
                ],
              }),
            ),
          );
        }

        if (url.endsWith('/vector-backends/read-model')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                policy: {
                  topology: 'independent_backends',
                  oneWorkspaceOneBackend: true,
                  automaticFailover: false,
                  transparentSharding: false,
                  replicas: false,
                  note: 'Independent Qdrant backends are not replicas or transparent shards.',
                },
                backends: [
                  {
                    id: 'backend-default',
                    name: 'default-qdrant',
                    baseUrl: 'http://qdrant-a:6333',
                    apiKeyRef: null,
                    hasApiKeyRef: false,
                    tlsVerify: true,
                    labels: ['default'],
                    state: 'enabled',
                    capacityHints: {},
                    observedResources: { vectorCount: 12 },
                    healthMetadata: { healthy: true },
                    lastHealthAt: '2026-07-15T09:00:00.000Z',
                    lastErrorCode: null,
                    assignedWorkspaceCount: 1,
                    assignedWorkspaces: [],
                    operations: [
                      {
                        id: 'op-ready',
                        knowledgeBaseId: 'kb-1',
                        kind: 'backend_move',
                        state: 'ready_for_cutover',
                        sourceVectorBackendId: 'backend-default',
                        targetVectorBackendId: 'backend-cold',
                        sourceCollectionName: 'kb-kb-1',
                        targetCollectionName: 'kb-kb-candidate',
                        servingRevisionId: 'serving-1',
                        rollbackUntil: '2026-07-15T10:00:00.000Z',
                        cleanupAfter: null,
                        validationSummary: {},
                        errorSummary: {},
                        updatedAt: '2026-07-15T09:00:00.000Z',
                      },
                    ],
                  },
                  {
                    id: 'backend-cold',
                    name: 'cold-node',
                    baseUrl: 'http://qdrant-b:6333',
                    apiKeyRef: '[configured]',
                    hasApiKeyRef: true,
                    tlsVerify: true,
                    labels: ['ssd'],
                    state: 'enabled',
                    capacityHints: {},
                    observedResources: { vectorCount: 0 },
                    healthMetadata: { healthy: true },
                    lastHealthAt: '2026-07-15T09:00:00.000Z',
                    lastErrorCode: null,
                    assignedWorkspaceCount: 0,
                    assignedWorkspaces: [],
                    operations: [],
                  },
                ],
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/vector-placement')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'placement-1',
                knowledgeBaseId: 'kb-1',
                vectorBackendId: 'backend-default',
                servingRevisionId: 'serving-1',
                activeIndexBuildId: 'build-1',
                collectionAlias: 'workspace-career-rag',
                physicalCollectionName: 'kb-kb-1',
                mode: 'capacity_assisted',
                state: 'loaded',
                reasonSnapshot: {},
                capacitySnapshot: {},
              }),
            ),
          );
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/workspaces/career-rag']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('notes/profile.md')).toBeInTheDocument();
      expect(screen.getAllByText('Index versions').length).toBeGreaterThan(0);
      expect(screen.getAllByText('idx-1').length).toBeGreaterThan(0);
      expect(screen.getByText('workspace-export-manifest.v1')).toBeInTheDocument();
      expect(screen.getByText('Source policy')).toBeInTheDocument();
      expect(screen.getAllByText('read_only').length).toBeGreaterThan(0);
      expect(screen.getAllByText('disabled').length).toBeGreaterThan(0);
      expect(screen.getByText(/Restore is plan-only/)).toBeInTheDocument();
      expect(screen.getByText('API auth fact')).toBeInTheDocument();
      expect(screen.getAllByText('Use backend memory retrieval').length).toBeGreaterThan(0);
      expect(screen.getByText('Retrieval evaluation')).toBeInTheDocument();
      expect(screen.getByText('q-refresh-policy')).toBeInTheDocument();
      expect(screen.getAllByText('Docs QA eval').length).toBeGreaterThan(0);
      expect(screen.getByText('Vector backend operations')).toBeInTheDocument();
      expect(screen.getByText(/not replicas or transparent shards/)).toBeInTheDocument();
      expect(screen.getByText('cold-node')).toBeInTheDocument();
      expect(screen.getByText('No recent failure signal for this workspace.')).toBeInTheDocument();
    });

    const evaluation = within(screen.getByText('Retrieval evaluation').closest('section')!);
    const playground = within(screen.getByText('Retrieval playground').closest('section')!);
    const evalProfileSelect = evaluation.getByLabelText('Profile');
    fireEvent.change(evalProfileSelect, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run eval' }));

    await waitFor(() => {
      expect(evalRunBodies[0]).toMatchObject({
        datasetId: 'cf-smoke-mini',
        profileKey: 'code-debug',
        topK: 5,
      });
    });

    fireEvent.change(evalProfileSelect, { target: { value: 'docs-qa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run eval' }));

    await waitFor(() => {
      expect(screen.getAllByText('Candidate eval').length).toBeGreaterThan(0);
      expect(evalRunBodies[1]).toMatchObject({
        datasetId: 'cf-smoke-mini',
        profileKey: 'docs-qa',
        topK: 5,
      });
    });

    fireEvent.change(evaluation.getByLabelText('Reranker mode'), { target: { value: 'on' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run eval' }));

    await waitFor(() => {
      expect(evalRunBodies[evalRunBodies.length - 1]).toMatchObject({
        rerank: {
          enabled: true,
          providerName: 'local-cpu-reranker',
          topN: 3,
          fallbackAllowed: true,
        },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Compare reranker off/on' }));

    await waitFor(() => {
      expect(evalRunBodies[evalRunBodies.length - 2]).toMatchObject({ rerank: { enabled: false } });
      expect(evalRunBodies[evalRunBodies.length - 1]).toMatchObject({
        rerank: expect.objectContaining({
          enabled: true,
          providerName: 'local-cpu-reranker',
        }),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Compare profiles' }));

    await waitFor(() => {
      expect(screen.getByText('Δ hitAtK')).toBeInTheDocument();
      expect(screen.getByText('+0.200')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Compare saved runs' }));

    await waitFor(() => {
      expect(screen.getByText('Config changed: yes')).toBeInTheDocument();
      expect(screen.getByText('q-refresh-policy: hitAtK +1.000, reciprocalRank +0.500')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Import standard benchmark' }));

    await waitFor(() => {
      expect(screen.getByText(/Standard benchmark ready:/)).toBeInTheDocument();
      expect(screen.getByDisplayValue('cf-standard-benchmark')).toBeInTheDocument();
      expect(screen.getByText('q-scifact-1')).toBeInTheDocument();
    });

    expect(benchmarkImportBodies[0]).toEqual({ profile: 'cpu-mini' });
    expect(evalRunBodies[0]).toEqual({ datasetId: 'cf-smoke-mini', profileKey: 'code-debug', topK: 5 });
    expect(profileCompareBodies).toEqual([
      { datasetId: 'cf-smoke-mini', topK: 5, profileKeys: ['code-debug', 'docs-qa'] },
    ]);
    expect(runCompareBodies).toEqual(
      expect.arrayContaining([{ baselineRunId: 'run-profile-a', candidateRunId: 'run-profile-b' }]),
    );

    fireEvent.click(screen.getByLabelText('Enable auto refresh for /data/career'));
    fireEvent.change(screen.getByLabelText('Source trigger for /data/career'), {
      target: { value: 'schedule' },
    });
    fireEvent.change(screen.getByLabelText('Policy refresh mode for /data/career'), {
      target: { value: 'force_rechunk' },
    });
    fireEvent.change(screen.getByPlaceholderText('5m, 1h, every 1d'), {
      target: { value: '5m' },
    });
    fireEvent.change(screen.getByPlaceholderText('daily vault sync'), {
      target: { value: 'hourly policy check' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));

    await waitFor(() => {
      expect(screen.getByText('Source policy saved.')).toBeInTheDocument();
    });

    expect(policyBodies).toEqual([
      {
        sourceTruthPolicy: {
          truthMode: 'read_only',
          writePolicy: 'disabled',
        },
        syncPolicy: {
          triggerMode: 'schedule',
          enabled: true,
          mode: 'force_rechunk',
          schedule: '5m',
          reason: 'hourly policy check',
        },
      },
    ]);

    fireEvent.change(screen.getByLabelText('Obsidian vault path'), {
      target: { value: '/data/notes/main-vault' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add vault' }));

    await waitFor(() => {
      expect(screen.getByText('Obsidian vault source created.')).toBeInTheDocument();
    });

    expect(createSourceBodies).toEqual([
      {
        knowledgeBaseSlug: 'career-rag',
        type: 'obsidian_vault',
        uri: '/data/notes/main-vault',
      },
    ]);

    fireEvent.change(screen.getByLabelText('Refresh mode for /data/career'), {
      target: { value: 'force_reembed' },
    });
    fireEvent.change(screen.getByPlaceholderText('after git pull or dataset update'), {
      target: { value: 'after commit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview dry-run' }));

    await waitFor(() => {
      expect(screen.getByText('Dry-run preview')).toBeInTheDocument();
      expect(screen.getByText('notes/new.md')).toBeInTheDocument();
      expect(screen.getAllByText('notes/profile.md').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start refresh' }));

    await waitFor(() => {
      expect(screen.getByText('Open refresh job job-refresh-1')).toBeInTheDocument();
      expect(screen.getByText('Queued force_reembed refresh.')).toBeInTheDocument();
    });

    expect(refreshBodies).toEqual([
      { mode: 'force_reembed', reason: 'after commit', dryRun: true },
      { mode: 'force_reembed', reason: 'after commit', dryRun: false },
    ]);

    fireEvent.change(screen.getByPlaceholderText('Find relevant decisions, facts, or session notes'), {
      target: { value: 'retrieval' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search memory' }));

    await waitFor(() => {
      expect(screen.getByText('1 results via memory-recall')).toBeInTheDocument();
      expect(screen.getByText(/Score 1.70/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('What should the agent remember?'), {
      target: { value: 'The Studio can write memory entries.' },
    });
    fireEvent.click(screen.getByText('Save memory entry'));

    await waitFor(() => {
      expect(screen.getByText('Memory entry saved.')).toBeInTheDocument();
    });

    fireEvent.change(playground.getByLabelText('Reranker mode'), { target: { value: 'on' } });
    fireEvent.click(screen.getByText('Run retrieval trace'));

    await waitFor(() => {
      expect(screen.getByText('Trace request')).toBeInTheDocument();
      expect(screen.getByText('Filtered candidates')).toBeInTheDocument();
      expect(screen.getByText('Deduped candidates')).toBeInTheDocument();
      expect(screen.getByText('Reranked candidates')).toBeInTheDocument();
      expect(screen.getByText('Provider local-cpu-reranker')).toBeInTheDocument();
      expect(screen.getAllByText('Document: doc-1').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/lines 12-18/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/"section": "queue"/).length).toBeGreaterThan(0);
    });
  }, 10000);
});

function evalRunFixture(
  id: string,
  name: string,
  profileKey: string,
  hitAtK: number,
  configHash: string,
  request: Record<string, unknown> = {},
) {
  const rerank = request.rerank as Record<string, unknown> | undefined;
  return {
    id,
    knowledgeBaseId: 'kb-1',
    indexVersionId: 'idx-1',
    name,
    status: 'succeeded',
    metrics: {
      profileKey,
      datasetId: 'cf-smoke-mini',
      questionCount: 1,
      topK: 5,
      hitAtK,
      hitAt1: hitAtK,
      hitAt3: hitAtK,
      mrr: Math.max(hitAtK - 0.1, 0),
      expectedDocumentHitRate: hitAtK,
      expectedChunkHitRate: hitAtK,
      emptyResultRate: hitAtK > 0.8 ? 0 : 0.2,
      duplicateRate: 0,
      latencyMs: {
        p50: 12.5,
        p95: 24.2,
        min: 9.1,
        max: 24.2,
      },
      reranker: rerank?.enabled
        ? {
            comparedQuestions: 1,
            meanReciprocalRankDelta: 0.2,
            changedTopRate: 1,
          }
        : undefined,
      configHash,
      config: {
        index: {
          id: 'idx-1',
          embeddingModel: 'qwen3-embedding-4b',
          embeddingDimension: 2560,
        },
        retrieval: {
          profileKey,
          request: rerank ? { rerank } : {},
        },
        providers: rerank
          ? {
              reranker: {
                enabled: rerank.enabled,
                providerName: rerank.providerName,
                topN: rerank.topN,
                fallbackAllowed: rerank.fallbackAllowed,
                source: 'request',
              },
            }
          : {},
      },
    },
    createdAt: '2026-07-15T09:00:00.000Z',
    finishedAt: '2026-07-15T09:00:01.000Z',
    results: [],
  };
}
