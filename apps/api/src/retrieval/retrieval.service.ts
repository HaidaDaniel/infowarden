import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { AppException } from '../common/app-error';
import { ProvidersService, RerankerResolution, RerankRunResult } from '../providers/providers.service';
import { VectorIndexService } from '../vector-index/vector-index.service';
import { SearchHit, VectorPayload, VectorSearchFilters } from '../vector-index/qdrant.adapter';
import { WorkspaceVectorPlacementService } from '../workspace-vector-placement/workspace-vector-placement.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { RetrievalRankingPipeline } from './retrieval-ranking.pipeline';
import { applyTokenBudget, countTokens, groupResults } from './retrieval-context-packaging';
import { RetrievalCandidateService } from './retrieval-candidate.service';
import { RetrievalNeighborExpansionService } from './retrieval-neighbor-expansion.service';
import { RetrievalProfileResolver } from './retrieval-profile.resolver';
import {
  resolveCandidateStrategy,
  type ResolvedRetrievalProfile,
  type ResolvedServingContext,
} from './retrieval-internal.types';
import type {
  ChunkNeighborsResponse,
  ContextPackageResponse,
  DocumentContextRequest,
  DocumentContextResponse,
  MemorySearchResponse,
  RetrievalBudgetReserves,
  RetrievalTraceResponse,
  SearchRequest,
  SearchResponse,
  SearchResult,
  ServingTrace,
} from './retrieval.types';
export type {
  BudgetDiagnostics,
  ChunkNeighborsResponse,
  ContextPackageResponse,
  DocumentContextRequest,
  DocumentContextResponse,
  MemorySearchResponse,
  RetrievalBudgetReserves,
  RetrievalProfileSummary,
  RetrievalTraceResponse,
  SearchRequest,
  SearchResponse,
  SearchResult,
  ServingTrace,
} from './retrieval.types';

const DEFAULT_CONTEXT_MAX_CHARS = 4000;
const HARD_CONTEXT_MAX_CHARS = 12000;
const DEFAULT_NEIGHBOR_COUNT = 1;
const MAX_NEIGHBOR_COUNT = 5;
const DEFAULT_TOKEN_BUDGET = 1200;
const HARD_TOKEN_BUDGET = 12000;

