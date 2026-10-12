import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { QdrantAdapter, VectorPayload } from '../vector-index/qdrant.adapter';
import { ValidationIssue, ValidationService } from '../validation/validation.service';
import { AppException, getErrorCode, getErrorMessage } from '../common/app-error';
import { RuntimeEmbeddingProviderConfig } from '../providers/providers.service';
import { IndexingChangePlannerService } from './indexing-change-planner.service';
import { IndexingMaterializationService } from './indexing-materialization.service';
import { IndexingSourcePreparationService } from './indexing-source-preparation.service';
import { IndexingStats, LogEntry, ParsedFileForIndex, SourceRefreshRequestContext } from './indexing.types';
import { PreparedServingBuild, WorkspaceServingRevisionsService } from './workspace-serving-revisions.service';
import {
  normalizeStorageProfile,
  qdrantOptionsForStorageProfile,
  StorageProfile,
} from '../vector-index/storage-profile';
import { WorkspaceVectorPlacementService } from '../workspace-vector-placement/workspace-vector-placement.service';
import { actualIndexingResourceSnapshot, estimateIndexingResources } from './indexing-resource-snapshot';
import { captureRollbackState, rollbackMaterializedDocuments, RollbackDocumentState } from './indexing-rollback';
import { EmbeddingMaterializationBuffer, resolveEmbeddingBatchSize } from './embedding-materialization-buffer';
type IndexingRunState = { stats: IndexingStats; logs: LogEntry[] };
@Injectable()
export class LocalFolderIndexer {
  private lastResult: IndexingRunState = { stats: this.emptyStats(), logs: [] };
  private readonly resultsByJobId = new Map<string, IndexingRunState>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly sourcePreparation: IndexingSourcePreparationService,
    private readonly changePlanner: IndexingChangePlannerService,
    private readonly materializationService: IndexingMaterializationService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly qdrantAdapter: QdrantAdapter,
    private readonly validationService: ValidationService,
    private readonly servingRevisionsService: WorkspaceServingRevisionsService,
    private readonly workspaceVectorPlacementService: WorkspaceVectorPlacementService,
  ) {}
  getStats(jobId?: string): IndexingStats {
    return { ...((jobId ? this.resultsByJobId.get(jobId)?.stats : this.lastResult.stats) || this.emptyStats()) };
  }
  getLogs(jobId?: string): LogEntry[] {
    const logs = [...((jobId ? this.resultsByJobId.get(jobId)?.logs : this.lastResult.logs) || [])];
    if (jobId) this.resultsByJobId.delete(jobId);
    return logs;
  }
  async run(jobId: string, refresh?: SourceRefreshRequestContext): Promise<void> {
    const state: IndexingRunState = { stats: this.emptyStats(), logs: [] };
    const refreshContext = refresh || { mode: 'incremental', trigger: 'legacy_job' as const };
    const forceReembed = ['force_reembed', 'force_rechunk', 'rebuild_collection'].includes(refreshContext.mode);
    state.stats.refreshMode = refreshContext.mode;
    state.stats.refreshReason = refreshContext.reason;
    state.stats.refreshTrigger = refreshContext.trigger;
    state.stats.refreshTriggerMetadata = refreshContext.triggerMetadata;
    this.log(state, 'info', 'Starting source indexing job', {
      refreshMode: refreshContext.mode,
      refreshReason: refreshContext.reason,
      refreshTrigger: refreshContext.trigger,
      triggerMetadata: refreshContext.triggerMetadata,
    });
    let indexVersionId: string | undefined;
    let knowledgeBaseId: string | undefined;
    let collectionName: string | undefined;
    let embeddingProvider: RuntimeEmbeddingProviderConfig | undefined;
    let storageProfile: StorageProfile = 'balanced';
    let servingBuild: PreparedServingBuild | undefined;
    let vectorBackendId: string | undefined;
    const rollbackStates = new Map<string, RollbackDocumentState>();

    try {
      const job = await this.prisma.indexingJob.findUnique({
        where: { id: jobId },
        include: { source: true, knowledgeBase: true },
      });

      if (!job || !job.source) {
        throw new Error('Job or source not found');
      }

      const source = job.source;
      const knowledgeBase = job.knowledgeBase;
      knowledgeBaseId = knowledgeBase.id;
      const placement = await this.workspaceVectorPlacementService.resolveForKnowledgeBase(knowledgeBase.id);
      vectorBackendId = placement.vectorBackendId;
      const previousIndexVersion = knowledgeBase.activeIndexVersionId
        ? await this.prisma.indexVersion.findUnique({
            where: { id: knowledgeBase.activeIndexVersionId },
          })
        : null;
      collectionName =
        placement.physicalCollectionName ||
        previousIndexVersion?.vectorCollectionName ||
        this.collectionNameFor(knowledgeBase.id);
      storageProfile = this.resolveStorageProfile(refreshContext, previousIndexVersion?.storageProfile);

      embeddingProvider = await this.embeddingsService.resolveProvider({
        knowledgeBase,
        indexVersion: previousIndexVersion || undefined,
        purpose: 'indexing',
      });
      this.assertReindexPolicy(embeddingProvider, refreshContext.mode);
      await this.embeddingsService.assertReady(embeddingProvider);

      const preparedSource = await this.sourcePreparation.prepare(source);
      this.log(state, 'info', `Scanning source: ${preparedSource.scanRoot}`);
      if (preparedSource.gitMetadata) {
        this.log(state, 'info', 'Prepared git working tree', preparedSource.gitMetadata);
      }
      if (preparedSource.uploadMetadata) {
        this.log(state, 'info', 'Prepared managed upload source', preparedSource.uploadMetadata);
      }
      if (preparedSource.urlMetadata) {
        this.log(state, 'info', 'Prepared URL crawl source', preparedSource.urlMetadata);
      }
      if (preparedSource.obsidianMetadata) {
        this.log(state, 'info', 'Prepared Obsidian vault source', preparedSource.obsidianMetadata);
      }

      state.stats.filesScanned = preparedSource.files.length;

      const existingDocs = await this.prisma.document.findMany({
        where: { sourceId: source.id },
      });
      const planning = this.changePlanner.buildPlan({
        sourceId: source.id,
        workspaceKind: knowledgeBase.workspaceKind,
        files: preparedSource.files,
        existingDocuments: existingDocs,
      });

      this.applyPlannerStats(state, planning.stats);
      this.logDependencyHints(state, planning.plan.dependencyHints);
      this.logSkippedFiles(state, preparedSource.files);
      this.logParseFailures(state, planning.validationIssues);

      const {
        sourceSnapshot,
        datasetVersion,
        indexVersion,
        servingBuild: preparedServingBuild,
      } = await this.materializationService.createBuildArtifacts({
        source,
        knowledgeBase,
        scanRoot: preparedSource.scanRoot,
        fileCount: preparedSource.files.length,
        contentBytes: preparedSource.files.reduce((sum, file) => sum + file.size, 0),
        parsedFiles: planning.plan.parsedFiles,
        ignoredFiles: state.stats.filesIgnored,
        parseFailures: state.stats.parseFailures,
        gitMetadata: preparedSource.gitMetadata,
        uploadMetadata: preparedSource.uploadMetadata,
        urlMetadata: preparedSource.urlMetadata,
        obsidianMetadata: preparedSource.obsidianMetadata,
        embeddingModel: embeddingProvider.model,
        embeddingDimension: embeddingProvider.dimension,
        embeddingProviderConfig: this.toEmbeddingProviderSnapshot(embeddingProvider),
        collectionName,
        storageProfile,
        resourceEstimate: estimateIndexingResources({
          files: planning.plan.parsedFiles.length,
          embeddingDimension: embeddingProvider.dimension,
          storageProfile,
        }),
      });
      indexVersionId = indexVersion.id;
      servingBuild = preparedServingBuild;
      state.stats.sourceRevisionId = servingBuild?.sourceRevisionId;
      state.stats.servingRevisionId = servingBuild?.workspaceServingRevisionId;
      state.stats.indexBuildId = servingBuild?.indexBuildId;

      if (!(await this.qdrantAdapter.collectionExists(collectionName, vectorBackendId))) {
        await this.qdrantAdapter.createCollection(
          collectionName,
          embeddingProvider.dimension,
          'Cosine',
          qdrantOptionsForStorageProfile(storageProfile),
          vectorBackendId,
        );
      }
      const embeddingBatchSize = resolveEmbeddingBatchSize();
      if (!embeddingProvider || !collectionName) {
        throw new Error('Embedding provider and collection must be resolved before materialization');
      }
      const embeddingBuffer = new EmbeddingMaterializationBuffer({
        collectionName,
        vectorBackendId,
        embeddingProvider,
        embeddingsService: this.embeddingsService,
        qdrantAdapter: this.qdrantAdapter,
        batchSize: embeddingBatchSize,
        onVectorsUpserted: (count) => {
          state.stats.vectorsUpserted += count;
        },
      });

      for (const deletedDocument of planning.plan.deletedDocuments) {
        this.log(state, 'info', `Deleted file: ${deletedDocument.path}`);
        const rollbackState = await captureRollbackState(this.prisma, deletedDocument.document.id);
        rollbackStates.set(deletedDocument.document.id, rollbackState);
        const removedChunkIds = await this.materializationService.markDocumentDeleted(deletedDocument.document.id);
        if (removedChunkIds.length > 0) {
          await this.qdrantAdapter.deleteByChunkIds(collectionName, removedChunkIds);
          rollbackState.qdrantMutated = true;
          state.stats.vectorsDeleted += removedChunkIds.length;
          state.stats.chunksDeleted += removedChunkIds.length;
        }
      }

      for (const item of planning.plan.parsedFiles) {
        const rollbackState = await captureRollbackState(this.prisma, item.documentId);
        rollbackStates.set(item.documentId, rollbackState);
        const result = await this.materializationService.materializeDocument({
          sourceId: source.id,
          sourceSnapshotId: sourceSnapshot.id,
          indexVersionId: indexVersion.id,
          sourceRevisionId: servingBuild.sourceRevisionId,
          workspaceServingRevisionId: servingBuild.workspaceServingRevisionId,
          indexBuildId: servingBuild.indexBuildId,
          vectorBackendId,
          item,
          sourceRuntimeMetadata:
            preparedSource.urlMetadata ||
            preparedSource.uploadMetadata ||
            preparedSource.gitMetadata ||
            preparedSource.obsidianMetadata,
          forceReembed,
        });

        state.stats.chunksCreated += result.chunkCount;
        state.stats.chunksDeleted += result.removedChunkIds.length;
        state.stats.chunksReused += result.payloadOnlyUpdates.length;

        if (result.removedChunkIds.length > 0) {
          await this.qdrantAdapter.deleteByChunkIds(collectionName, result.removedChunkIds);
          rollbackState.qdrantMutated = true;
          state.stats.vectorsDeleted += result.removedChunkIds.length;
        }

        if (result.vectorsToUpsert.length > 0) {
          await embeddingBuffer.add(
            result.vectorsToUpsert.map((entry) => ({
              text: entry.text,
              payload: entry.payload as VectorPayload,
              rollbackState,
            })),
          );
        }

        if (result.payloadOnlyUpdates.length > 0) {
          await this.qdrantAdapter.setPayloads(
            collectionName,
            result.payloadOnlyUpdates.map((entry) => ({
              chunkId: entry.chunkId,
              payload: entry.payload,
            })),
            vectorBackendId,
          );
          rollbackState.qdrantMutated = true;
          state.stats.payloadsUpdated += result.payloadOnlyUpdates.length;
        }

        this.logChunkActivity(state, item, result);
      }
      await embeddingBuffer.flushAll();

      if (servingBuild && state.stats.vectorsUpserted > 0) {
        const materializedVectorCount = await this.qdrantAdapter.countBySourceRevisionId(
          collectionName,
          servingBuild.sourceRevisionId,
          vectorBackendId,
        );
        if (materializedVectorCount < state.stats.vectorsUpserted) {
          throw new AppException(
            'vector_probe_validation_failed',
            'Source revision vector probe did not find every materialized vector',
            'source_revision_vector_probe',
            true,
            {
              sourceRevisionId: servingBuild.sourceRevisionId,
              expectedVectors: state.stats.vectorsUpserted,
              materializedVectorCount,
            },
          );
        }
      }

      const report = await this.validationService.createReport(
        knowledgeBase.id,
        indexVersion.id,
        state.stats as unknown as Record<string, number>,
        planning.validationIssues,
      );
      state.stats.validationReportId = report.id;

      await this.prisma.sourceSnapshot.update({
        where: { id: sourceSnapshot.id },
        data: {
          metadata: {
            ...((sourceSnapshot.metadata as Record<string, unknown>) || {}),
            dependencyHints: planning.plan.dependencyHints,
          },
        },
      });
      await this.prisma.datasetVersion.update({
        where: { id: datasetVersion.id },
        data: { status: 'ready' },
      });
      const resourceActual = actualIndexingResourceSnapshot({
        storageProfile,
        embeddingDimension: embeddingProvider.dimension,
        chunks: state.stats.chunksCreated + state.stats.chunksReused,
        vectorsUpserted: state.stats.vectorsUpserted,
      });
      const resourceAllocated = {
        kind: 'allocated',
        vectorBackendId,
        collectionName,
        storageProfile,
        allocatedAt: new Date().toISOString(),
      };
      const resourceObserved = {
        kind: 'observed',
        vectorBackendId,
        collectionName,
        ...resourceActual,
        measuredAt: new Date().toISOString(),
      };
      await this.prisma.indexVersion.update({
        where: { id: indexVersion.id },
        data: {
          status: 'active',
          lifecycleStatus: 'loaded',
          resourceAllocated: resourceAllocated as any,
          resourceObserved: resourceObserved as any,
          resourceActual: resourceObserved as any,
        },
      });
      if (servingBuild) {
        const activation = await this.servingRevisionsService.finalizeBuild({
          ...servingBuild,
          knowledgeBaseId: knowledgeBase.id,
          physicalCollectionName: collectionName,
          validationSummary: {
            validationReportId: report.id,
            status: report.status,
            issueCount: Array.isArray(report.issues) ? report.issues.length : undefined,
          },
          resourceObserved: resourceActual,
        });
        state.stats.servingRevisionState = activation.state;
        this.log(
          state,
          activation.activated ? 'info' : 'warn',
          activation.activated
            ? 'Activated complete workspace serving revision'
            : 'Workspace serving revision requires reconciliation',
          {
            servingRevisionId: servingBuild.workspaceServingRevisionId,
            manifestHash: servingBuild.manifestHash,
            missingSourceIds: activation.missingSourceIds,
            unexpectedSourceIds: activation.unexpectedSourceIds,
          },
        );
        if (activation.activated) {
          await this.cleanupSupersededRevisions({
            state,
            collectionName,
            vectorBackendId,
            sourceRevisionIds: activation.supersededSourceRevisionIds || [],
            indexBuildId: servingBuild.indexBuildId,
          });
        }
      }

      this.log(state, 'info', 'Indexing completed successfully', { stats: state.stats });
      this.recordResult(jobId, state);
    } catch (error) {
      this.log(state, 'error', `Indexing failed: ${getErrorMessage(error)}`, {
        code: getErrorCode(error) || 'indexing_failed',
        stage: (error as any)?.stage || (error as any)?.response?.stage || 'local_folder_indexer',
      });
      if (collectionName && rollbackStates.size > 0) {
        if (servingBuild) {
          await this.qdrantAdapter
            .deleteBySourceRevisionId(collectionName, servingBuild.sourceRevisionId, vectorBackendId)
            .catch((rollbackError) => {
              this.log(state, 'error', `Candidate vector cleanup failed: ${getErrorMessage(rollbackError)}`, {
                code: getErrorCode(rollbackError) || 'candidate_vector_cleanup_failed',
                sourceRevisionId: servingBuild?.sourceRevisionId,
              });
            });
        }
        await rollbackMaterializedDocuments({
          prisma: this.prisma,
          states: [...rollbackStates.values()],
          log: (level, message, data) => this.log(state, level, message, data),
        });
      }
      if (indexVersionId) {
        await this.prisma.indexVersion.update({
          where: { id: indexVersionId },
          data: { status: 'failed' },
        });
      }
      if (servingBuild && knowledgeBaseId) {
        await this.servingRevisionsService
          .failBuild({
            ...servingBuild,
            knowledgeBaseId,
            reason: getErrorMessage(error),
          })
          .catch((servingStateError) => {
            this.log(
              state,
              'error',
              `Serving build failure state update failed: ${getErrorMessage(servingStateError)}`,
              {
                code: getErrorCode(servingStateError) || 'serving_build_failure_update_failed',
                servingRevisionId: servingBuild?.workspaceServingRevisionId,
              },
            );
          });
      }
      this.recordResult(jobId, state);
      throw error;
    }
  }

  private async cleanupSupersededRevisions(params: {
    state: IndexingRunState;
    collectionName: string;
    vectorBackendId?: string;
    sourceRevisionIds: string[];
    indexBuildId: string;
  }): Promise<void> {
    for (const sourceRevisionId of params.sourceRevisionIds) {
      try {
        await this.qdrantAdapter.deleteBySourceRevisionId(
          params.collectionName,
          sourceRevisionId,
          params.vectorBackendId,
        );
      } catch (error) {
        this.log(params.state, 'warn', 'Superseded source revision cleanup failed; activation remains valid', {
          code: getErrorCode(error) || 'source_revision_cleanup_failed',
          sourceRevisionId,
        });
        const build = await this.prisma.indexBuild
          .findUnique({
            where: { id: params.indexBuildId },
            select: { validationSummary: true },
          })
          .catch(() => null);
        await this.prisma.indexBuild
          .update({
            where: { id: params.indexBuildId },
            data: {
              validationSummary: {
                ...((build?.validationSummary as Record<string, unknown>) || {}),
                cleanup: {
                  status: 'failed',
                  sourceRevisionId,
                  error: getErrorMessage(error),
                },
              },
            },
          })
          .catch(() => undefined);
      }
    }
  }

  private applyPlannerStats(
    state: IndexingRunState,
    plannerStats: {
      filesParsed: number;
      filesIgnored: number;
      parseFailures: number;
      added: number;
      changed: number;
      unchanged: number;
      deleted: number;
      documentsDeleted: number;
      documentsSkipped: number;
      dependencyCandidates: number;
    },
  ): void {
    state.stats.filesParsed = plannerStats.filesParsed;
    state.stats.filesIgnored = plannerStats.filesIgnored;
    state.stats.parseFailures = plannerStats.parseFailures;
    state.stats.added = plannerStats.added;
    state.stats.changed = plannerStats.changed;
    state.stats.unchanged = plannerStats.unchanged;
    state.stats.deleted = plannerStats.deleted;
    state.stats.documentsDeleted = plannerStats.documentsDeleted;
    state.stats.documentsSkipped = plannerStats.documentsSkipped;
    state.stats.dependencyCandidates = plannerStats.dependencyCandidates;
    state.stats.documentsCreated = plannerStats.added;
    state.stats.documentsChanged = plannerStats.changed;
  }

  private resolveStorageProfile(
    refreshContext: SourceRefreshRequestContext,
    previousProfile?: string | null,
  ): StorageProfile {
    const metadata = (refreshContext.triggerMetadata || {}) as Record<string, unknown>;
    return normalizeStorageProfile(
      String(metadata.storageProfile || process.env.QDRANT_STORAGE_PROFILE || previousProfile || 'balanced'),
    );
  }

  private logSkippedFiles(
    state: IndexingRunState,
    files: Array<{ relativePath: string; skipReason?: string; metadata?: Record<string, unknown> }>,
  ): void {
    for (const file of files) {
      if (!file.skipReason) {
        continue;
      }

      this.log(state, 'info', `Skipping file: ${file.relativePath}`, {
        code: (file.metadata?.code as string) || 'file_skipped',
        reason: file.skipReason,
      });
    }
  }

  private logParseFailures(state: IndexingRunState, validationIssues: ValidationIssue[]): void {
    for (const issue of validationIssues) {
      if (issue.code !== 'parse_failed') {
        continue;
      }

      this.log(state, 'warn', `Could not parse file: ${String(issue.metadata?.path || 'unknown')}`);
    }
  }

  private logDependencyHints(
    state: IndexingRunState,
    dependencyHints: Array<{ path: string; dependsOn: string[] }>,
  ): void {
    for (const hint of dependencyHints) {
      this.log(state, 'info', `Dependency-aware invalidation candidate: ${hint.path}`, {
        dependsOn: hint.dependsOn,
      });
    }
  }

  private logChunkActivity(
    state: IndexingRunState,
    item: ParsedFileForIndex,
    result: {
      vectorsToUpsert: Array<unknown>;
      payloadOnlyUpdates: Array<unknown>;
      removedChunkIds: string[];
    },
  ): void {
    this.log(state, 'info', `Materialized file: ${item.file.relativePath}`, {
      changeType: item.changeType,
      embeddedChunks: result.vectorsToUpsert.length,
      reusedChunks: result.payloadOnlyUpdates.length,
      removedChunks: result.removedChunkIds.length,
    });
  }

  private collectionNameFor(knowledgeBaseId: string): string {
    return `kb-${knowledgeBaseId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  private assertReindexPolicy(
    embeddingProvider: RuntimeEmbeddingProviderConfig,
    refreshMode: SourceRefreshRequestContext['mode'],
  ): void {
    if (
      !embeddingProvider.reindexRequired ||
      refreshMode === 'force_reembed' ||
      refreshMode === 'force_rechunk' ||
      refreshMode === 'rebuild_collection'
    ) {
      return;
    }

    throw new AppException(
      'embedding_reindex_required',
      embeddingProvider.reindexReason ||
        'Embedding provider changed; run force_reembed or rebuild_collection before indexing',
      'resolve_embedding_provider',
      false,
      {
        providerSource: embeddingProvider.source,
        providerConfigId: embeddingProvider.providerConfigId,
        model: embeddingProvider.model,
        dimension: embeddingProvider.dimension,
        requiredModes: ['force_reembed', 'force_rechunk', 'rebuild_collection'],
      },
    );
  }

  private toEmbeddingProviderSnapshot(embeddingProvider: RuntimeEmbeddingProviderConfig): Record<string, unknown> {
    return {
      source: embeddingProvider.source,
      providerConfigId: embeddingProvider.providerConfigId,
      name: embeddingProvider.name,
      baseUrl: embeddingProvider.baseUrl,
      model: embeddingProvider.model,
      dimension: embeddingProvider.dimension,
      apiKeyRef: embeddingProvider.apiKeyRef,
      protocol: embeddingProvider.protocol,
    };
  }

  private emptyStats(): IndexingStats {
    return {
      filesScanned: 0,
      filesParsed: 0,
      filesIgnored: 0,
      parseFailures: 0,
      documentsCreated: 0,
      documentsChanged: 0,
      documentsDeleted: 0,
      documentsSkipped: 0,
      chunksCreated: 0,
      chunksDeleted: 0,
      chunksReused: 0,
      vectorsUpserted: 0,
      vectorsDeleted: 0,
      payloadsUpdated: 0,
      dependencyCandidates: 0,
      added: 0,
      changed: 0,
      deleted: 0,
      unchanged: 0,
    };
  }

  private recordResult(jobId: string, state: IndexingRunState): void {
    const result: IndexingRunState = { stats: { ...state.stats }, logs: [...state.logs] };
    this.resultsByJobId.set(jobId, result);
    this.lastResult = result;
  }

  private log(
    state: IndexingRunState,
    level: 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>,
  ): void {
    state.logs.push({ level, message, at: new Date().toISOString(), data });
  }
}
