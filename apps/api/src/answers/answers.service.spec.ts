import { AppException } from '../common/app-error';
import { RetrievalService } from '../retrieval/retrieval.service';
import { AnswersService } from './answers.service';

describe('AnswersService', () => {
  it('executes rag_answer through the real fresh-workspace fallback budget path', async () => {
    const { service, prisma, vectorIndex, llm } = createFreshWorkspaceService();
    llm.generate.mockResolvedValue({
      answer: 'PostgreSQL owns canonical state [C1].',
      inputTokens: 90,
      outputTokens: 10,
      finishReason: 'stop',
    });

    const result = await service.ask('docs', {
      mode: 'rag_answer',
      query: 'Where is canonical state?',
    });

    const budget = result.diagnostics.retrievalBudget;
    const totalReserved = Object.values(budget.reservedTokens).reduce((sum, value) => sum + value, 0);
    expect(prisma.retrievalProfile.findFirst).toHaveBeenCalledWith({
      where: { knowledgeBaseId: 'kb-1', key: 'default' },
    });
    expect(result.retrievalTrace.retrievalProfile.key).toBe('default');
    expect(result.answer).toBe('PostgreSQL owns canonical state [C1].');
    expect(result.contextPackage.count).toBe(1);
    expect(budget.reservedTokens.output).toBeGreaterThan(0);
    expect(totalReserved + budget.retrievalBudgetTokens).toBe(budget.requestedTokens);
    expect(vectorIndex.search).toHaveBeenCalledTimes(1);
    expect(llm.generate).toHaveBeenCalledTimes(1);
    expect(llm.generate.mock.calls[0][0].maxOutputTokens).toBe(budget.reservedTokens.output);
  });

  it('returns chunks and retrieval trace without resolving or calling an LLM', async () => {
    const { service, retrieval, providers, llm } = createService();

    const result = await service.ask('docs', {
      mode: 'chunks',
      query: 'Where is canonical state?',
      tokenBudget: 800,
    });

    expect(retrieval.traceRetrieval).toHaveBeenCalledWith('docs', {
      query: 'Where is canonical state?',
      tokenBudget: 800,
    });
    expect(providers.resolveAnswerLlmProvider).not.toHaveBeenCalled();
    expect(llm.generate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: 'chunks',
      knowledgeBaseId: 'kb-1',
      retrievalTraceId: 'trace-1',
      citations: [
        {
          id: 'C1',
          chunkId: 'chunk-1',
          sourceId: 'source-1',
          sourceRevisionId: 'revision-1',
        },
      ],
      diagnostics: { generationLatencyMs: 0 },
    });
  });

  it('generates one RAG answer and maps only cited retrieved chunks', async () => {
    const { service, retrieval, providers, llm } = createService();
    llm.generate.mockResolvedValue({
      answer: 'PostgreSQL owns canonical state [C1].',
      inputTokens: 90,
      outputTokens: 10,
      finishReason: 'stop',
    });

    const result = await service.ask('docs', {
      mode: 'rag_answer',
      query: 'Where is canonical state?',
      llm: { providerId: 'llm-1', maxOutputTokens: 400 },
    });

    expect(providers.resolveAnswerLlmProvider).toHaveBeenCalledWith({
      providerId: 'llm-1',
      maxOutputTokens: 400,
    });
    expect(providers.resolveAnswerLlmProvider.mock.invocationCallOrder[0]).toBeLessThan(
      retrieval.traceRetrieval.mock.invocationCallOrder[0],
    );
    expect(retrieval.traceRetrieval).toHaveBeenCalledWith(
      'docs',
      { query: 'Where is canonical state?' },
      {
        systemTokens: expect.any(Number),
        instructionTokens: expect.any(Number),
        outputTokens: 400,
        safetyTokens: expect.any(Number),
      },
    );
    expect(llm.generate).toHaveBeenCalledTimes(1);
    expect(llm.generate.mock.calls[0][1][1].content).toContain('[C1] docs/truth.md:4-8 chunk=chunk-1');
    expect(result).toMatchObject({
      mode: 'rag_answer',
      answer: 'PostgreSQL owns canonical state [C1].',
      citations: [
        {
          id: 'C1',
          path: 'docs/truth.md',
          startLine: 4,
          endLine: 8,
        },
      ],
      sourceIds: ['source-1'],
      provider: {
        providerConfigId: 'llm-1',
        model: 'small-instruct',
      },
      diagnostics: {
        inputTokens: 90,
        outputTokens: 10,
        maxOutputTokens: 100,
      },
    });
    expect(llm.generate.mock.calls[0][0]).toMatchObject({
      maxOutputTokens: 100,
    });
  });

  it('preserves retrieval diagnostics when the LLM fails', async () => {
    const { service, llm } = createService();
    llm.generate.mockRejectedValue(
      new AppException('llm_timeout', 'Answer LLM request timed out', 'generate_answer', true),
    );

    await expect(
      service.ask('docs', {
        mode: 'rag_answer',
        query: 'Where is canonical state?',
      }),
    ).rejects.toMatchObject({
      code: 'llm_timeout',
      stage: 'generate_answer',
      retryable: true,
      details: {
        providerConfigId: 'llm-1',
        model: 'small-instruct',
        retrievalTraceId: 'trace-1',
        retrieval: {
          knowledgeBaseId: 'kb-1',
          finalCount: 1,
        },
      },
    });
  });

  it('fails provider resolution before starting retrieval or generation', async () => {
    const { service, retrieval, providers, llm } = createService();
    providers.resolveAnswerLlmProvider.mockRejectedValue(
      new AppException(
        'answer_llm_provider_not_found',
        'Answer LLM provider not found',
        'resolve_answer_provider',
        false,
      ),
    );

    await expect(
      service.ask('docs', {
        mode: 'rag_answer',
        query: 'Where is canonical state?',
      }),
    ).rejects.toMatchObject({
      code: 'answer_llm_provider_not_found',
      stage: 'resolve_answer_provider',
    });
    expect(retrieval.traceRetrieval).not.toHaveBeenCalled();
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('rejects answer generation when bounded retrieval returns no context', async () => {
    const emptyTrace = retrievalTrace();
    emptyTrace.stages.finalCandidates = [];
    emptyTrace.contextPackage.count = 0;
    emptyTrace.contextPackage.budget.estimatedTokens = 0;
    emptyTrace.contextPackage.groups = [];
    emptyTrace.diagnostics.finalCount = 0;
    emptyTrace.diagnostics.budget.usedTokens = 0;
    const { service, llm } = createService(emptyTrace);

    await expect(
      service.ask('docs', {
        mode: 'rag_answer',
        query: 'Where is canonical state?',
      }),
    ).rejects.toMatchObject({
      code: 'answer_context_empty',
      stage: 'prepare_answer_context',
      details: {
        retrieval: { finalCount: 0 },
      },
    });
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('rejects invented citation labels and keeps retrieval diagnostics', async () => {
    const { service, llm } = createService();
    llm.generate.mockResolvedValue({ answer: 'Unsupported claim [C99].' });

    await expect(
      service.ask('docs', {
        mode: 'rag_answer',
        query: 'Where is canonical state?',
      }),
    ).rejects.toMatchObject({
      code: 'llm_invalid_citations',
      details: {
        invalidCitationIds: ['C99'],
        retrievalTraceId: 'trace-1',
      },
    });
  });
});

function createService(trace = retrievalTrace()) {
  const retrieval = {
    traceRetrieval: jest.fn().mockResolvedValue(trace),
  };
  const providers = {
    resolveAnswerLlmProvider: jest.fn().mockImplementation(async (override?: any) => ({
      source: 'provider_config',
      providerConfigId: 'llm-1',
      name: 'answer-llm',
      baseUrl: 'http://llm.test/v1',
      model: 'small-instruct',
      timeoutMs: 1000,
      maxOutputTokens: override?.maxOutputTokens ?? 500,
      temperature: 0,
      protocol: 'openai_compatible',
    })),
  };
  const llm = {
    generate: jest.fn(),
  };
  const telemetry = {
    current: jest.fn().mockReturnValue({ traceId: 'trace-1' }),
  };
  return {
    service: new AnswersService(retrieval as any, providers as any, llm as any, telemetry as any),
    retrieval,
    providers,
    llm,
  };
}

function retrievalTrace() {
  const budget = {
    tokenizer: {
      id: 'approx-chars-v1',
      modelFamily: 'generic',
      approximate: true,
    },
    requestedTokens: 800,
    reservedTokens: {
      system: 10,
      instruction: 10,
      query: 10,
      output: 100,
      safety: 10,
    },
    retrievalBudgetTokens: 660,
    usedTokens: 30,
    droppedItems: 0,
    trimmedItems: 0,
    budgetReason: 'within_budget',
  };
  const item = {
    text: 'PostgreSQL owns canonical application state.',
    score: 0.9,
    documentId: 'doc-1',
    chunkId: 'chunk-1',
    sourceId: 'source-1',
    path: 'docs/truth.md',
    startLine: 4,
    endLine: 8,
    metadata: { sourceRevisionId: 'revision-1' },
  };
  return {
    knowledgeBaseId: 'kb-1',
    indexVersionId: 'index-1',
    query: 'Where is canonical state?',
    retrievalProfile: {
      key: 'docs-qa',
      name: 'Docs QA',
      intent: 'docs',
      denseTopK: 10,
      lexicalEnabled: true,
      lexicalTopK: 10,
      neighborBefore: 0,
      neighborAfter: 0,
      grouping: 'path',
      recencyBoost: false,
    },
    appliedFilters: undefined,
    stages: {
      denseCandidates: [item],
      lexicalCandidates: [],
      mergedCandidates: [item],
      filteredCandidates: [item],
      dedupedCandidates: [item],
      rerankedCandidates: [item],
      nearDedupedCandidates: [item],
      expandedCandidates: [item],
      finalCandidates: [item],
    },
    contextPackage: {
      count: 1,
      budget: { requestedTokens: 800, estimatedTokens: 30 },
      groups: [{ title: 'docs/truth.md', kind: 'docs', items: [item] }],
    },
    diagnostics: {
      serving: {
        servingRevisionId: 'serving-1',
        sourceRevisionIds: ['revision-1'],
        vectorBackendId: 'backend-1',
        collectionName: 'collection-1',
        filterPlacement: 'pre_topk',
      },
      denseCandidates: 1,
      lexicalCandidates: 0,
      mergedCandidates: 1,
      filteredCandidates: 1,
      droppedByFilters: 0,
      droppedDuplicates: 0,
      droppedNearDuplicates: 0,
      expandedNeighbors: 0,
      neighborExpansionQueries: 0,
      finalCount: 1,
      reranked: false,
      rerankerFallbackUsed: false,
      rerankerCandidateCount: 0,
      budget,
    },
  };
}

function createFreshWorkspaceService() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    workspaceServingRevision: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'serving-1',
        status: 'active',
        manifestEntries: [{ sourceRevision: { id: 'revision-1', status: 'ready' } }],
      }),
    },
    indexVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'index-1',
        status: 'active',
        vectorCollectionName: 'kb-kb-1',
      }),
    },
    retrievalProfile: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    chunk: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const knowledgeBases = {
    resolveIdentifier: jest.fn().mockResolvedValue({
      id: 'kb-1',
      name: 'Docs',
      activeIndexVersionId: 'index-1',
      activeServingRevisionId: 'serving-1',
      defaultRetrievalProfile: 'default',
    }),
  };
  const embeddings = {
    resolveProvider: jest.fn().mockResolvedValue({
      source: 'environment',
      name: 'environment',
      baseUrl: 'http://embedding.test/v1',
      model: 'test-embedding',
      dimension: 3,
      timeoutMs: 1000,
      protocol: 'openai_compatible',
    }),
    embedTexts: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  };
  const vectorIndex = {
    search: jest.fn().mockResolvedValue([
      {
        id: 'point-1',
        score: 0.9,
        payload: {
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          sourceId: 'source-1',
          sourceRevisionId: 'revision-1',
          indexVersionId: 'index-1',
          text: 'PostgreSQL owns canonical application state.',
          startLine: 4,
          endLine: 8,
          metadata: {
            path: 'docs/truth.md',
            sourceRevisionId: 'revision-1',
          },
        },
      },
    ]),
  };
  const retrievalProviders = {
    resolveRerankerProvider: jest.fn().mockResolvedValue({
      requested: false,
      enabled: false,
      source: 'none',
      fallbackAllowed: true,
      reason: 'no_reranker_configured',
    }),
    rerankCandidates: jest.fn().mockResolvedValue({
      reranked: false,
      fallbackUsed: false,
      reason: 'reranker_not_enabled',
      candidateCount: 0,
      scores: [],
    }),
  };
  const placement = {
    resolveForKnowledgeBase: jest.fn().mockResolvedValue({
      vectorBackendId: 'backend-1',
      servingRevisionId: 'serving-1',
      physicalCollectionName: 'kb-kb-1',
      state: 'loaded',
    }),
  };
  const retrieval = new RetrievalService(
    prisma as any,
    knowledgeBases as any,
    embeddings as any,
    vectorIndex as any,
    retrievalProviders as any,
    placement as any,
  );
  const providers = {
    resolveAnswerLlmProvider: jest.fn().mockResolvedValue({
      source: 'provider_config',
      providerConfigId: 'llm-1',
      name: 'answer-llm',
      baseUrl: 'http://llm.test/v1',
      model: 'small-instruct',
      timeoutMs: 1000,
      maxOutputTokens: 1024,
      temperature: 0,
      protocol: 'openai_compatible',
    }),
  };
  const llm = { generate: jest.fn() };
  const telemetry = {
    current: jest.fn().mockReturnValue({ traceId: 'trace-fallback' }),
  };

  return {
    service: new AnswersService(retrieval, providers as any, llm as any, telemetry as any),
    prisma,
    vectorIndex,
    llm,
  };
}
