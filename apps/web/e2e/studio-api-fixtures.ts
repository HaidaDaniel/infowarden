import type { Page, Request, Route } from '@playwright/test';

const API_ORIGIN = 'http://localhost:3000';
const now = '2026-06-05T09:00:00.000Z';

type MockStudioApiOptions = {
  requireAuth?: boolean;
  failUpload?: boolean;
  failJobDetail?: boolean;
  longContent?: boolean;
};

type MemoryEntry = {
  id: string;
  knowledgeBaseId: string;
  entryType: string;
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

export async function mockStudioApi(page: Page, options: MockStudioApiOptions = {}) {
  const state = createMockState();

  if (options.longContent) {
    const longWorkspaceName = `workspace-${'x'.repeat(420)}`;
    const longPath = `/var/lib/infowarden/${'long-path-'.repeat(50)}`;
    state.workspaceDetail.knowledgeBase.name = longWorkspaceName;
    state.workspaceDetail.knowledgeBase.sources[0].uri = longPath;
    state.workspaceDetail.explorer.documents[0].path = `${longPath}/document.md`;
    state.workspaceDetail.recentJobs[1].lastErrorSummary = {
      at: now,
      message: `Backend diagnostic: ${'error-'.repeat(80)}`,
      code: 'long_fixture_error',
    };
  }

  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') {
      await fulfillNoContent(route);
      return;
    }

    if (options.requireAuth && request.headers().authorization !== 'Bearer secret-key') {
      await fulfillJson(route, 401, { message: 'Unauthorized' });
      return;
    }

    try {
      await handleApiRequest(route, request, url, state, options);
    } catch (error) {
      await fulfillJson(route, 500, {
        message: error instanceof Error ? error.message : 'Unhandled mock route',
      });
    }
  });
}

export async function mockEmptyStudioApi(page: Page) {
  const emptyDashboard = {
    totals: { knowledgeBases: 0, sources: 0, documents: 0, activeIndexes: 0 },
    jobs: { queued: 0, running: 0, succeeded: 0, failed: 0 },
    lastSuccessfulIndexAt: null,
    recentJobs: [],
    system: {
      health: {
        status: 'healthy',
        timestamp: now,
        services: {
          database: { status: 'up' },
          redis: { status: 'up' },
          qdrant: { status: 'not_configured' },
        },
      },
      queue: {
        queued: 0,
        running: 0,
        succeededLastHour: 0,
        failedLast24Hours: 0,
        pressure: 'idle',
      },
      workspaceKinds: {},
      collections: { totalActiveCollections: 0, totalChunks: 0, items: [] },
    },
  };

  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') {
      await fulfillNoContent(route);
      return;
    }

    if (path === '/admin/dashboard') {
      await fulfillJson(route, 200, emptyDashboard);
    } else if (path === '/admin/knowledge-bases') {
      await fulfillJson(route, 200, { knowledgeBases: [] });
    } else if (path === '/admin/jobs/recent') {
      await fulfillJson(route, 200, {
        filters: { knowledgeBaseId: null, knowledgeBaseSlug: null, sourceId: null, limit: 8 },
        jobs: [],
      });
    } else {
      await fulfillJson(route, 404, { message: `No mock for ${path}` });
    }
  });
}

