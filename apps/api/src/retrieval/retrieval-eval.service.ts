import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { ProvidersService } from '../providers/providers.service';
import { RetrievalService, RetrievalTraceResponse, SearchRequest, SearchResponse } from './retrieval.service';
import { RetrievalEvalMetrics, type EvalQuestionRow } from './retrieval-eval-metrics';
import {
  isBuiltInLexicalProfileKey,
  resolveCandidateStrategy,
  resolveRetrievalProfileMetadata,
} from './retrieval-internal.types';

export type CreateEvalQuestionRequest = {
  id?: string;
  text: string;
  expectedDocumentIds?: string[];
  expectedChunkIds?: string[];
  metadata?: Record<string, unknown>;
};

export type RunRetrievalEvalRequest = {
  name?: string;
  profileKey?: string;
  questionIds?: string[];
  datasetId?: string;
  datasetVersion?: string;
  topK?: number;
  rerank?: SearchRequest['rerank'];
  questions?: CreateEvalQuestionRequest[];
};

export type CompareRetrievalProfilesRequest = RunRetrievalEvalRequest & {
  profileKeys: string[];
};

export type CompareEvalRunsRequest = {
  baselineRunId: string;
  candidateRunId: string;
};

type RunConfigSnapshot = {
  dataset: {
    id?: string;
    version?: string;
    datasetVersionId?: string;
    sourceSnapshotIds: string[];
  };
  index: {
    id: string;
    embeddingModel: string;
    embeddingDimension: number;
    chunkingConfig: unknown;
    vectorCollectionName: string;
  };
  serving: {
    servingRevisionId?: string;
    manifestHash?: string;
    sourceRevisionIds: string[];
    vectorBackendId?: string;
    vectorCollectionName?: string;
  };
  retrieval: {
    profileKey: string;
    profileId?: string;
    profileSnapshot: Record<string, unknown>;
    request: {
      topK: number;
      questionCount: number;
      rerank?: SearchRequest['rerank'];
    };
  };
  providers: {
    embedding: {
      model: string;
      dimension: number;
      providerId?: string;
      providerName?: string;
    };
    reranker?: {
      providerId?: string;
      providerName?: string;
      model?: string;
      topN?: unknown;
      fallbackAllowed?: unknown;
      enabled: boolean;
      source?: 'profile' | 'request';
      reason?: string;
    };
  };
};

