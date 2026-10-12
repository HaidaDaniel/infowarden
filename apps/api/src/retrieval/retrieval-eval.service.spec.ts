import { BadRequestException } from '@nestjs/common';
import { ProviderType } from '@prisma/client';
import { ProvidersService } from '../providers/providers.service';
import { RetrievalEvalService } from './retrieval-eval.service';

describe('RetrievalEvalService', () => {
  it('creates eval questions and filters listed questions by dataset metadata', async () => {
    const { service, prisma } = createService();
    prisma.evalQuestion.create.mockResolvedValue({
      id: 'q-created',
      knowledgeBaseId: 'kb-1',
      text: 'Where is source truth?',
      expectedDocumentIds: ['doc-source-truth'],
      expectedChunkIds: [],
      metadata: { datasetId: 'cf-smoke-mini' },
    });
    prisma.evalQuestion.findMany.mockResolvedValue([
      {
        id: 'q-created',
        knowledgeBaseId: 'kb-1',
        text: 'Where is source truth?',
        expectedDocumentIds: ['doc-source-truth'],
        expectedChunkIds: [],
        metadata: { datasetId: 'cf-smoke-mini' },
      },
      {
        id: 'q-other',
        knowledgeBaseId: 'kb-1',
        text: 'Other?',
        expectedDocumentIds: ['doc-other'],
        expectedChunkIds: [],
        metadata: { datasetId: 'other-pack' },
      },
    ]);

    await expect(
      service.createQuestion('career-rag', {
        text: 'Where is source truth?',
        expectedDocumentIds: ['doc-source-truth'],
        metadata: { datasetId: 'cf-smoke-mini' },
      }),
    ).resolves.toMatchObject({ id: 'q-created' });

    expect(prisma.evalQuestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        text: 'Where is source truth?',
        expectedDocumentIds: ['doc-source-truth'],
        expectedChunkIds: [],
      }),
    });

    await expect(service.listQuestions('career-rag', { datasetId: 'cf-smoke-mini' })).resolves.toMatchObject({
      knowledgeBaseId: 'kb-1',
      questions: [expect.objectContaining({ id: 'q-created' })],
    });
  });

  it('runs deterministic retrieval eval metrics and persists per-question results', async () => {
    const { service, prisma, retrieval } = createService();
    prisma.evalQuestion.findMany.mockResolvedValue([
      {
        id: 'q-1',
        knowledgeBaseId: 'kb-1',
        text: 'agent usable context',
        expectedDocumentIds: ['doc-rag-overview'],
        expectedChunkIds: [],
        metadata: { datasetId: 'cf-smoke-mini' },
      },
      {
        id: 'q-2',
        knowledgeBaseId: 'kb-1',
        text: 'reranker toggle',
        expectedDocumentIds: ['doc-exact-terms'],
        expectedChunkIds: ['chunk-rerank-toggle'],
        metadata: { datasetId: 'cf-smoke-mini' },
      },
    ]);
    prisma.evalRun.create.mockResolvedValue({
      id: 'run-1',
      knowledgeBaseId: 'kb-1',
      indexVersionId: 'index-1',
      name: 'Smoke eval',
      status: 'running',
      metrics: {},
    });
    prisma.evalRun.update.mockImplementation(async ({ data }) => ({
      id: 'run-1',
      knowledgeBaseId: 'kb-1',
      indexVersionId: 'index-1',
      name: 'Smoke eval',
      status: data.status,
      metrics: data.metrics,
      finishedAt: data.finishedAt,
      results: [],
    }));
    retrieval.traceRetrieval
      .mockResolvedValueOnce({
        knowledgeBaseId: 'kb-1',
        indexVersionId: 'index-1',
        retrievalProfile: { key: 'default' },
        stages: traceStages([
          searchResult('chunk-a', 'doc-real-a', {
            externalDocumentId: 'doc-rag-overview',
            path: 'rag-overview.md',
          }),
        ]),
        contextPackage: traceContext(1),
        diagnostics: traceDiagnostics(1),
      })
      .mockResolvedValueOnce({
        knowledgeBaseId: 'kb-1',
        indexVersionId: 'index-1',
        retrievalProfile: { key: 'default' },
        stages: traceStages([
          searchResult('chunk-wrong', 'doc-wrong', { externalDocumentId: 'doc-wrong' }),
          searchResult('chunk-real-b', 'doc-real-b', {
            externalDocumentId: 'doc-exact-terms',
            externalChunkId: 'chunk-rerank-toggle',
          }),
        ]),
        contextPackage: traceContext(2),
        diagnostics: traceDiagnostics(2),
      });

    const run = await service.runEval('career-rag', {
      name: 'Smoke eval',
      datasetId: 'cf-smoke-mini',
      topK: 5,
      rerank: { enabled: false },
    });

    expect(run.metrics).toMatchObject({
      profileKey: 'default',
      topK: 5,
      datasetId: 'cf-smoke-mini',
      questionCount: 2,
      hitAtK: 1,
      hitAt1: 0.5,
      hitAt3: 1,
      mrr: 0.75,
      expectedDocumentHitRate: 1,
      expectedChunkHitRate: 1,
      emptyResultRate: 0,
      duplicateRate: 0,
      latencyMs: expect.objectContaining({
        p50: expect.any(Number),
        p95: expect.any(Number),
      }),
      configHash: expect.any(String),
      config: expect.objectContaining({
        index: expect.objectContaining({
          id: 'index-1',
          embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
          embeddingDimension: 384,
        }),
        retrieval: expect.objectContaining({
          request: expect.objectContaining({
            rerank: { enabled: false },
          }),
        }),
        serving: expect.objectContaining({
          servingRevisionId: 'serving-1',
          manifestHash: 'manifest-hash-1',
          sourceRevisionIds: ['revision-1'],
          vectorBackendId: 'backend-1',
        }),
        providers: expect.objectContaining({
          reranker: expect.objectContaining({
            enabled: false,
            source: 'request',
          }),
        }),
      }),
    });
    expect(retrieval.traceRetrieval).toHaveBeenCalledWith(
      'kb-1',
      expect.objectContaining({
        query: 'agent usable context',
        rerank: { enabled: false },
      }),
    );
    expect(prisma.evalResult.create).toHaveBeenCalledTimes(2);
    expect(prisma.evalResult.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        evalRunId: 'run-1',
        evalQuestionId: 'q-2',
        retrievedChunkIds: ['chunk-wrong', 'chunk-real-b'],
        scores: expect.objectContaining({
          hitAtK: 1,
          hitAt1: 0,
          hitAt3: 1,
          reciprocalRank: 0.5,
          expectedDocumentHit: 1,
          expectedChunkHit: 1,
          latencyMs: expect.any(Number),
        }),
        metadata: expect.objectContaining({
          trace: expect.objectContaining({
            candidateCounts: expect.objectContaining({
              finalCandidates: 2,
            }),
            finalIds: expect.arrayContaining([expect.objectContaining({ chunkId: 'chunk-real-b' })]),
          }),
        }),
      }),
    });
  });

  it('compares saved eval runs with metric and config deltas', async () => {
    const { service, prisma } = createService();
    prisma.evalRun.findMany.mockResolvedValue([
      {
        id: 'run-baseline',
        knowledgeBaseId: 'kb-1',
        metrics: {
          hitAtK: 0.5,
          mrr: 0.25,
          emptyResultRate: 0.25,
          configHash: 'hash-a',
        },
        results: [
          {
            evalQuestionId: 'q-1',
            scores: { hitAtK: 0, reciprocalRank: 0 },
          },
        ],
      },
      {
        id: 'run-candidate',
        knowledgeBaseId: 'kb-1',
        metrics: {
          hitAtK: 1,
          mrr: 0.75,
          emptyResultRate: 0,
          configHash: 'hash-b',
        },
        results: [
          {
            evalQuestionId: 'q-1',
            scores: { hitAtK: 1, reciprocalRank: 1 },
          },
        ],
      },
    ]);

    await expect(
      service.compareRuns('career-rag', {
        baselineRunId: 'run-baseline',
        candidateRunId: 'run-candidate',
      }),
    ).resolves.toMatchObject({
      baselineRunId: 'run-baseline',
      candidateRunId: 'run-candidate',
      metricDeltas: {
        hitAtK: 0.5,
        mrr: 0.5,
        emptyResultRate: -0.25,
      },
      config: {
        baselineHash: 'hash-a',
        candidateHash: 'hash-b',
        changed: true,
      },
      perQuestionDeltas: [
        {
          evalQuestionId: 'q-1',
          deltas: {
            hitAtK: 1,
          },
        },
      ],
    });
  });

  it('rejects eval runs without matching questions', async () => {
    const { service, prisma } = createService();
    prisma.evalQuestion.findMany.mockResolvedValue([]);

    await expect(service.runEval('career-rag', { datasetId: 'missing-pack' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('allows lexical evaluation while dense placement is unloaded', async () => {
    const { service, prisma, retrieval } = createService({
      lifecycleStatus: 'unloaded',
      retrievalProfile: null,
    });
    prisma.evalQuestion.findMany.mockResolvedValue([
      {
        id: 'q-lexical',
        knowledgeBaseId: 'kb-1',
        text: 'lexical query',
        expectedDocumentIds: ['doc-lexical'],
        expectedChunkIds: [],
        metadata: { datasetId: 'cf-smoke-mini' },
      },
    ]);
    prisma.evalRun.create.mockResolvedValue({
      id: 'run-lexical',
      knowledgeBaseId: 'kb-1',
      indexVersionId: 'index-1',
      name: 'Lexical eval',
      status: 'running',
      metrics: {},
    });
    prisma.evalRun.update.mockImplementation(async ({ data }) => ({
      id: 'run-lexical',
      knowledgeBaseId: 'kb-1',
      indexVersionId: 'index-1',
      name: 'Lexical eval',
      status: data.status,
      metrics: data.metrics,
      results: [],
    }));
    retrieval.traceRetrieval.mockResolvedValue({
      knowledgeBaseId: 'kb-1',
      indexVersionId: 'index-1',
      retrievalProfile: { key: 'lexical-structured' },
      stages: traceStages([searchResult('chunk-lexical', 'doc-lexical', {})]),
      contextPackage: traceContext(1),
      diagnostics: traceDiagnostics(1),
    });

    await expect(
      service.runEval('career-rag', {
        name: 'Lexical eval',
        profileKey: 'lexical-pg-fts',
        datasetId: 'cf-smoke-mini',
        topK: 5,
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(prisma.evalRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metrics: expect.objectContaining({
          config: expect.objectContaining({
            retrieval: expect.objectContaining({
              profileSnapshot: expect.objectContaining({
                metadata: expect.objectContaining({
                  candidateStrategy: 'lexical',
                  lexicalStrategy: 'pg-fts',
                }),
              }),
            }),
          }),
        }),
      }),
    });
    expect(retrieval.traceRetrieval).toHaveBeenCalledWith(
      'kb-1',
      expect.objectContaining({ profileKey: 'lexical-pg-fts' }),
    );
  });

  it('captures effective reranker provider identity in an injected provider-backed eval snapshot', async () => {
    const { prisma } = createService();
    prisma.providerConfig.findMany.mockResolvedValue([
      {
        id: 'reranker-default',
        type: ProviderType.reranker,
        name: 'local-reranker',
        model: 'qwen-reranker',
        metadata: { default: true },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const providers = new ProvidersService(prisma as any, { get: jest.fn() } as any);
    const service = new RetrievalEvalService(prisma as any, {} as any, {} as any, providers);

    const snapshot = await (service as any).buildRunConfigSnapshot('kb-1', 'index-1', 'dense-reranker', 5, {}, 0);

    expect(snapshot.providers.reranker).toMatchObject({
      providerId: 'reranker-default',
      providerName: 'local-reranker',
      model: 'qwen-reranker',
      enabled: true,
      source: 'profile',
      fallbackAllowed: true,
    });
    expect((service as any).hashConfig(snapshot)).toMatch(/^[a-f0-9]{64}$/);
  });

  function createService(options: { lifecycleStatus?: string; retrievalProfile?: any } = {}) {
    const prisma = {
      evalQuestion: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      evalRun: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      evalResult: {
        create: jest.fn(),
      },
      indexVersion: {
        findUnique: jest.fn().mockResolvedValue({
          lifecycleStatus: options.lifecycleStatus || 'loaded',
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'index-1',
          knowledgeBaseId: 'kb-1',
          datasetVersionId: 'dataset-version-1',
          embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
          embeddingDimension: 384,
          chunkingConfig: { targetTokens: 500, overlapTokens: 80 },
          vectorCollectionName: 'kb_1_index_1',
          datasetVersion: {
            id: 'dataset-version-1',
            sourceSnapshotIds: ['snapshot-1'],
          },
        }),
      },
      retrievalProfile: {
        findFirst: jest.fn().mockResolvedValue(
          options.retrievalProfile || {
            id: 'profile-1',
            knowledgeBaseId: 'kb-1',
            key: 'default',
            name: 'Default Retrieval',
            intent: 'general_search',
            denseTopK: 10,
            scoreThreshold: null,
            neighborBefore: 0,
            neighborAfter: 0,
            tokenBudget: null,
            grouping: 'document',
            recencyBoost: false,
            metadata: { embeddingProviderName: 'local-cpu-embedding' },
          },
        ),
      },
      knowledgeBase: {
        findUnique: jest.fn().mockResolvedValue({
          activeServingRevisionId: 'serving-1',
          activeServingRevision: {
            manifestHash: 'manifest-hash-1',
            manifestEntries: [{ sourceRevisionId: 'revision-1' }],
          },
        }),
      },
      workspaceVectorPlacement: {
        findUnique: jest.fn().mockResolvedValue({
          vectorBackendId: 'backend-1',
          physicalCollectionName: 'kb-1-physical',
          collectionAlias: 'kb-1',
        }),
      },
      providerConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
    };
    const knowledgeBases = {
      resolveIdentifier: jest.fn().mockResolvedValue({
        id: 'kb-1',
        name: 'Career RAG',
        activeIndexVersionId: 'index-1',
        defaultRetrievalProfile: 'default',
      }),
    };
    const retrieval = {
      search: jest.fn(),
      traceRetrieval: jest.fn(),
    };

    return {
      service: new RetrievalEvalService(prisma as any, knowledgeBases as any, retrieval as any),
      prisma,
      retrieval,
    };
  }

  function searchResult(chunkId: string, documentId: string, metadata: Record<string, unknown>) {
    return {
      text: `result ${chunkId}`,
      score: 0.9,
      documentId,
      chunkId,
      metadata,
    };
  }

  function traceStages(results: any[]) {
    return {
      denseCandidates: results,
      lexicalCandidates: [],
      mergedCandidates: results,
      filteredCandidates: results,
      dedupedCandidates: results,
      rerankedCandidates: results,
      expandedCandidates: results,
      finalCandidates: results,
    };
  }

  function traceContext(count: number) {
    return {
      count,
      budget: { estimatedTokens: 128 },
      groups: [],
    };
  }

  function traceDiagnostics(count: number) {
    return {
      denseCandidates: count,
      lexicalCandidates: 0,
      mergedCandidates: count,
      filteredCandidates: count,
      droppedByFilters: 0,
      droppedDuplicates: 0,
      expandedNeighbors: 0,
      finalCount: count,
      reranked: false,
      rerankerFallbackUsed: false,
    };
  }
});