@Injectable()
export class RetrievalService {
  private readonly rankingPipeline = new RetrievalRankingPipeline();
  private readonly profileResolver: RetrievalProfileResolver;
  private readonly candidateService: RetrievalCandidateService;
  private readonly neighborExpansionService: RetrievalNeighborExpansionService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly vectorIndexService: VectorIndexService,
    private readonly providersService: ProvidersService,
    @Optional()
    @Inject(WorkspaceVectorPlacementService)
    private readonly workspaceVectorPlacementService: Pick<
      WorkspaceVectorPlacementService,
      'resolveForKnowledgeBase'
    > = { resolveForKnowledgeBase: async () => null } as any,
    @Optional()
    @Inject(TelemetryService)
    private readonly telemetry?: Pick<TelemetryService, 'record'>,
    @Optional() profileResolver?: RetrievalProfileResolver,
    @Optional() candidateService?: RetrievalCandidateService,
    @Optional() neighborExpansionService?: RetrievalNeighborExpansionService,
  ) {
    this.profileResolver = profileResolver || new RetrievalProfileResolver(prisma);
    this.candidateService =
      candidateService || new RetrievalCandidateService(prisma, embeddingsService, vectorIndexService);
    this.neighborExpansionService = neighborExpansionService || new RetrievalNeighborExpansionService(prisma);
  }

  async search(knowledgeBaseId: string, request: SearchRequest): Promise<SearchResponse> {
    const pipeline = await this.runRetrievalPipeline(knowledgeBaseId, request);

    return {
      knowledgeBaseId: pipeline.knowledgeBase.id,
      indexVersionId: pipeline.indexVersion.id,
      retrievalProfile: this.profileResolver.toSummary(pipeline.profile),
      results: pipeline.results,
      count: pipeline.results.length,
    };
  }

  async searchCode(knowledgeBaseId: string, request: SearchRequest): Promise<SearchResponse> {
    return this.search(knowledgeBaseId, request);
  }

  async getContextPackage(knowledgeBaseId: string, request: SearchRequest): Promise<ContextPackageResponse> {
    const pipeline = await this.runRetrievalPipeline(knowledgeBaseId, request);
    const budgetPlan = this.resolveBudgetPlan(request, pipeline.profile);
    const groupedResults = groupResults(pipeline.results, pipeline.profile.grouping);
    const budgeted = applyTokenBudget(groupedResults, budgetPlan);
    const packagedGroups = budgeted.groups;
    const estimatedTokens = budgeted.diagnostics.usedTokens;

    return {
      knowledgeBaseId: pipeline.knowledgeBase.id,
      indexVersionId: pipeline.indexVersion.id,
      retrievalProfile: this.profileResolver.toSummary(pipeline.profile),
      query: request.query,
      count: packagedGroups.reduce((sum, group) => sum + group.items.length, 0),
      budget: {
        requestedTokens: request.tokenBudget,
        estimatedTokens,
      },
      groups: packagedGroups,
      diagnostics: {
        serving: this.toServingTrace(pipeline.diagnostics.serving),
        denseCandidates: pipeline.diagnostics.denseCandidates,
        lexicalCandidates: pipeline.diagnostics.lexicalCandidates,
        mergedCandidates: pipeline.diagnostics.mergedCandidates,
        reranked: pipeline.diagnostics.reranked,
        rerankerFallbackUsed: pipeline.diagnostics.rerankerFallbackUsed,
        rerankerReason: pipeline.diagnostics.rerankerReason,
        reranker: pipeline.diagnostics.reranker,
        rerankerCandidateCount: pipeline.diagnostics.rerankerCandidateCount,
        expandedNeighbors: pipeline.diagnostics.expandedNeighbors,
        neighborExpansionQueries: pipeline.diagnostics.neighborExpansionQueries,
        droppedDuplicates: pipeline.diagnostics.droppedDuplicates,
        droppedNearDuplicates: pipeline.diagnostics.droppedNearDuplicates,
        budget: budgeted.diagnostics,
      },
    };
  }

  async traceRetrieval(
    knowledgeBaseId: string,
    request: SearchRequest,
    budgetReserves?: RetrievalBudgetReserves,
  ): Promise<RetrievalTraceResponse> {
    const pipeline = await this.runRetrievalPipeline(knowledgeBaseId, request);
    const budgetPlan = this.resolveBudgetPlan(request, pipeline.profile, budgetReserves);
    const groupedResults = groupResults(pipeline.results, pipeline.profile.grouping);
    const budgeted = applyTokenBudget(groupedResults, budgetPlan);
    const packagedGroups = budgeted.groups;
    const estimatedTokens = budgeted.diagnostics.usedTokens;

    return {
      knowledgeBaseId: pipeline.knowledgeBase.id,
      indexVersionId: pipeline.indexVersion.id,
      query: request.query,
      retrievalProfile: this.profileResolver.toSummary(pipeline.profile),
      appliedFilters: request.filters,
      stages: {
        denseCandidates: pipeline.stageResults.denseCandidates,
        lexicalCandidates: pipeline.stageResults.lexicalCandidates,
        mergedCandidates: pipeline.stageResults.mergedCandidates,
        filteredCandidates: pipeline.stageResults.filteredCandidates,
        dedupedCandidates: pipeline.stageResults.dedupedCandidates,
        rerankedCandidates: pipeline.stageResults.rerankedCandidates,
        nearDedupedCandidates: pipeline.stageResults.nearDedupedCandidates,
        expandedCandidates: pipeline.stageResults.expandedCandidates,
        finalCandidates: pipeline.stageResults.finalCandidates,
      },
      contextPackage: {
        count: packagedGroups.reduce((sum, group) => sum + group.items.length, 0),
        budget: {
          requestedTokens: request.tokenBudget,
          estimatedTokens,
        },
        groups: packagedGroups,
      },
      diagnostics: {
        serving: this.toServingTrace(pipeline.diagnostics.serving),
        denseCandidates: pipeline.diagnostics.denseCandidates,
        lexicalCandidates: pipeline.diagnostics.lexicalCandidates,
        mergedCandidates: pipeline.diagnostics.mergedCandidates,
        filteredCandidates: pipeline.diagnostics.filteredCandidates,
        droppedByFilters: pipeline.diagnostics.droppedByFilters,
        droppedDuplicates: pipeline.diagnostics.droppedDuplicates,
        droppedNearDuplicates: pipeline.diagnostics.droppedNearDuplicates,
        expandedNeighbors: pipeline.diagnostics.expandedNeighbors,
        neighborExpansionQueries: pipeline.diagnostics.neighborExpansionQueries,
        finalCount: pipeline.results.length,
        reranked: pipeline.diagnostics.reranked,
        rerankerFallbackUsed: pipeline.diagnostics.rerankerFallbackUsed,
        rerankerReason: pipeline.diagnostics.rerankerReason,
        reranker: pipeline.diagnostics.reranker,
        rerankerCandidateCount: pipeline.diagnostics.rerankerCandidateCount,
        budget: budgeted.diagnostics,
      },
    };
  }

  async searchMemory(knowledgeBaseId: string, request: SearchRequest): Promise<MemorySearchResponse> {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(knowledgeBaseId);
    const profile = await this.profileResolver.resolve(
      knowledgeBase.id,
      knowledgeBase.defaultRetrievalProfile,
      request.profileKey || 'memory-recall',
    );
    const limit = this.resolveLimit(request, profile);
    const rawQuery = request.query.trim();
    const query = rawQuery.toLowerCase();

    const entries = await this.prisma.memoryEntry.findMany({
      where: {
        knowledgeBaseId: knowledgeBase.id,
        ...(rawQuery
          ? {
              OR: [
                { title: { contains: rawQuery, mode: 'insensitive' as const } },
                {
                  summary: { contains: rawQuery, mode: 'insensitive' as const },
                },
                { body: { contains: rawQuery, mode: 'insensitive' as const } },
                { tags: { has: rawQuery } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: rawQuery ? limit * 20 : limit,
    });

    const scoredResults = entries
      .filter((entry) => this.isActiveMemoryMetadata(entry.metadata))
      .map((entry) => ({
        id: entry.id,
        entryType: entry.entryType,
        title: entry.title || undefined,
        summary: entry.summary || undefined,
        body: entry.body,
        tags: entry.tags,
        authoredBy: entry.authoredBy || undefined,
        sessionId: entry.sessionId || undefined,
        occurredAt: entry.occurredAt || undefined,
        createdAt: entry.createdAt,
        metadata: (entry.metadata as Record<string, unknown>) || {},
        score: this.scoreMemoryEntry(query, entry),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      knowledgeBaseId: knowledgeBase.id,
      retrievalProfile: this.profileResolver.toSummary(profile),
      results: scoredResults,
      count: scoredResults.length,
    };
  }

  async getRecentDecisions(knowledgeBaseId: string, limit = 5) {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(knowledgeBaseId);
    const normalizedLimit = Math.min(Math.max(limit, 1), 20);
    const entries = await this.prisma.memoryEntry.findMany({
      where: {
        knowledgeBaseId: knowledgeBase.id,
        entryType: 'decision',
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: normalizedLimit * 5,
    });
    const results = entries.filter((entry) => this.isActiveMemoryMetadata(entry.metadata)).slice(0, normalizedLimit);

    return {
      knowledgeBaseId: knowledgeBase.id,
      results,
      count: results.length,
    };
  }

  async getDocumentContext(request: DocumentContextRequest): Promise<DocumentContextResponse> {
    this.validateDocumentContextRequest(request);

    const document = await this.prisma.document.findUnique({
      where: { id: request.documentId },
    });

    if (!document) {
      throw new NotFoundException(`Document with ID ${request.documentId} not found`);
    }

    const latestVersion = await this.prisma.documentVersion.findFirst({
      where: { documentId: document.id },
      orderBy: { createdAt: 'desc' },
    });

    let text = latestVersion?.normalizedText || '';
    let metadata: Record<string, unknown> = {
      ...((document.metadata as Record<string, unknown>) || {}),
      mimeType: document.mimeType || undefined,
    };

    if (request.chunkId) {
      const chunk = await this.prisma.chunk.findUnique({
        where: { id: request.chunkId },
      });

      if (!chunk) {
        throw new NotFoundException(`Chunk with ID ${request.chunkId} not found`);
      }

      if (chunk.documentId !== document.id) {
        throw new BadRequestException('chunkId does not belong to the requested document');
      }

      text = chunk.text;
      metadata.chunkId = chunk.id;
      metadata.chunkIndex = chunk.chunkIndex;
      metadata.startLine = chunk.startLine;
      metadata.endLine = chunk.endLine;
      metadata.indexVersionId = chunk.indexVersionId;
      metadata = {
        ...metadata,
        ...((chunk.metadata as Record<string, unknown>) || {}),
      };
    } else if (request.startLine !== undefined && request.endLine !== undefined) {
      text = this.extractLineRange(text, request.startLine, request.endLine);
      metadata.startLine = request.startLine;
      metadata.endLine = request.endLine;
    }

    return {
      documentId: document.id,
      path: document.path,
      text: this.clampText(text, request.maxChars),
      metadata,
    };
  }

  async getChunkNeighbors(
    chunkId: string,
    before = DEFAULT_NEIGHBOR_COUNT,
    after = DEFAULT_NEIGHBOR_COUNT,
  ): Promise<ChunkNeighborsResponse> {
    const beforeCount = this.clampNeighborCount(before);
    const afterCount = this.clampNeighborCount(after);

    const chunk = await this.prisma.chunk.findUnique({
      where: { id: chunkId },
    });

    if (!chunk) {
      throw new NotFoundException(`Chunk with ID ${chunkId} not found`);
    }

    const neighbors = await this.prisma.chunk.findMany({
      where: {
        documentId: chunk.documentId,
        indexVersionId: chunk.indexVersionId,
        chunkIndex: {
          gte: chunk.chunkIndex - beforeCount,
          lte: chunk.chunkIndex + afterCount,
        },
        id: {
          not: chunk.id,
        },
      },
      orderBy: { chunkIndex: 'asc' },
    });

    return {
      chunkId: chunk.id,
      neighbors: neighbors.map((neighbor) => ({
        chunkId: neighbor.id,
        chunkIndex: neighbor.chunkIndex,
        text: this.clampText(neighbor.text),
        startLine: neighbor.startLine ?? undefined,
        endLine: neighbor.endLine ?? undefined,
        metadata: (neighbor.metadata as Record<string, unknown>) || {},
      })),
    };
  }

  private async loadActiveIndex(
    knowledgeBase: Awaited<ReturnType<KnowledgeBasesService['resolveIdentifier']>>,
    lexicalOnly: boolean,
  ) {
    if (!knowledgeBase.activeIndexVersionId) {
      throw new BadRequestException(
        `Knowledge base "${knowledgeBase.name}" has no active index version. Build an index first.`,
      );
    }

    const indexVersion = await this.prisma.indexVersion.findUnique({
      where: { id: knowledgeBase.activeIndexVersionId },
    });

    if (!indexVersion || indexVersion.status !== 'active') {
      throw new BadRequestException('Active index version not found or not active');
    }

    if (!lexicalOnly && indexVersion.lifecycleStatus && indexVersion.lifecycleStatus !== 'loaded') {
      throw new BadRequestException(
        `Workspace "${knowledgeBase.name}" index is ${indexVersion.lifecycleStatus}; load the workspace before retrieval.`,
      );
    }

    return { knowledgeBase, indexVersion };
  }

  private async runRetrievalPipeline(knowledgeBaseId: string, request: SearchRequest) {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(knowledgeBaseId);
    const profile = await this.profileResolver.resolve(
      knowledgeBase.id,
      knowledgeBase.defaultRetrievalProfile,
      request.profileKey,
    );
    const lexicalOnly = resolveCandidateStrategy(profile.metadata) === 'lexical';
    const { indexVersion } = await this.loadActiveIndex(knowledgeBase, lexicalOnly);
    const serving = await this.resolveServingContext(knowledgeBase, indexVersion, lexicalOnly);
    const reranker = await this.providersService.resolveRerankerProvider(profile, request.rerank);
    this.assertRerankerCompatibility(profile, lexicalOnly, reranker);
    const denseHits = lexicalOnly
      ? []
      : await this.candidateService.retrieveDenseCandidates(knowledgeBase, indexVersion, request, profile, serving);
    const lexicalHits = await this.candidateService.retrieveLexicalCandidates(knowledgeBase, request, profile, serving);
    const mergedHits = this.rankingPipeline.mergeCandidates(denseHits, lexicalHits, profile);
    const filteredHits = this.applyMetadataFilters(mergedHits, request.filters);
    const dedupedHits = this.rankingPipeline.dedupeHits(filteredHits);
    const { hits: rerankedHits, run: rerankRun } = await this.rerankIfNeeded(request.query, dedupedHits, reranker);
    const nearDeduped = this.rankingPipeline.suppressNearDuplicates(rerankedHits);
    const expanded = await this.neighborExpansionService.expandIfNeeded(nearDeduped.hits, profile);
    const expandedHits = expanded.hits;
    const stageResults = {
      denseCandidates: this.toSearchResults(denseHits, indexVersion.id),
      lexicalCandidates: this.toSearchResults(lexicalHits, indexVersion.id),
      mergedCandidates: this.toSearchResults(mergedHits, indexVersion.id),
      filteredCandidates: this.toSearchResults(filteredHits, indexVersion.id),
      dedupedCandidates: this.toSearchResults(dedupedHits, indexVersion.id),
      rerankedCandidates: this.toSearchResults(rerankedHits, indexVersion.id),
      nearDedupedCandidates: this.toSearchResults(nearDeduped.hits, indexVersion.id),
      expandedCandidates: this.toSearchResults(expandedHits, indexVersion.id),
      finalCandidates: this.toSearchResults(expandedHits, indexVersion.id),
    };
    const results = stageResults.finalCandidates;
    this.telemetry?.record('info', 'retrieval.pipeline', {
      knowledgeBaseId: knowledgeBase.id,
      indexVersionId: indexVersion.id,
      servingRevisionId: serving.servingRevisionId,
      sourceRevisionCount: serving.sourceRevisionIds.length,
      vectorBackendId: serving.vectorBackendId,
      collectionName: serving.collectionName,
      profileKey: profile.key,
      denseCandidates: denseHits.length,
      lexicalCandidates: lexicalHits.length,
      finalCandidates: results.length,
      reranked: rerankRun.reranked,
      neighborExpansionQueries: expanded.queryCount,
    });

    return {
      knowledgeBase,
      indexVersion,
      profile,
      stageResults,
      results,
      diagnostics: {
        denseCandidates: denseHits.length,
        lexicalCandidates: lexicalHits.length,
        mergedCandidates: mergedHits.length,
        filteredCandidates: filteredHits.length,
        droppedByFilters: Math.max(mergedHits.length - filteredHits.length, 0),
        droppedDuplicates: filteredHits.length - dedupedHits.length,
        expandedNeighbors: Math.max(expandedHits.length - rerankedHits.length, 0),
        reranked: rerankRun.reranked,
        rerankerFallbackUsed: rerankRun.fallbackUsed,
        rerankerReason: rerankRun.reason,
        rerankerCandidateCount: rerankRun.candidateCount,
        droppedNearDuplicates: nearDeduped.dropped,
        neighborExpansionQueries: expanded.queryCount,
        reranker,
        serving,
      },
    };
  }

  private async resolveServingContext(
    knowledgeBase: { id: string; activeServingRevisionId?: string | null; name: string },
    indexVersion: { vectorCollectionName: string },
    lexicalOnly = false,
  ): Promise<ResolvedServingContext> {
    if (!knowledgeBase.activeServingRevisionId) {
      throw new AppException(
        'serving_revision_unavailable',
        'Workspace has no active serving revision',
        'resolve_serving_revision',
        false,
        {
          knowledgeBaseId: knowledgeBase.id,
        },
      );
    }
    const revision = await this.prisma.workspaceServingRevision.findUnique({
      where: { id: knowledgeBase.activeServingRevisionId },
      include: {
        manifestEntries: {
          include: { sourceRevision: { select: { id: true, status: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    const sourceRevisionIds = (revision?.manifestEntries || [])
      .filter((entry) => entry.sourceRevision.status === 'ready')
      .map((entry) => entry.sourceRevision.id);
    if (!revision || revision.status !== 'active' || sourceRevisionIds.length !== revision.manifestEntries.length) {
      throw new AppException(
        'serving_materialization_stale',
        'Active serving revision is missing, incomplete, or degraded',
        'resolve_serving_revision',
        false,
        {
          knowledgeBaseId: knowledgeBase.id,
          servingRevisionId: knowledgeBase.activeServingRevisionId,
        },
      );
    }
    if (lexicalOnly) {
      return {
        servingRevisionId: revision.id,
        sourceRevisionIds,
        vectorBackendId: 'lexical-only',
        collectionName: 'lexical-only',
        filterPlacement: 'pre_topk',
      };
    }

    const placement = await this.workspaceVectorPlacementService.resolveForKnowledgeBase(knowledgeBase.id);
    if (!placement || ['unloaded', 'failed', 'degraded'].includes(placement.state)) {
      throw new AppException(
        'serving_materialization_unavailable',
        'Workspace vector materialization is unavailable',
        'resolve_serving_placement',
        true,
        {
          knowledgeBaseId: knowledgeBase.id,
          servingRevisionId: revision.id,
        },
      );
    }
    if (placement.servingRevisionId && placement.servingRevisionId !== revision.id) {
      throw new AppException(
        'serving_materialization_stale',
        'Workspace placement does not match active serving revision',
        'resolve_serving_placement',
        true,
        {
          knowledgeBaseId: knowledgeBase.id,
          servingRevisionId: revision.id,
          placementServingRevisionId: placement.servingRevisionId,
        },
      );
    }
    return {
      servingRevisionId: revision.id,
      sourceRevisionIds,
      vectorBackendId: placement.vectorBackendId,
      collectionName: placement.physicalCollectionName || indexVersion.vectorCollectionName,
      collectionAlias: placement.collectionAlias || undefined,
      indexBuildId: placement.activeIndexBuildId || undefined,
      filterPlacement: 'pre_topk',
    };
  }

  private toServingTrace(serving: ResolvedServingContext): ServingTrace {
    return {
      servingRevisionId: serving.servingRevisionId,
      sourceRevisionIds: serving.sourceRevisionIds,
      vectorBackendId: serving.vectorBackendId,
      collectionName: serving.collectionName,
      collectionAlias: serving.collectionAlias,
      indexBuildId: serving.indexBuildId,
      filterPlacement: serving.filterPlacement,
    };
  }

  private async rerankIfNeeded(
    query: string,
    hits: SearchHit[],
    reranker: RerankerResolution,
  ): Promise<{ hits: SearchHit[]; run: RerankRunResult }> {
    const run = await this.providersService.rerankCandidates(
      query,
      hits.map((hit) => ({
        id: this.rankingPipeline.rerankKey(hit),
        text: hit.payload.text || '',
        metadata: hit.payload.metadata || {},
      })),
      reranker,
    );

    if (!run.reranked || run.scores.length === 0) {
      return { hits, run };
    }

    const scores = new Map(run.scores.map((score) => [score.id, score.score]));
    const rankedHits = hits
      .map((hit, index) => {
        const score = scores.get(this.rankingPipeline.rerankKey(hit));
        return {
          ...hit,
          score: score ?? hit.score,
          payload: {
            ...hit.payload,
            metadata: {
              ...(hit.payload.metadata || {}),
              rerankerScore: score,
              rerankerRanked: score !== undefined,
              originalRank: index + 1,
            },
          },
        };
      })
      .filter((hit) => scores.has(this.rankingPipeline.rerankKey(hit)))
      .sort((a, b) => b.score - a.score);
    const unrankedHits = hits
      .map((hit, index) => ({ hit, index }))
      .filter(({ hit }) => !scores.has(this.rankingPipeline.rerankKey(hit)))
      .map(({ hit, index }) => ({
        ...hit,
        payload: {
          ...hit.payload,
          metadata: {
            ...(hit.payload.metadata || {}),
            rerankerRanked: false,
            originalRank: index + 1,
          },
        },
      }));
    const rerankedHits = [...rankedHits, ...unrankedHits];

    return { hits: rerankedHits, run };
  }

  private assertRerankerCompatibility(
    profile: ResolvedRetrievalProfile,
    lexicalOnly: boolean,
    reranker: RerankerResolution,
  ): void {
    if (
      !lexicalOnly ||
      !reranker.requested ||
      reranker.reason === 'reranker_disabled_by_request' ||
      reranker.reason === 'reranker_disabled_by_profile'
    ) {
      return;
    }

    throw new AppException(
      'lexical_reranker_unsupported',
      'Lexical retrieval with the configured reranker is unsupported for v0.1; disable reranking or use dense/hybrid retrieval.',
      'resolve_reranker',
      false,
      { profileKey: profile.key, candidateStrategy: resolveCandidateStrategy(profile.metadata) },
    );
  }

  private resolveLimit(request: SearchRequest, profile?: ResolvedRetrievalProfile): number {
    const requested = request.topK ?? request.limit ?? profile?.denseTopK ?? 10;
    return Math.min(Math.max(requested, 1), 50);
  }

  private resolveBudgetPlan(
    request: SearchRequest,
    profile: ResolvedRetrievalProfile,
    budgetReserves?: RetrievalBudgetReserves,
  ) {
    const requested = request.tokenBudget ?? profile.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const hardBudget = Math.min(Math.max(requested, 0), HARD_TOKEN_BUDGET);
    const metadata = profile.metadata || {};
    const tokenizer = {
      id: String(metadata.tokenizerId || 'contextforge-approx-v1'),
      modelFamily: String(metadata.tokenizerModelFamily || metadata.modelFamily || 'approximate'),
      approximate: true,
    };
    let remaining = hardBudget;
    const allocate = (value: unknown, fallback: number) => {
      const allocated = Math.min(this.clampReserve(value, fallback), remaining);
      remaining -= allocated;
      return allocated;
    };
    const system = allocate(budgetReserves?.systemTokens, this.clampReserve(metadata.contextSystemReserveTokens, 0));
    const instruction = allocate(
      budgetReserves?.instructionTokens,
      this.clampReserve(metadata.contextInstructionReserveTokens, 0),
    );
    const query = allocate(countTokens(request.query, tokenizer), 0);
    const safety = allocate(budgetReserves?.safetyTokens, this.clampReserve(metadata.contextSafetyReserveTokens, 0));
    const output = allocate(budgetReserves?.outputTokens, this.clampReserve(metadata.contextOutputReserveTokens, 0));
    const reservedTokens = { system, instruction, query, output, safety };
    const totalReserved = Object.values(reservedTokens).reduce((sum, value) => sum + value, 0);
    return {
      tokenizer,
      requestedTokens: hardBudget,
      reservedTokens,
      retrievalBudgetTokens: Math.max(0, hardBudget - totalReserved),
    };
  }

  private validateDocumentContextRequest(request: DocumentContextRequest): void {
    if (
      (request.startLine !== undefined && request.endLine === undefined) ||
      (request.startLine === undefined && request.endLine !== undefined)
    ) {
      throw new BadRequestException('startLine and endLine must be provided together');
    }

    if (request.startLine !== undefined && request.endLine !== undefined && request.startLine > request.endLine) {
      throw new BadRequestException('startLine must be less than or equal to endLine');
    }
  }

  private applyMetadataFilters(hits: SearchHit[], filters?: VectorSearchFilters): SearchHit[] {
    if (!filters) {
      return hits;
    }

    return hits.filter((hit) => this.matchesMetadataFilters(hit.payload.metadata || {}, filters));
  }

  private matchesMetadataFilters(metadata: Record<string, unknown>, filters?: VectorSearchFilters): boolean {
    if (!filters) return true;
    if (filters.pathPrefix && !String(metadata.path || '').startsWith(filters.pathPrefix)) {
      return false;
    }
    if (filters.language && metadata.language !== filters.language) {
      return false;
    }
    if (filters.branch && metadata.branch !== filters.branch) {
      return false;
    }
    for (const [key, value] of Object.entries(filters.metadata || {})) {
      if (metadata[key] !== value) {
        return false;
      }
    }
    return true;
  }

  private toSearchResult(hit: SearchHit, activeIndexVersionId: string): SearchResult {
    const payload: VectorPayload = hit.payload;
    const metadata = payload.metadata || {};

    return {
      text: payload.text || '',
      score: hit.score,
      documentId: payload.documentId,
      chunkId: payload.chunkId,
      sourceId: payload.sourceId || (metadata.sourceId as string | undefined),
      path: metadata.path as string | undefined,
      mimeType: metadata.mimeType as string | undefined,
      language: metadata.language as string | undefined,
      branch: metadata.branch as string | undefined,
      commit: metadata.commit as string | undefined,
      startLine: payload.startLine,
      endLine: payload.endLine,
      tokenCount: payload.tokenCount,
      metadata: {
        ...metadata,
        indexVersionId: activeIndexVersionId,
      },
    };
  }

  private toSearchResults(hits: SearchHit[], activeIndexVersionId: string): SearchResult[] {
    return hits.map((hit) => this.toSearchResult(hit, activeIndexVersionId));
  }

  private numberValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private clampReserve(value: unknown, fallback: number): number {
    const parsed = this.numberValue(value) ?? fallback;
    return Math.min(Math.max(Math.trunc(parsed), 0), HARD_TOKEN_BUDGET);
  }

  private scoreMemoryEntry(
    query: string,
    entry: {
      title: string | null;
      summary: string | null;
      body: string;
      tags: string[];
    },
  ) {
    const haystacks = [
      { text: entry.title || '', weight: 4 },
      { text: entry.summary || '', weight: 3 },
      { text: entry.body || '', weight: 2 },
      { text: entry.tags.join(' '), weight: 1 },
    ];

    let score = 0;
    for (const haystack of haystacks) {
      if (haystack.text.toLowerCase().includes(query)) {
        score += haystack.weight;
      }
    }

    return score;
  }

  private isActiveMemoryMetadata(metadata: unknown): boolean {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return true;
    }

    const lifecycleStatus = (metadata as Record<string, unknown>).lifecycleStatus;
    return lifecycleStatus !== 'archived';
  }

  private extractLineRange(text: string, startLine: number, endLine: number): string {
    const lines = text.split('\n');
    return lines.slice(Math.max(startLine - 1, 0), Math.max(endLine, 0)).join('\n');
  }

  private clampText(text: string, maxChars = DEFAULT_CONTEXT_MAX_CHARS): string {
    const safeMaxChars = Math.min(Math.max(maxChars, 1), HARD_CONTEXT_MAX_CHARS);
    return text.length <= safeMaxChars ? text : text.slice(0, safeMaxChars);
  }

  private clampNeighborCount(value: number): number {
    return Math.min(Math.max(value || DEFAULT_NEIGHBOR_COUNT, 0), MAX_NEIGHBOR_COUNT);
  }
}