async function handleApiRequest(
  route: Route,
  request: Request,
  url: URL,
  state: ReturnType<typeof createMockState>,
  options: MockStudioApiOptions,
) {
  const { pathname, searchParams } = url;
  const method = request.method();

  if (method === 'GET' && pathname === '/admin/dashboard') {
    await fulfillJson(route, 200, state.dashboard);
    return;
  }

  if (method === 'GET' && pathname === '/admin/knowledge-bases') {
    await fulfillJson(route, 200, { knowledgeBases: state.knowledgeBases });
    return;
  }

  if (method === 'GET' && pathname === '/workspaces') {
    await fulfillJson(route, 200, [
      {
        id: 'kb-career',
        slug: 'career-rag',
        name: 'Career RAG',
        description: 'Personal career workspace',
        workspaceKind: 'personal_work_history',
        defaultIndexProfile: 'memory-default',
        defaultRetrievalProfile: 'agent-context',
        activeIndexVersionId: 'idx-active',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    return;
  }

  if (method === 'POST' && pathname === '/workspaces') {
    const body = (await request.postDataJSON()) as { name: string; slug?: string; workspaceKind?: string };
    await fulfillJson(route, 200, {
      id: 'kb-imported',
      slug: body.slug || 'research-docs',
      name: body.name,
      description: null,
      workspaceKind: body.workspaceKind || 'datasets',
      defaultIndexProfile: 'default',
      defaultRetrievalProfile: 'default',
      activeIndexVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  if (method === 'GET' && pathname === '/admin/jobs/recent') {
    await fulfillJson(route, 200, {
      filters: {
        knowledgeBaseId: null,
        knowledgeBaseSlug: null,
        sourceId: null,
        limit: Number(searchParams.get('limit') ?? 8),
      },
      jobs: state.recentJobs,
    });
    return;
  }

  if (method === 'GET' && pathname === '/admin/knowledge-bases/career-rag') {
    await fulfillJson(route, 200, state.workspaceDetail);
    return;
  }

  if (method === 'GET' && pathname === '/workspaces/career-rag/export-manifest') {
    await fulfillJson(route, 200, state.exportManifest);
    return;
  }

  if (method === 'GET' && pathname === '/workspaces/career-rag/resources') {
    await fulfillJson(route, 200, state.workspaceResources);
    return;
  }

  if (method === 'GET' && pathname === '/vector-backends/read-model') {
    await fulfillJson(route, 200, state.vectorBackendsReadModel);
    return;
  }

  if (method === 'GET' && pathname === '/workspaces/career-rag/vector-placement') {
    await fulfillJson(route, 200, state.vectorPlacement);
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/vector-placement/pin') {
    const body = (await request.postDataJSON()) as { vectorBackendId: string };
    state.vectorPlacement.vectorBackendId = body.vectorBackendId;
    state.vectorPlacement.mode = 'pinned';
    await fulfillJson(route, 200, state.vectorPlacement);
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/vector-operations') {
    const body = (await request.postDataJSON()) as { kind: string; targetVectorBackendId?: string };
    const operation = vectorOperationFixture(
      `op-${Date.now()}`,
      body.kind,
      body.targetVectorBackendId || 'backend-default',
    );
    state.vectorBackendsReadModel.backends[0].operations.push(operation);
    await fulfillJson(route, 200, operation);
    return;
  }

  if (method === 'POST' && pathname.startsWith('/vector-operations/')) {
    const [, , operationId, action] = pathname.split('/');
    const operation = state.vectorBackendsReadModel.backends
      .flatMap((backend) => backend.operations)
      .find((item) => item.id === operationId);
    if (!operation) {
      await fulfillJson(route, 404, { message: 'operation not found' });
      return;
    }
    if (action === 'build-compatible-copy') operation.state = 'ready_for_cutover';
    if (action === 'cutover') operation.state = 'cutover_complete';
    if (action === 'rollback') operation.state = 'rollback_complete';
    if (action === 'cleanup') operation.state = 'cleanup_pending';
    await fulfillJson(route, 200, operation);
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/unload') {
    state.workspaceResources.lifecycle.status = 'unloaded';
    state.workspaceResources.lifecycle.collectionAvailable = false;
    await fulfillJson(route, 200, {
      workspace: state.workspaceResources.workspace,
      lifecycle: state.workspaceResources.lifecycle,
      job: null,
    });
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/load') {
    state.workspaceResources.lifecycle.status = 'loaded';
    state.workspaceResources.lifecycle.collectionAvailable = true;
    await fulfillJson(route, 200, {
      workspace: state.workspaceResources.workspace,
      lifecycle: state.workspaceResources.lifecycle,
      job: null,
    });
    return;
  }

  if (method === 'GET' && pathname === '/workspaces/career-rag/memory') {
    const entryType = searchParams.get('entryType');
    const tag = searchParams.get('tag');
    const sessionId = searchParams.get('sessionId');
    const entries = state.memoryEntries.filter((entry) => {
      if (entryType && entry.entryType !== entryType) return false;
      if (tag && !entry.tags.includes(tag)) return false;
      if (sessionId && entry.sessionId !== sessionId) return false;
      return true;
    });
    await fulfillJson(route, 200, entries);
    return;
  }

  if (method === 'GET' && pathname === '/workspaces/career-rag/recent-decisions') {
    const results = state.memoryEntries.filter((entry) => entry.entryType === 'decision').slice(0, 5);
    await fulfillJson(route, 200, { knowledgeBaseId: 'kb-career', results, count: results.length });
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/search-memory') {
    await fulfillJson(route, 200, {
      knowledgeBaseId: 'kb-career',
      retrievalProfile: retrievalProfile('memory-recall', 'Memory recall'),
      results: [
        {
          id: 'mem-search-1',
          entryType: 'decision',
          title: 'Prefer dry-run before rebuild',
          body: 'Operators should preview source refresh plans before rebuild_collection.',
          summary: 'Preview rebuilds first.',
          tags: ['ops', 'refresh'],
          authoredBy: 'codex',
          sessionId: 'session-42',
          occurredAt: now,
          createdAt: now,
          metadata: { source: 'mock' },
          score: 0.91,
        },
      ],
      count: 1,
    });
    return;
  }

  if (method === 'POST' && pathname.startsWith('/workspaces/career-rag/memory')) {
    const body = (await request.postDataJSON()) as {
      entryType?: string;
      title?: string;
      body: string;
      summary?: string;
      tags?: string[];
      authoredBy?: string;
      sessionId?: string;
    };
    const entryType = pathname.endsWith('/decisions')
      ? 'decision'
      : pathname.endsWith('/session-summaries')
        ? 'session_summary'
        : body.entryType || 'fact';
    const entry = makeMemoryEntry(`mem-created-${state.memoryEntries.length + 1}`, {
      entryType,
      title: body.title || null,
      body: body.body,
      summary: body.summary || null,
      tags: body.tags || [],
      authoredBy: body.authoredBy || null,
      sessionId: body.sessionId || null,
    });
    state.memoryEntries.unshift(entry);
    await fulfillJson(route, 200, entry);
    return;
  }

  if (method === 'POST' && pathname === '/admin/knowledge-bases/career-rag/retrieval-playground') {
    const body = (await request.postDataJSON()) as {
      query: string;
      pathPrefix?: string;
      language?: string;
      branch?: string;
      rerank?: { enabled?: boolean; providerName?: string; topN?: number; fallbackAllowed?: boolean };
    };
    if (body.query.includes('backend fails')) {
      await fulfillJson(route, 503, { message: 'retrieval backend offline' });
      return;
    }
    const empty = body.query.includes('empty result');
    await fulfillJson(route, 200, retrievalTrace(body, empty));
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/ask') {
    const body = (await request.postDataJSON()) as {
      query: string;
      mode?: 'chunks' | 'rag_answer';
      profileKey?: string;
      llm?: { providerName?: string; maxOutputTokens?: number; temperature?: number };
    };
    if (body.query.includes('provider down')) {
      await fulfillJson(route, 503, {
        error: {
          code: 'llm_unavailable',
          message: 'Answer LLM provider is unavailable',
          stage: 'generate_answer',
          retryable: true,
          details: { providerConfigId: 'prov-local', model: 'qwen3-14b' },
        },
        path: pathname,
        timestamp: now,
      });
      return;
    }
    if (body.query.includes('budget empty')) {
      await fulfillJson(route, 422, {
        error: {
          code: 'answer_output_budget_empty',
          message: 'Retrieval profile reserves no tokens for answer generation',
          stage: 'prepare_answer_budget',
          retryable: false,
          details: { reservedOutputTokens: 0 },
        },
        path: pathname,
        timestamp: now,
      });
      return;
    }
    await fulfillJson(route, 200, askResponse(body));
    return;
  }

  if (method === 'GET' && pathname === '/workspaces/career-rag/eval/questions') {
    const datasetId = searchParams.get('datasetId');
    await fulfillJson(route, 200, {
      knowledgeBaseId: 'kb-career',
      questions:
        datasetId === 'cf-standard-benchmark'
          ? [
              {
                id: 'q-scifact-1',
                knowledgeBaseId: 'kb-career',
                text: 'Which SciFact evidence supports this claim?',
                expectedDocumentIds: ['beir_scifact_doc_1'],
                expectedChunkIds: [],
                metadata: { datasetId: 'cf-standard-benchmark' },
                createdAt: now,
              },
            ]
          : state.evalQuestions,
    });
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/benchmarks/cf-standard-benchmark/import') {
    await fulfillJson(route, 200, {
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
    });
    return;
  }

  if (method === 'GET' && pathname === '/workspaces/career-rag/eval/runs') {
    await fulfillJson(route, 200, {
      knowledgeBaseId: 'kb-career',
      runs: state.evalRuns,
    });
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/eval/runs') {
    const body = (await request.postDataJSON()) as {
      profileKey?: string;
      datasetId?: string;
      topK?: number;
      rerank?: { enabled?: boolean; providerName?: string; topN?: number; fallbackAllowed?: boolean };
    };
    const run = evalRunFixture(
      `run-${state.evalRuns.length + 1}`,
      'Candidate retrieval eval',
      body.profileKey || 'agent-context',
      body.rerank?.enabled ? 1 : 0.92,
      'hash-candidate',
      body,
    );
    state.evalRuns.unshift(run);
    await fulfillJson(route, 201, run);
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/eval/profile-comparison') {
    const runs = [
      evalRunFixture('run-compare-agent', 'Profile comparison - agent-context', 'agent-context', 0.72, 'hash-agent'),
      evalRunFixture('run-compare-docs', 'Profile comparison - docs-qa', 'docs-qa', 0.88, 'hash-docs'),
    ];
    state.evalRuns.unshift(...runs);
    await fulfillJson(route, 201, {
      profileKeys: ['agent-context', 'docs-qa'],
      runs,
      summary: [
        {
          runId: runs[0].id,
          profileKey: 'agent-context',
          metrics: runs[0].metrics,
          deltasFromBaseline: {},
        },
        {
          runId: runs[1].id,
          profileKey: 'docs-qa',
          metrics: runs[1].metrics,
          deltasFromBaseline: { hitAtK: 0.16, mrr: 0.14, emptyResultRate: -0.1 },
        },
      ],
    });
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/eval/run-comparison') {
    const body = (await request.postDataJSON()) as { baselineRunId: string; candidateRunId: string };
    await fulfillJson(route, 201, {
      baselineRunId: body.baselineRunId,
      candidateRunId: body.candidateRunId,
      baselineMetrics: state.evalRuns.find((run) => run.id === body.baselineRunId)?.metrics || {},
      candidateMetrics: state.evalRuns.find((run) => run.id === body.candidateRunId)?.metrics || {},
      metricDeltas: { hitAtK: 0.18, mrr: 0.12, emptyResultRate: -0.1 },
      config: {
        baselineHash: 'hash-baseline',
        candidateHash: 'hash-current',
        changed: true,
      },
      perQuestionDeltas: [
        {
          evalQuestionId: 'q-context-work',
          deltas: { hitAtK: 1, reciprocalRank: 0.5 },
        },
      ],
    });
    return;
  }

  if (method === 'POST' && pathname === '/workspaces/career-rag/sources/src-local/refresh') {
    const body = (await request.postDataJSON()) as { mode?: string; reason?: string; dryRun?: boolean };
    if (body.dryRun) {
      await fulfillJson(route, 200, sourceRefreshPlan(body.mode || 'incremental', body.reason));
    } else {
      await fulfillJson(route, 200, sourceRefreshJob(body.mode || 'incremental', body.reason));
    }
    return;
  }

  if (pathname === '/workspaces/career-rag/sources/src-local/policy') {
    if (method === 'PUT') {
      const body = (await request.postDataJSON()) as {
        syncPolicy?: Record<string, unknown>;
      };
      state.sourcePolicy = {
        ...state.sourcePolicy,
        syncPolicy: body.syncPolicy || state.sourcePolicy.syncPolicy,
        autoRefreshEnabled: body.syncPolicy?.enabled === true && body.syncPolicy?.triggerMode !== 'manual',
        nextTriggerAt:
          body.syncPolicy?.enabled === true && body.syncPolicy?.triggerMode === 'schedule'
            ? '2026-06-05T09:05:00.000Z'
            : null,
      };
      await fulfillJson(route, 200, state.sourcePolicy);
      return;
    }

    if (method === 'GET') {
      await fulfillJson(route, 200, state.sourcePolicy);
      return;
    }
  }

  if (method === 'POST' && pathname === '/sources') {
    const body = (await request.postDataJSON()) as { knowledgeBaseSlug?: string; type: string; uri: string };
    await fulfillJson(route, 200, {
      id: 'src-obsidian',
      knowledgeBaseId: 'kb-career',
      type: body.type,
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
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  if (method === 'POST' && pathname.endsWith('/sources/upload')) {
    if (options.failUpload) {
      await fulfillJson(route, 400, {
        error: {
          code: 'managed_upload_unsupported_file',
          message: 'Only text-like files and ZIP archives are supported.',
        },
      });
      return;
    }
    await fulfillJson(route, 200, state.uploadResult);
    return;
  }

  if (method === 'POST' && pathname === '/jobs/indexing') {
    await fulfillJson(route, 200, { id: 'job-import-1' });
    return;
  }

  if (method === 'GET' && pathname === '/jobs/indexing/job-import-1') {
    await fulfillJson(route, 200, state.jobs['job-import-1']);
    return;
  }

  if (method === 'GET' && pathname === '/jobs/indexing/job-unavailable' && options.failJobDetail) {
    await fulfillJson(route, 503, { message: 'Indexing service temporarily unavailable' });
    return;
  }

  if (method === 'GET' && pathname === '/jobs/indexing/job-failed') {
    await fulfillJson(route, 200, state.jobs['job-failed']);
    return;
  }

  if (method === 'GET' && pathname === '/jobs/indexing/job-success') {
    await fulfillJson(route, 200, state.jobs['job-success']);
    return;
  }

  await fulfillJson(route, 404, { message: `No mock for ${method} ${pathname}` });
}

function createMockState() {
  const successJob = jobSummary('job-success', 'succeeded');
  const failedJob = jobSummary('job-failed', 'failed', {
    lastErrorSummary: {
      at: now,
      message: 'Parser failed on broken.pdf',
      code: 'document_parse_failed',
      stage: 'parse',
    },
  });

  const memoryEntries = [
    makeMemoryEntry('mem-decision-1', {
      entryType: 'decision',
      title: 'Use Studio dry-run refresh',
      body: 'Run the dry-run plan before rebuilding shared source collections.',
      summary: 'Dry-run rebuilds before applying.',
      tags: ['ops', 'refresh'],
      authoredBy: 'codex',
      sessionId: 'session-42',
    }),
    makeMemoryEntry('mem-fact-1', {
      entryType: 'fact',
      title: 'Career docs are indexed',
      body: 'The career-rag workspace contains resume and project notes.',
      summary: 'Career data exists.',
      tags: ['career'],
      authoredBy: 'operator',
      sessionId: null,
    }),
  ];

  const workspaceCard = {
    id: 'kb-career',
    slug: 'career-rag',
    name: 'Career RAG',
    description: 'Personal career workspace',
    activeIndexVersionId: 'idx-active',
    createdAt: now,
    updatedAt: now,
    counts: { sources: 1, activeSources: 1, documents: 3, indexVersions: 2, jobs: 4 },
    lastSuccessfulIndexAt: now,
    lastJobStatus: 'succeeded',
    lastErrorSummary: null,
  };

  return {
    dashboard: {
      totals: { knowledgeBases: 1, sources: 1, documents: 3, activeIndexes: 1 },
      jobs: { queued: 1, running: 1, succeeded: 9, failed: 1 },
      lastSuccessfulIndexAt: now,
      recentJobs: [successJob, failedJob],
      system: {
        health: {
          status: 'degraded',
          timestamp: now,
          services: {
            database: { status: 'up' },
            redis: { status: 'up' },
            qdrant: { status: 'down', error: 'connection refused' },
          },
        },
        queue: {
          queued: 1,
          running: 1,
          succeededLastHour: 4,
          failedLast24Hours: 1,
          pressure: 'active',
        },
        workspaceKinds: { personal_work_history: 1 },
        collections: {
          totalActiveCollections: 1,
          totalChunks: 12,
          items: [
            {
              knowledgeBaseId: 'kb-career',
              knowledgeBaseSlug: 'career-rag',
              knowledgeBaseName: 'Career RAG',
              workspaceKind: 'personal_work_history',
              indexVersionId: 'idx-active',
              vectorCollectionName: 'cf_career_active',
              materializationMode: 'mutable_collection',
              chunkCount: 12,
              createdAt: now,
              embeddingModel: 'text-embedding-3-small',
              embeddingDimension: 1536,
            },
          ],
        },
      },
    },
    knowledgeBases: [workspaceCard],
    recentJobs: [successJob, failedJob],
    workspaceResources: {
      workspace: {
        id: 'kb-career',
        slug: 'career-rag',
        name: 'Career RAG',
        workspaceKind: 'personal_work_history',
      },
      lifecycle: {
        status: 'loaded',
        activeIndexVersionId: 'idx-active',
        vectorCollectionName: 'cf_career_active',
        vectorBackendId: 'backend-default',
        placementState: 'loaded',
        collectionAvailable: true,
      },
      activeIndexVersion: {
        id: 'idx-active',
        status: 'active',
        lifecycleStatus: 'loaded',
        embeddingModel: 'BAAI/bge-small-en-v1.5',
        embeddingDimension: 384,
        storageProfile: 'balanced',
        storageConfig: { onDiskVectors: true, scalarQuantization: true },
        resourceEstimate: {},
        resourceRequested: { kind: 'requested', storageProfile: 'balanced' },
        resourceAllocated: { kind: 'allocated', vectorBackendId: 'backend-default' },
        resourceObserved: { kind: 'observed', vectorBackendId: 'backend-default' },
        resourceActual: {},
        createdAt: now,
      },
      estimate: {
        storageProfile: 'balanced',
        documentCount: 3,
        sourceFileCount: 3,
        sourceContentBytes: 4096,
        estimatedChunks: 12,
        embeddingDimension: 384,
        rawVectorBytes: 18432,
        qdrantDiskBytesLow: 29491,
        qdrantDiskBytesHigh: 44237,
        estimatedRamBytes: 9216,
        warnings: [
          {
            code: 'ram_dev_target',
            message: 'System is near the 8 GB RAM dev target',
          },
        ],
        generatedAt: now,
      },
      resources: {
        estimate: { kind: 'estimate', storageProfile: 'balanced' },
        requested: { kind: 'requested', storageProfile: 'balanced' },
        allocated: { kind: 'allocated', vectorBackendId: 'backend-default' },
        observed: { kind: 'observed', vectorBackendId: 'backend-default' },
      },
    },
    vectorPlacement: {
      id: 'placement-1',
      knowledgeBaseId: 'kb-career',
      vectorBackendId: 'backend-default',
      servingRevisionId: 'serving-1',
      activeIndexBuildId: 'build-1',
      collectionAlias: 'workspace-career-rag',
      physicalCollectionName: 'cf_career_active',
      mode: 'capacity_assisted',
      state: 'loaded',
      reasonSnapshot: { reason: 'capacity_assisted_initial' },
      capacitySnapshot: { requiredDiskBytes: 1024, requiredRamBytes: 512 },
      updatedAt: now,
    },
    vectorBackendsReadModel: {
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
          capacityHints: { diskBytes: 256000000000, ramBytes: 8000000000 },
          observedResources: { collectionCount: 1, vectorCount: 12 },
          healthMetadata: { healthy: true, compatible: true },
          lastHealthAt: now,
          lastErrorCode: null,
          assignedWorkspaceCount: 1,
          assignedWorkspaces: [],
          operations: [vectorOperationFixture('op-ready', 'backend_move', 'backend-cold', 'ready_for_cutover')],
        },
        {
          id: 'backend-cold',
          name: 'cold-node',
          baseUrl: 'http://qdrant-b:6333',
          apiKeyRef: '[configured]',
          hasApiKeyRef: true,
          tlsVerify: true,
          labels: ['ssd', 'remote'],
          state: 'enabled',
          capacityHints: { diskBytes: 256000000000, ramBytes: 8000000000 },
          observedResources: { collectionCount: 0, vectorCount: 0 },
          healthMetadata: { healthy: true, compatible: true },
          lastHealthAt: now,
          lastErrorCode: null,
          assignedWorkspaceCount: 0,
          assignedWorkspaces: [],
          operations: [],
        },
      ],
    },
    workspaceDetail: {
      knowledgeBase: {
        ...workspaceCard,
        workspaceKind: 'personal_work_history',
        defaultRetrievalProfile: 'agent-context',
        activeIndexVersion: {
          id: 'idx-active',
          status: 'active',
          createdAt: now,
          embeddingModel: 'text-embedding-3-small',
          embeddingDimension: 1536,
          vectorCollectionName: 'cf_career_active',
          materializationMode: 'mutable_collection',
        },
        indexVersions: [
          {
            id: 'idx-active',
            status: 'active',
            createdAt: now,
            embeddingModel: 'text-embedding-3-small',
            embeddingDimension: 1536,
            vectorCollectionName: 'cf_career_active',
            materializationMode: 'mutable_collection',
          },
          {
            id: 'idx-previous',
            status: 'superseded',
            createdAt: '2026-06-04T09:00:00.000Z',
            embeddingModel: 'text-embedding-3-small',
            embeddingDimension: 1536,
            vectorCollectionName: 'cf_career_previous',
            materializationMode: 'immutable_collection',
          },
        ],
        sources: [
          {
            id: 'src-local',
            type: 'local_folder',
            uri: '/data/career',
            status: 'active',
            includeRules: ['**/*.md'],
            excludeRules: ['tmp/**'],
            lastSyncedAt: now,
            createdAt: now,
            updatedAt: now,
            documentCount: 3,
            lastSnapshot: {
              at: now,
              ref: 'main@abc123',
              snapshotType: 'local_scan',
              fileCount: 3,
              contentBytes: 4096,
            },
            lastSuccessfulIndexAt: now,
            lastJob: successJob,
            lastErrorSummary: null,
          },
        ],
      },
      recentJobs: [successJob, failedJob],
      explorer: {
        documentLimit: 20,
        documents: [
          {
            id: 'doc-resume',
            sourceId: 'src-local',
            path: 'resume.md',
            mimeType: 'text/markdown',
            contentHash: 'sha256-resume',
            status: 'indexed',
            chunkCount: 4,
            metadata: { title: 'Resume' },
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'doc-projects',
            sourceId: 'src-local',
            path: 'projects/contextforge.md',
            mimeType: 'text/markdown',
            contentHash: 'sha256-projects',
            status: 'indexed',
            chunkCount: 8,
            metadata: { language: 'markdown' },
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      retrievalPlayground: {
        defaultProfileKey: 'agent-context',
        profiles: [retrievalProfile('agent-context', 'Agent context'), retrievalProfile('docs-qa', 'Docs QA')],
        activeCollection: {
          indexVersionId: 'idx-active',
          vectorCollectionName: 'cf_career_active',
          materializationMode: 'mutable_collection',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimension: 1536,
          createdAt: now,
        },
        suggestedRequest: {
          queryPlaceholder: 'What ContextForge work should I mention?',
          topK: 6,
          tokenBudget: 1200,
        },
      },
    },
    evalQuestions: [
      {
        id: 'q-context-work',
        knowledgeBaseId: 'kb-career',
        text: 'What ContextForge work should I mention?',
        expectedDocumentIds: ['doc-projects'],
        expectedChunkIds: [],
        metadata: { datasetId: 'cf-smoke-mini' },
        createdAt: now,
      },
    ],
    evalRuns: [
      evalRunFixture('run-current', 'Docs QA eval', 'docs-qa', 0.86, 'hash-current'),
      evalRunFixture('run-baseline', 'Agent context eval', 'agent-context', 0.68, 'hash-baseline'),
    ],
    exportManifest: {
      formatVersion: 'workspace-export-manifest.v1',
      exportedAt: now,
      exportScope: {
        kind: 'metadata',
        includes: ['workspace', 'sources', 'retrievalProfiles', 'memoryEntries'],
        excludes: ['vector data', 'raw uploaded files'],
      },
      workspace: {
        id: 'kb-career',
        slug: 'career-rag',
        name: 'Career RAG',
        description: 'Personal career workspace',
        kind: 'personal_work_history',
        activeIndexVersionId: 'idx-active',
      },
      sources: [{ id: 'src-local', type: 'local_folder', uri: '/data/career', metadata: {} }],
      restorePlan: {
        mode: 'plan_only',
        supportedFirstRestoreModes: ['validate', 'apply_metadata'],
        recommendedSteps: ['Review source remaps', 'Run reindex after restore'],
        requiresReindexForSearch: true,
        sourceWarnings: [
          {
            type: 'local_folder',
            uri: '/data/career',
            message: 'Local folder sources require an operator remap on restore.',
          },
        ],
        notes: ['Vectors are intentionally not embedded in the manifest.'],
      },
      counts: {
        sources: 1,
        retrievalProfiles: 1,
        memoryEntries: 2,
        documents: 3,
        chunks: 12,
        sourceSnapshots: 1,
        indexVersions: 2,
        validationReports: 1,
      },
    },
    sourcePolicy: {
      source: {
        id: 'src-local',
        knowledgeBaseId: 'kb-career',
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
      lastSyncedAt: now,
      nextTriggerAt: null,
    },
    memoryEntries,
    uploadResult: {
      workspace: {
        id: 'kb-imported',
        slug: 'research-docs',
        name: 'Research Docs',
        workspaceKind: 'datasets',
      },
      upload: {
        id: 'upload-1',
        originalFileName: 'dataset.md',
        archiveFormat: 'single_file',
        sizeBytes: 1280,
        fileCount: 1,
        contentBytes: 900,
        uploadedAt: now,
      },
      source: {
        id: 'src-upload',
        knowledgeBaseId: 'kb-imported',
        type: 'upload',
        uri: 'upload://upload-1',
        includeRules: ['**/*.md'],
        excludeRules: ['node_modules/**'],
        status: 'active',
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
      next: {
        enqueueIndexing: {
          method: 'POST',
          path: '/jobs/indexing',
          body: { knowledgeBaseId: 'kb-imported', sourceId: 'src-upload', type: 'scan_source' },
        },
      },
    },
    jobs: {
      'job-import-1': jobDetail('job-import-1', 'succeeded'),
      'job-success': jobDetail('job-success', 'succeeded'),
      'job-failed': jobDetail('job-failed', 'failed', {
        error: 'document_parse_failed',
        logs: [
          {
            at: now,
            level: 'warn',
            message: 'Low confidence text extraction',
            data: { code: 'low_confidence_pdf_text' },
          },
          {
            at: now,
            level: 'error',
            message: 'Parser failed on broken.pdf',
            data: { code: 'document_parse_failed', stage: 'parse' },
          },
        ],
      }),
    },
  };
}

function jobSummary(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    knowledgeBase: { id: 'kb-career', slug: 'career-rag', name: 'Career RAG' },
    source: { id: 'src-local', type: 'local_folder', uri: '/data/career', status: 'active' },
    type: 'scan_source',
    status,
    createdAt: now,
    startedAt: now,
    finishedAt: status === 'running' || status === 'queued' ? null : now,
    progress: progress(),
    lastErrorSummary: null,
    lastLogAt: now,
    ...overrides,
  };
}

function jobDetail(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    knowledgeBaseId: 'kb-career',
    sourceId: 'src-local',
    type: 'scan_source',
    status,
    stats: {
      filesScanned: 3,
      filesParsed: 3,
      chunksCreated: 12,
      vectorsUpserted: 12,
      validationReportId: 'validation-1',
    },
    logs: [{ at: now, level: 'info', message: 'Indexing completed', data: { stage: 'materialize' } }],
    startedAt: now,
    finishedAt: status === 'queued' || status === 'running' ? null : now,
    createdAt: now,
    ...overrides,
  };
}

function progress() {
  return {
    added: 1,
    changed: 1,
    deleted: 0,
    unchanged: 1,
    filesScanned: 3,
    filesParsed: 3,
    filesIgnored: 0,
    parseFailures: 0,
    chunksCreated: 12,
    chunksDeleted: 0,
    chunksReused: 2,
    vectorsDeleted: 0,
    vectorsUpserted: 12,
    payloadsUpdated: 1,
    documentsCreated: 1,
    documentsChanged: 1,
    documentsDeleted: 0,
    documentsSkipped: 1,
    validationReportId: 'validation-1',
  };
}

function retrievalProfile(key: string, name: string) {
  return {
    key,
    name,
    intent: 'agent_context',
    denseTopK: 6,
    scoreThreshold: null,
    neighborBefore: 1,
    neighborAfter: 1,
    tokenBudget: 1200,
    grouping: 'source',
    recencyBoost: false,
  };
}

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
    knowledgeBaseId: 'kb-career',
    indexVersionId: 'idx-active',
    name,
    status: 'succeeded',
    metrics: {
      profileKey,
      datasetId: (request.datasetId as string | undefined) || 'cf-smoke-mini',
      questionCount: 1,
      topK: (request.topK as number | undefined) || 5,
      hitAtK,
      hitAt1: hitAtK,
      hitAt3: hitAtK,
      mrr: Math.max(hitAtK - 0.08, 0),
      expectedDocumentHitRate: hitAtK,
      expectedChunkHitRate: hitAtK,
      emptyResultRate: hitAtK > 0.8 ? 0 : 0.1,
      duplicateRate: 0,
      latencyMs: {
        p50: 16.4,
        p95: 31.8,
        min: 12.1,
        max: 31.8,
      },
      reranker: rerank?.enabled
        ? {
            comparedQuestions: 1,
            meanReciprocalRankDelta: 0.22,
            changedTopRate: 1,
          }
        : undefined,
      configHash,
      config: {
        index: {
          id: 'idx-active',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimension: 1536,
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
    createdAt: now,
    finishedAt: now,
    results: [],
  };
}

function retrievalTrace(
  body: {
    query: string;
    pathPrefix?: string;
    language?: string;
    branch?: string;
    rerank?: { enabled?: boolean; providerName?: string; topN?: number; fallbackAllowed?: boolean };
  },
  empty: boolean,
) {
  const reranked = body.rerank?.enabled === true;
  const item = {
    text: 'ContextForge work focused on Studio E2E coverage and smoke automation.',
    score: 0.88,
    documentId: 'doc-projects',
    chunkId: 'chunk-projects-1',
    sourceId: 'src-local',
    path: 'projects/contextforge.md',
    mimeType: 'text/markdown',
    language: body.language || 'markdown',
    branch: body.branch || 'main',
    commit: 'abc123',
    startLine: 10,
    endLine: 20,
    tokenCount: 54,
    metadata: {
      pathPrefix: body.pathPrefix || null,
      ...(reranked ? { rerankerScore: 0.81, originalRank: 2, rerankerRanked: true } : {}),
    },
  };
  const items = empty ? [] : [item];

  return {
    knowledgeBase: {
      id: 'kb-career',
      slug: 'career-rag',
      name: 'Career RAG',
      workspaceKind: 'personal_work_history',
      defaultRetrievalProfile: 'agent-context',
    },
    request: {
      query: body.query,
      topK: 6,
      tokenBudget: 1200,
      profileKey: 'agent-context',
      filters: {
        pathPrefix: body.pathPrefix,
        language: body.language,
        branch: body.branch,
      },
    },
    trace: {
      knowledgeBaseId: 'kb-career',
      indexVersionId: 'idx-active',
      query: body.query,
      retrievalProfile: retrievalProfile('agent-context', 'Agent context'),
      appliedFilters: { pathPrefix: body.pathPrefix, language: body.language, branch: body.branch },
      stages: {
        denseCandidates: items,
        filteredCandidates: items,
        dedupedCandidates: items,
        rerankedCandidates: reranked ? items : [],
        expandedCandidates: items,
      },
      contextPackage: {
        count: items.length,
        budget: { requestedTokens: 1200, estimatedTokens: empty ? 0 : 54 },
        groups: items.length ? [{ title: 'projects/contextforge.md', kind: 'docs', items }] : [],
      },
      diagnostics: {
        denseCandidates: items.length,
        filteredCandidates: items.length,
        droppedByFilters: 0,
        droppedDuplicates: 0,
        expandedNeighbors: items.length,
        finalCount: items.length,
        reranked,
        rerankerFallbackUsed: false,
        rerankerCandidateCount: reranked ? items.length : 0,
        reranker: reranked
          ? {
              enabled: true,
              source: 'request',
              providerName: body.rerank?.providerName || 'local-cpu-reranker',
              model: 'cross-encoder/ms-marco-MiniLM-L6-v2',
              topN: body.rerank?.topN || 3,
              fallbackAllowed: body.rerank?.fallbackAllowed ?? true,
            }
          : { enabled: false, source: 'request', reason: 'reranker_disabled_by_request' },
      },
    },
  };
}

function askResponse(body: {
  query: string;
  mode?: 'chunks' | 'rag_answer';
  profileKey?: string;
  llm?: { providerName?: string; maxOutputTokens?: number; temperature?: number };
}) {
  const mode = body.mode || 'chunks';
  const rag = mode === 'rag_answer';
  const item = {
    text: 'ContextForge work focused on Studio E2E coverage and smoke automation.',
    score: 0.88,
    documentId: 'doc-projects',
    chunkId: 'chunk-projects-1',
    sourceId: 'src-local',
    path: 'projects/contextforge.md',
    mimeType: 'text/markdown',
    language: 'markdown',
    branch: 'main',
    commit: 'abc123',
    startLine: 10,
    endLine: 20,
    tokenCount: 54,
    metadata: { sourceRevisionId: 'rev-local-1' },
  };
  const secondItem = {
    text: 'Queue pressure comes from queued and running job counts.',
    score: 0.76,
    documentId: 'doc-queue',
    chunkId: 'chunk-queue-1',
    sourceId: 'src-ops',
    path: 'notes/queue.md',
    mimeType: 'text/markdown',
    language: 'markdown',
    startLine: 3,
    endLine: 8,
    tokenCount: 19,
    metadata: { sourceRevisionId: 'rev-ops-1' },
  };
  const budget = {
    tokenizer: { id: 'qwen3-est', modelFamily: 'qwen3', approximate: true },
    requestedTokens: 1200,
    reservedTokens: {
      system: 24,
      instruction: 8,
      query: 10,
      output: rag ? 512 : 0,
      safety: 32,
    },
    retrievalBudgetTokens: rag ? 626 : 1126,
    usedTokens: 73,
    droppedItems: 0,
    trimmedItems: 0,
    budgetReason: 'fit',
  };
  const contextPackage = {
    count: 2,
    budget: { requestedTokens: 1200, estimatedTokens: 73 },
    groups: [
      { title: 'projects/contextforge.md', kind: 'docs', items: [item] },
      { title: 'notes/queue.md', kind: 'docs', items: [secondItem] },
    ],
  };
  const citations = [
    {
      id: 'C1',
      chunkId: item.chunkId,
      documentId: item.documentId,
      sourceId: item.sourceId,
      sourceRevisionId: 'rev-local-1',
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
    },
    {
      id: 'C2',
      chunkId: secondItem.chunkId,
      documentId: secondItem.documentId,
      sourceId: secondItem.sourceId,
      sourceRevisionId: 'rev-ops-1',
      path: secondItem.path,
      startLine: secondItem.startLine,
      endLine: secondItem.endLine,
    },
  ];

  return {
    mode,
    knowledgeBaseId: 'kb-career',
    indexVersionId: 'idx-active',
    query: body.query,
    retrievalTraceId: 'trace-ask-e2e',
    retrievalTrace: {
      knowledgeBaseId: 'kb-career',
      indexVersionId: 'idx-active',
      query: body.query,
      retrievalProfile: retrievalProfile(body.profileKey || 'agent-context', 'Agent context'),
      appliedFilters: {},
      stages: {
        denseCandidates: [item, secondItem],
        filteredCandidates: [item, secondItem],
        dedupedCandidates: [item, secondItem],
        expandedCandidates: [item, secondItem],
        finalCandidates: [item, secondItem],
      },
      contextPackage,
      diagnostics: {
        serving: {
          servingRevisionId: 'serving-1',
          sourceRevisionIds: ['rev-local-1', 'rev-ops-1'],
          vectorBackendId: 'backend-default',
          collectionName: 'cf_career_active',
          filterPlacement: 'pre_topk',
        },
        denseCandidates: 2,
        lexicalCandidates: 0,
        mergedCandidates: 2,
        filteredCandidates: 2,
        droppedByFilters: 0,
        droppedDuplicates: 0,
        droppedNearDuplicates: 0,
        expandedNeighbors: 0,
        neighborExpansionQueries: 0,
        finalCount: 2,
        reranked: false,
        rerankerFallbackUsed: false,
        rerankerCandidateCount: 0,
        budget,
      },
    },
    contextPackage,
    ...(rag
      ? {
          answer:
            'ContextForge work focuses on Studio E2E coverage [C1] and queue pressure is derived from job counts [C2].',
          provider: {
            providerConfigId: 'prov-local',
            name: body.llm?.providerName || 'local-llm',
            model: 'qwen3-14b',
            protocol: 'openai_compatible',
          },
        }
      : {}),
    citations,
    sourceIds: ['src-local', 'src-ops'],
    diagnostics: {
      retrievalLatencyMs: 38,
      generationLatencyMs: rag ? 640 : 0,
      totalLatencyMs: rag ? 681 : 40,
      estimatedInputTokens: rag ? 320 : 0,
      ...(rag
        ? {
            inputTokens: 328,
            outputTokens: 41,
            estimatedOutputTokens: 26,
            maxOutputTokens: body.llm?.maxOutputTokens ?? 512,
            temperature: body.llm?.temperature ?? 0.2,
            finishReason: 'stop',
          }
        : {}),
      retrievalBudget: budget,
    },
  };
}

function sourceRefreshPlan(mode: string, reason?: string) {
  return {
    dryRun: true,
    mode,
    reason,
    workspace: { id: 'kb-career', slug: 'career-rag', name: 'Career RAG', workspaceKind: 'personal_work_history' },
    source: { id: 'src-local', type: 'local_folder', uri: '/data/career', status: 'active' },
    preparedSource: { scanRoot: '/data/career' },
    plan: {
      stats: { added: 1, changed: 1, deleted: 0, unchanged: 1, filesParsed: 3 },
      addedPaths: ['notes/new-role.md'],
      changedPaths: ['resume.md'],
      unchangedCount: 1,
      deletedPaths: [],
      dependencyHints: [{ path: 'projects/contextforge.md', dependsOn: ['README.md'] }],
      validationIssues: [
        { severity: 'warning', code: 'source_remap_required', message: 'Check local folder remap before restore.' },
      ],
    },
  };
}

function sourceRefreshJob(mode: string, reason?: string) {
  return {
    dryRun: false,
    mode,
    reason,
    workspace: { id: 'kb-career', slug: 'career-rag', name: 'Career RAG', workspaceKind: 'personal_work_history' },
    source: { id: 'src-local', type: 'local_folder', uri: '/data/career', status: 'active' },
    job: { id: 'job-refresh-1' },
  };
}

function vectorOperationFixture(id: string, kind: string, targetVectorBackendId: string, state = 'planned') {
  return {
    id,
    knowledgeBaseId: 'kb-career',
    kind,
    state,
    sourceVectorBackendId: 'backend-default',
    targetVectorBackendId,
    sourceCollectionName: 'cf_career_active',
    targetCollectionName: 'cf_career_candidate',
    servingRevisionId: 'serving-1',
    rollbackUntil: now,
    cleanupAfter: null,
    validationSummary: { sourceCount: 12, targetCount: 12 },
    errorSummary: {},
    updatedAt: now,
  };
}

function makeMemoryEntry(id: string, fields: Partial<MemoryEntry>): MemoryEntry {
  return {
    id,
    knowledgeBaseId: 'kb-career',
    entryType: fields.entryType || 'fact',
    title: fields.title ?? null,
    body: fields.body || 'Remember this context.',
    summary: fields.summary ?? null,
    tags: fields.tags || [],
    authoredBy: fields.authoredBy ?? null,
    sessionId: fields.sessionId ?? null,
    sourceRefs: [],
    occurredAt: fields.occurredAt ?? now,
    createdAt: now,
    updatedAt: now,
    metadata: fields.metadata || {},
  };
}

async function fulfillNoContent(route: Route) {
  await route.fulfill({
    status: 204,
    headers: corsHeaders(),
  });
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: corsHeaders(),
    body: JSON.stringify(body),
  });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
  };
}