@Injectable()
export class RetrievalEvalService {
  private readonly metrics = new RetrievalEvalMetrics();

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly retrievalService: RetrievalService,
    @Optional() private readonly providersService?: ProvidersService,
    @Optional() metrics?: RetrievalEvalMetrics,
  ) {
    if (metrics) this.metrics = metrics;
  }

  async createQuestion(identifier: string, request: CreateEvalQuestionRequest) {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const text = request.text?.trim();
    if (!text) {
      throw new BadRequestException('Eval question text is required');
    }

    return this.prisma.evalQuestion.create({
      data: {
        ...(request.id ? { id: request.id } : {}),
        knowledgeBaseId: knowledgeBase.id,
        text,
        expectedDocumentIds: request.expectedDocumentIds || [],
        expectedChunkIds: request.expectedChunkIds || [],
        metadata: (request.metadata || {}) as any,
      },
    });
  }

  async listQuestions(identifier: string, filters: { datasetId?: string; limit?: number } = {}) {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const questions = await this.prisma.evalQuestion.findMany({
      where: {
        knowledgeBaseId: knowledgeBase.id,
      },
      orderBy: { createdAt: 'asc' },
      take: filters.limit || 100,
    });

    return {
      knowledgeBaseId: knowledgeBase.id,
      questions: filters.datasetId
        ? questions.filter((question) => this.questionDatasetId(question) === filters.datasetId)
        : questions,
    };
  }

  async listRuns(identifier: string, limit = 20) {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const runs = await this.prisma.evalRun.findMany({
      where: { knowledgeBaseId: knowledgeBase.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { results: true },
    });

    return { knowledgeBaseId: knowledgeBase.id, runs };
  }

  async getRun(identifier: string, runId: string) {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const run = await this.prisma.evalRun.findFirst({
      where: { id: runId, knowledgeBaseId: knowledgeBase.id },
      include: { results: true },
    });
    if (!run) {
      throw new NotFoundException('Eval run not found');
    }

    return run;
  }

  async runEval(identifier: string, request: RunRetrievalEvalRequest) {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(identifier);
    if (!knowledgeBase.activeIndexVersionId) {
      throw new BadRequestException('Workspace has no active index version for evaluation');
    }
    const profileKey = (request.profileKey || knowledgeBase.defaultRetrievalProfile || 'default').trim() || 'default';
    const retrievalProfile = await this.prisma.retrievalProfile.findFirst({
      where: { knowledgeBaseId: knowledgeBase.id, key: profileKey },
      select: { metadata: true },
    });
    const lexicalOnly =
      isBuiltInLexicalProfileKey(profileKey) ||
      resolveCandidateStrategy(
        resolveRetrievalProfileMetadata(profileKey, this.asRecord(retrievalProfile?.metadata)),
      ) === 'lexical';
    const activeIndexVersion = await this.prisma.indexVersion.findUnique({
      where: { id: knowledgeBase.activeIndexVersionId },
      select: { lifecycleStatus: true },
    });
    if (!lexicalOnly && activeIndexVersion?.lifecycleStatus && activeIndexVersion.lifecycleStatus !== 'loaded') {
      throw new BadRequestException('Workspace index is unloaded; load the workspace before evaluation');
    }

    const questions = await this.resolveQuestions(knowledgeBase.id, request);
    if (questions.length === 0) {
      throw new BadRequestException('No eval questions matched the request');
    }

    const topK = this.normalizeTopK(request.topK);
    const configSnapshot = await this.buildRunConfigSnapshot(
      knowledgeBase.id,
      knowledgeBase.activeIndexVersionId,
      profileKey,
      topK,
      request,
      questions.length,
    );
    const runMetadata = {
      profileKey,
      topK,
      datasetId: configSnapshot.dataset.id,
      datasetVersion: configSnapshot.dataset.version,
      datasetVersionId: configSnapshot.dataset.datasetVersionId,
      indexVersionId: configSnapshot.index.id,
      questionCount: questions.length,
      config: configSnapshot,
      configHash: this.hashConfig(configSnapshot),
    };
    const run = await this.prisma.evalRun.create({
      data: {
        knowledgeBaseId: knowledgeBase.id,
        indexVersionId: knowledgeBase.activeIndexVersionId,
        name: request.name || this.defaultRunName(profileKey, request.datasetId),
        status: 'running',
        metrics: runMetadata as any,
      },
    });

    try {
      const scoredResults = [];
      const latencies = [];
      for (const question of questions) {
        const searchRequest = {
          query: question.text,
          topK,
          profileKey,
          filters: this.questionFilters(question),
          rerank: request.rerank,
        } satisfies SearchRequest;

        const startedAt = process.hrtime.bigint();
        let response: SearchResponse;
        let trace: RetrievalTraceResponse | undefined;
        try {
          trace = await this.retrieveTrace(knowledgeBase.id, searchRequest);
          response = this.responseFromTrace(trace);
        } catch (error) {
          const latencyMs = this.elapsedMs(startedAt);
          await this.prisma.evalResult.create({
            data: {
              evalRunId: run.id,
              evalQuestionId: question.id,
              retrievedChunkIds: [],
              scores: {
                hitAtK: 0,
                hitAt1: 0,
                hitAt3: 0,
                reciprocalRank: 0,
                expectedDocumentHit: 0,
                resultCount: 0,
                duplicateCount: 0,
                latencyMs,
              } as any,
              metadata: {
                questionText: question.text,
                expectedDocumentIds: question.expectedDocumentIds,
                expectedChunkIds: question.expectedChunkIds,
                datasetId: this.questionDatasetId(question),
                error: this.errorSummary(error),
                trace: {
                  latencyMs,
                  fallbackErrorCode: this.errorCode(error),
                },
              } as any,
            },
          });
          throw error;
        }

        const latencyMs = this.elapsedMs(startedAt);
        const score = this.metrics.scoreQuestion(question, response.results, topK, {
          beforeRerank: trace.stages.dedupedCandidates,
        });
        score.latencyMs = latencyMs;
        scoredResults.push(score);
        latencies.push(latencyMs);
        await this.prisma.evalResult.create({
          data: {
            evalRunId: run.id,
            evalQuestionId: question.id,
            retrievedChunkIds: response.results.map((result) => result.chunkId),
            scores: score as any,
            metadata: {
              questionText: question.text,
              expectedDocumentIds: question.expectedDocumentIds,
              expectedChunkIds: question.expectedChunkIds,
              retrievedDocumentIds: response.results.map((result) => result.documentId),
              retrievedPaths: response.results.map((result) => result.path).filter(Boolean),
              retrievalProfile: response.retrievalProfile,
              datasetId: this.questionDatasetId(question),
              latencyMs,
              topResults: response.results.slice(0, Math.min(5, topK)).map((result) => ({
                chunkId: result.chunkId,
                documentId: result.documentId,
                path: result.path,
                score: result.score,
                metadata: result.metadata,
              })),
              trace: this.summarizeTrace(trace, latencyMs, topK),
            } as any,
          },
        });
      }

      const metrics = this.metrics.aggregateMetrics(scoredResults, runMetadata, latencies);
      return this.prisma.evalRun.update({
        where: { id: run.id },
        data: {
          status: 'succeeded',
          metrics: metrics as any,
          finishedAt: new Date(),
        },
        include: { results: true },
      });
    } catch (error) {
      await this.prisma.evalRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          metrics: {
            ...runMetadata,
            error: this.errorSummary(error),
          } as any,
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async compareProfiles(identifier: string, request: CompareRetrievalProfilesRequest) {
    const profileKeys = [...new Set((request.profileKeys || []).map((key) => key.trim()).filter(Boolean))];
    if (profileKeys.length < 2) {
      throw new BadRequestException('profileKeys must include at least two profiles');
    }

    const runs = [];
    for (const profileKey of profileKeys) {
      runs.push(
        await this.runEval(identifier, {
          ...request,
          profileKey,
          name: `${request.name || 'Retrieval profile comparison'} - ${profileKey}`,
        }),
      );
    }

    return {
      profileKeys,
      runs,
      summary: runs.map((run) => ({
        runId: run.id,
        profileKey: (run.metrics as Record<string, unknown>)?.profileKey,
        metrics: run.metrics,
        deltasFromBaseline: run.id === runs[0]?.id ? {} : this.metricDeltas(runs[0]?.metrics, run.metrics),
      })),
    };
  }

  async compareRuns(identifier: string, request: CompareEvalRunsRequest) {
    if (!request.baselineRunId || !request.candidateRunId) {
      throw new BadRequestException('baselineRunId and candidateRunId are required');
    }
    if (request.baselineRunId === request.candidateRunId) {
      throw new BadRequestException('baselineRunId and candidateRunId must be different');
    }

    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const runs = await this.prisma.evalRun.findMany({
      where: {
        knowledgeBaseId: knowledgeBase.id,
        id: { in: [request.baselineRunId, request.candidateRunId] },
      },
      include: { results: true },
    });
    const baseline = runs.find((run) => run.id === request.baselineRunId);
    const candidate = runs.find((run) => run.id === request.candidateRunId);
    if (!baseline || !candidate) {
      throw new NotFoundException('Eval run comparison target not found');
    }

    return {
      baselineRunId: baseline.id,
      candidateRunId: candidate.id,
      baselineMetrics: baseline.metrics,
      candidateMetrics: candidate.metrics,
      metricDeltas: this.metricDeltas(baseline.metrics, candidate.metrics),
      config: {
        baselineHash: this.asRecord(baseline.metrics).configHash,
        candidateHash: this.asRecord(candidate.metrics).configHash,
        changed: this.asRecord(baseline.metrics).configHash !== this.asRecord(candidate.metrics).configHash,
      },
      perQuestionDeltas: this.perQuestionDeltas(baseline.results || [], candidate.results || []),
    };
  }

  private async resolveQuestions(
    knowledgeBaseId: string,
    request: RunRetrievalEvalRequest,
  ): Promise<EvalQuestionRow[]> {
    if (request.questions?.length) {
      return request.questions.map((question, index) => ({
        id: question.id || `inline-${index + 1}`,
        knowledgeBaseId,
        text: question.text,
        expectedDocumentIds: question.expectedDocumentIds || [],
        expectedChunkIds: question.expectedChunkIds || [],
        metadata: question.metadata || {},
      }));
    }

    const questions = await this.prisma.evalQuestion.findMany({
      where: {
        knowledgeBaseId,
        ...(request.questionIds?.length ? { id: { in: request.questionIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    return request.datasetId
      ? questions.filter((question) => this.questionDatasetId(question) === request.datasetId)
      : questions;
  }

  private normalizeTopK(topK?: number): number {
    if (!topK) {
      return 5;
    }
    return Math.min(Math.max(Math.floor(topK), 1), 50);
  }

  private defaultRunName(profileKey: string, datasetId?: string): string {
    return datasetId ? `${datasetId} retrieval eval (${profileKey})` : `Retrieval eval (${profileKey})`;
  }

  private questionDatasetId(question: { metadata: unknown }): string | undefined {
    const metadata = this.asRecord(question.metadata);
    return typeof metadata.datasetId === 'string' ? metadata.datasetId : undefined;
  }

  private questionFilters(question: { metadata: unknown }): SearchRequest['filters'] {
    const metadata = this.asRecord(question.metadata);
    const filters = this.asRecord(metadata.filters);
    return Object.keys(filters).length ? (filters as SearchRequest['filters']) : undefined;
  }

  private async buildRunConfigSnapshot(
    knowledgeBaseId: string,
    indexVersionId: string,
    profileKey: string,
    topK: number,
    request: RunRetrievalEvalRequest,
    questionCount: number,
  ): Promise<RunConfigSnapshot> {
    const [indexVersion, knowledgeBase, placement] = await Promise.all([
      this.prisma.indexVersion.findFirst({
        where: { id: indexVersionId, knowledgeBaseId },
        include: { datasetVersion: true },
      }),
      this.prisma.knowledgeBase.findUnique({
        where: { id: knowledgeBaseId },
        select: {
          activeServingRevisionId: true,
          activeServingRevision: {
            select: {
              manifestHash: true,
              manifestEntries: {
                orderBy: { position: 'asc' },
                select: { sourceRevisionId: true },
              },
            },
          },
        },
      }),
      this.prisma.workspaceVectorPlacement.findUnique({
        where: { knowledgeBaseId },
        select: {
          vectorBackendId: true,
          physicalCollectionName: true,
          collectionAlias: true,
        },
      }),
    ]);
    if (!indexVersion) {
      throw new BadRequestException('Active index version was not found for evaluation');
    }

    const retrievalProfile = await this.prisma.retrievalProfile.findFirst({
      where: { knowledgeBaseId, key: profileKey },
    });
    const profileMetadata = resolveRetrievalProfileMetadata(profileKey, this.asRecord(retrievalProfile?.metadata));
    const profileReranker = this.asRecord(profileMetadata.reranker);
    const resolvedReranker = this.providersService
      ? await this.providersService.resolveRerankerProvider(
          { key: profileKey, metadata: profileMetadata },
          request.rerank,
        )
      : undefined;
    const rerankerEnabled =
      request.rerank?.enabled ??
      (profileReranker.enabled === false
        ? false
        : Boolean(
            profileReranker.enabled === true ||
            profileReranker.providerId ||
            profileReranker.id ||
            profileReranker.providerName ||
            profileReranker.name ||
            profileReranker.topN ||
            profileMetadata.rerankerProviderId ||
            profileMetadata.rerankerId ||
            profileMetadata.rerankerProviderName,
          ));
    const rerankerConfigured = resolvedReranker
      ? resolvedReranker.requested
      : Boolean(
          request.rerank ||
          rerankerEnabled ||
          profileMetadata.rerankerProviderId ||
          profileMetadata.rerankerId ||
          profileMetadata.rerankerProviderName ||
          profileReranker.providerId ||
          profileReranker.id ||
          profileReranker.providerName ||
          profileReranker.name,
        );

    return {
      dataset: {
        id: request.datasetId,
        version: request.datasetVersion,
        datasetVersionId: indexVersion.datasetVersionId,
        sourceSnapshotIds: Array.isArray(indexVersion.datasetVersion?.sourceSnapshotIds)
          ? indexVersion.datasetVersion.sourceSnapshotIds
          : [],
      },
      index: {
        id: indexVersion.id,
        embeddingModel: indexVersion.embeddingModel,
        embeddingDimension: indexVersion.embeddingDimension,
        chunkingConfig: indexVersion.chunkingConfig,
        vectorCollectionName: indexVersion.vectorCollectionName,
      },
      serving: {
        servingRevisionId: knowledgeBase?.activeServingRevisionId || undefined,
        manifestHash: knowledgeBase?.activeServingRevision?.manifestHash,
        sourceRevisionIds:
          knowledgeBase?.activeServingRevision?.manifestEntries.map((entry) => entry.sourceRevisionId) || [],
        vectorBackendId: placement?.vectorBackendId,
        vectorCollectionName: placement?.physicalCollectionName || placement?.collectionAlias || undefined,
      },
      retrieval: {
        profileKey,
        profileId: retrievalProfile?.id,
        profileSnapshot: retrievalProfile
          ? {
              id: retrievalProfile.id,
              key: retrievalProfile.key,
              name: retrievalProfile.name,
              intent: retrievalProfile.intent,
              denseTopK: retrievalProfile.denseTopK,
              scoreThreshold: retrievalProfile.scoreThreshold,
              neighborBefore: retrievalProfile.neighborBefore,
              neighborAfter: retrievalProfile.neighborAfter,
              tokenBudget: retrievalProfile.tokenBudget,
              grouping: retrievalProfile.grouping,
              recencyBoost: retrievalProfile.recencyBoost,
              metadata: profileMetadata,
            }
          : {
              key: profileKey,
              source: 'implicit_default',
              metadata: profileMetadata,
            },
        request: {
          topK,
          questionCount,
          ...(request.rerank ? { rerank: request.rerank } : {}),
        },
      },
      providers: {
        embedding: {
          model: indexVersion.embeddingModel,
          dimension: indexVersion.embeddingDimension,
          providerId: this.stringValue(profileMetadata.embeddingProviderId),
          providerName: this.stringValue(profileMetadata.embeddingProviderName),
        },
        ...(rerankerConfigured || resolvedReranker?.requested
          ? {
              reranker: {
                providerId: resolvedReranker
                  ? resolvedReranker.providerConfigId || resolvedReranker.requestedProviderId
                  : this.stringValue(request.rerank?.providerId) ||
                    this.stringValue(profileMetadata.rerankerProviderId) ||
                    this.stringValue(profileMetadata.rerankerId) ||
                    this.stringValue(profileReranker.providerId) ||
                    this.stringValue(profileReranker.id),
                providerName: resolvedReranker
                  ? resolvedReranker.name || resolvedReranker.requestedProviderName
                  : this.stringValue(request.rerank?.providerName) ||
                    this.stringValue(profileMetadata.rerankerProviderName) ||
                    this.stringValue(profileReranker.providerName) ||
                    this.stringValue(profileReranker.name),
                topN: resolvedReranker
                  ? resolvedReranker.topN
                  : (request.rerank?.topN ??
                    profileMetadata.rerankerTopN ??
                    profileMetadata.rerankTopN ??
                    profileReranker.topN),
                fallbackAllowed: resolvedReranker
                  ? resolvedReranker.fallbackAllowed
                  : (request.rerank?.fallbackAllowed ??
                    profileMetadata.rerankerFallbackAllowed ??
                    profileReranker.fallbackAllowed),
                enabled: resolvedReranker?.enabled ?? rerankerEnabled,
                source: resolvedReranker?.source === 'request' || request.rerank ? 'request' : 'profile',
                ...(resolvedReranker?.model ? { model: resolvedReranker.model } : {}),
                ...(resolvedReranker?.reason ? { reason: resolvedReranker.reason } : {}),
              },
            }
          : {}),
      },
    };
  }

  private hashConfig(snapshot: RunConfigSnapshot): string {
    return createHash('sha256').update(this.stableStringify(snapshot)).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableStringify((value as Record<string, unknown>)[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private async retrieveTrace(knowledgeBaseId: string, request: SearchRequest): Promise<RetrievalTraceResponse> {
    if (typeof (this.retrievalService as any).traceRetrieval === 'function') {
      return this.retrievalService.traceRetrieval(knowledgeBaseId, request);
    }

    const response = await this.retrievalService.search(knowledgeBaseId, request);
    return {
      knowledgeBaseId: response.knowledgeBaseId,
      indexVersionId: response.indexVersionId,
      query: request.query,
      retrievalProfile: response.retrievalProfile,
      appliedFilters: request.filters,
      stages: {
        denseCandidates: response.results,
        lexicalCandidates: [],
        mergedCandidates: response.results,
        filteredCandidates: response.results,
        dedupedCandidates: response.results,
        rerankedCandidates: response.results,
        nearDedupedCandidates: response.results,
        expandedCandidates: response.results,
        finalCandidates: response.results,
      },
      contextPackage: {
        count: response.results.length,
        budget: { requestedTokens: request.tokenBudget, estimatedTokens: 0 },
        groups: [],
      },
      diagnostics: {
        serving: {
          servingRevisionId: 'compatibility-unknown',
          sourceRevisionIds: [],
          vectorBackendId: 'compatibility-unknown',
          collectionName: 'compatibility-unknown',
          filterPlacement: 'pre_topk',
        },
        denseCandidates: response.results.length,
        lexicalCandidates: 0,
        mergedCandidates: response.results.length,
        filteredCandidates: response.results.length,
        droppedByFilters: 0,
        droppedDuplicates: 0,
        droppedNearDuplicates: 0,
        expandedNeighbors: 0,
        neighborExpansionQueries: 0,
        finalCount: response.results.length,
        reranked: false,
        rerankerFallbackUsed: false,
        rerankerCandidateCount: 0,
        budget: {
          tokenizer: {
            id: 'contextforge-approx-v1',
            modelFamily: 'approximate',
            approximate: true,
          },
          requestedTokens: request.tokenBudget || 0,
          reservedTokens: {
            system: 0,
            instruction: 0,
            query: 0,
            output: 0,
            safety: 0,
          },
          retrievalBudgetTokens: request.tokenBudget || 0,
          usedTokens: 0,
          droppedItems: 0,
          trimmedItems: 0,
          budgetReason: 'compatibility_fallback',
        },
      },
    };
  }

  private responseFromTrace(trace: RetrievalTraceResponse): SearchResponse {
    return {
      knowledgeBaseId: trace.knowledgeBaseId,
      indexVersionId: trace.indexVersionId,
      retrievalProfile: trace.retrievalProfile,
      results: trace.stages.finalCandidates,
      count: trace.stages.finalCandidates.length,
    };
  }

  private summarizeTrace(trace: RetrievalTraceResponse, latencyMs: number, topK: number): Record<string, unknown> {
    return {
      latencyMs,
      candidateCounts: Object.fromEntries(
        Object.entries(trace.stages).map(([stage, results]) => [stage, results.length]),
      ),
      finalIds: trace.stages.finalCandidates.slice(0, topK).map((result) => ({
        chunkId: result.chunkId,
        documentId: result.documentId,
        path: result.path,
      })),
      scoreBreakdown: trace.stages.finalCandidates.slice(0, Math.min(5, topK)).map((result) => {
        const metadata = this.asRecord(result.metadata);
        return {
          chunkId: result.chunkId,
          score: result.score,
          denseScore: metadata.denseScore,
          lexicalScore: metadata.lexicalScore,
          rerankerScore: metadata.rerankerScore,
          retrievalSources: metadata.retrievalSources,
        };
      }),
      diagnostics: trace.diagnostics,
      fallbackErrorCode: trace.diagnostics.rerankerFallbackUsed
        ? trace.diagnostics.rerankerReason || 'reranker_fallback'
        : undefined,
      contextPackage: {
        count: trace.contextPackage.count,
        groupCount: trace.contextPackage.groups.length,
        budget: trace.contextPackage.budget,
      },
    };
  }

  private elapsedMs(startedAt: bigint): number {
    return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  }

  private metricDeltas(baselineMetrics: unknown, candidateMetrics: unknown): Record<string, number> {
    const baseline = this.asRecord(baselineMetrics);
    const candidate = this.asRecord(candidateMetrics);
    const keys = [
      'hitAtK',
      'hitAt1',
      'hitAt3',
      'mrr',
      'expectedDocumentHitRate',
      'expectedChunkHitRate',
      'emptyResultRate',
      'duplicateRate',
    ];
    return Object.fromEntries(
      keys
        .filter((key) => typeof baseline[key] === 'number' && typeof candidate[key] === 'number')
        .map((key) => [key, (candidate[key] as number) - (baseline[key] as number)]),
    );
  }

  private perQuestionDeltas(
    baselineResults: Array<{ evalQuestionId: string; scores: unknown }>,
    candidateResults: Array<{ evalQuestionId: string; scores: unknown }>,
  ) {
    const baselineByQuestion = new Map(
      baselineResults.map((result) => [result.evalQuestionId, this.asRecord(result.scores)]),
    );
    return candidateResults
      .map((candidate) => {
        const baseline = baselineByQuestion.get(candidate.evalQuestionId);
        if (!baseline) {
          return undefined;
        }
        const candidateScores = this.asRecord(candidate.scores);
        return {
          evalQuestionId: candidate.evalQuestionId,
          deltas: this.metricDeltas(baseline, candidateScores),
        };
      })
      .filter(Boolean);
  }

  private errorSummary(error: unknown): Record<string, unknown> {
    return {
      message: error instanceof Error ? error.message : 'retrieval eval failed',
      code: this.errorCode(error),
    };
  }

  private errorCode(error: unknown): string {
    const record = this.asRecord(error);
    if (typeof record.code === 'string') {
      return record.code;
    }
    const response = this.asRecord(record.response);
    if (typeof response.code === 'string') {
      return response.code;
    }
    return 'retrieval_eval_failed';
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }
}
