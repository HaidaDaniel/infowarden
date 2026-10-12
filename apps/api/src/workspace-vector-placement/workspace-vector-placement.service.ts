import { forwardRef, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  IndexBuildStatus,
  Prisma,
  VectorBackend,
  VectorMaterializationStrategy,
  WorkspaceVectorPlacementMode,
  WorkspaceVectorPlacementState,
} from '@prisma/client';
import { AppException, sanitizeErrorDetails } from '../common/app-error';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { PrismaService } from '../prisma/prisma.service';
import { VectorBackendsService } from '../vector-backends/vector-backends.service';
import { QdrantAdapter } from '../vector-index/qdrant.adapter';
import { normalizeStorageProfile, qdrantOptionsForStorageProfile } from '../vector-index/storage-profile';
import { VectorBackendSelector } from './vector-backend-selector.service';
import {
  candidateCollectionName,
  numberValue,
  offsetValue,
  placementState,
  record,
  stringValue,
  toVectorPayload,
  operationKey,
} from './vector-placement.utils';
import { VectorMaterializationValidator } from './vector-materialization-validator.service';

const VECTOR_OPERATION_BATCH_SIZE = 64;

type BuildFailureOptions = {
  finalizeFailures?: boolean;
};

@Injectable()
export class WorkspaceVectorPlacementService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => KnowledgeBasesService))
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly vectorBackendsService: VectorBackendsService,
    private readonly qdrantAdapter: QdrantAdapter,
    private readonly embeddingsService: EmbeddingsService,
    private readonly vectorBackendSelector: VectorBackendSelector,
    private readonly materializationValidator: VectorMaterializationValidator,
  ) {}

  async onModuleInit() {
    await this.backfillCompatibilityPlacements();
  }

  async resolve(identifier: string) {
    const workspace = await this.knowledgeBasesService.resolveIdentifier(identifier);
    return this.resolveForKnowledgeBase(workspace.id);
  }

  async resolveForKnowledgeBase(knowledgeBaseId: string) {
    const existing = await this.prisma.workspaceVectorPlacement.findUnique({
      where: { knowledgeBaseId },
      include: { vectorBackend: true },
    });
    if (existing) return existing;

    const workspace = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      include: { activeServingRevision: true },
    });
    if (!workspace) {
      throw new AppException('workspace_not_found', 'Workspace was not found', 'workspace_vector_placement', false, {
        knowledgeBaseId,
      });
    }
    const selected = await this.vectorBackendSelector.selectCapacityAssistedBackend(knowledgeBaseId);
    return this.createPlacement(workspace, selected.backend, 'capacity_assisted', selected.snapshot);
  }

  async pin(identifier: string, vectorBackendId: string) {
    const workspace = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const target = await this.vectorBackendSelector.requireEligibleBackend(vectorBackendId, workspace.id);
    const existing = await this.prisma.workspaceVectorPlacement.findUnique({
      where: { knowledgeBaseId: workspace.id },
    });
    if (existing && existing.vectorBackendId !== vectorBackendId && existing.state !== 'unloaded') {
      throw new AppException(
        'workspace_vector_backend_move_requires_migration',
        'Moving a loaded workspace requires the durable migration flow',
        'workspace_vector_placement_pin',
        false,
        {
          knowledgeBaseId: workspace.id,
          fromBackendId: existing.vectorBackendId,
          toBackendId: vectorBackendId,
        },
      );
    }
    if (existing) {
      return this.prisma.workspaceVectorPlacement.update({
        where: { id: existing.id },
        data: {
          vectorBackendId,
          mode: WorkspaceVectorPlacementMode.pinned,
          reasonSnapshot: { reason: 'operator_pin', vectorBackendId },
          capacitySnapshot: target.snapshot as Prisma.InputJsonValue,
        },
        include: { vectorBackend: true },
      });
    }
    return this.createPlacement(workspace, target.backend, 'pinned', target.snapshot);
  }

  async unpin(identifier: string) {
    const workspace = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const placement = await this.prisma.workspaceVectorPlacement.findUnique({
      where: { knowledgeBaseId: workspace.id },
    });
    if (!placement) return this.resolveForKnowledgeBase(workspace.id);
    return this.prisma.workspaceVectorPlacement.update({
      where: { id: placement.id },
      data: {
        mode: WorkspaceVectorPlacementMode.capacity_assisted,
        reasonSnapshot: {
          reason: 'operator_unpin',
          retainedBackendId: placement.vectorBackendId,
        },
      },
      include: { vectorBackend: true },
    });
  }

  async activateMaterialization(input: {
    knowledgeBaseId: string;
    servingRevisionId: string;
    indexBuildId: string;
    physicalCollectionName: string;
  }) {
    return this.prisma.workspaceVectorPlacement.update({
      where: { knowledgeBaseId: input.knowledgeBaseId },
      data: {
        servingRevisionId: input.servingRevisionId,
        activeIndexBuildId: input.indexBuildId,
        physicalCollectionName: input.physicalCollectionName,
        state: WorkspaceVectorPlacementState.loaded,
      },
      include: { vectorBackend: true },
    });
  }

  async createMaterializationOperation(input: {
    identifier: string;
    kind: 'full_rebuild' | 'backend_move';
    targetVectorBackendId?: string;
    idempotencyKey?: string;
    rollbackRetentionHours?: number;
    strategy?: 'compatible_copy' | 'canonical_reembed';
  }) {
    const workspace = await this.knowledgeBasesService.resolveIdentifier(input.identifier);
    const placement = await this.resolveForKnowledgeBase(workspace.id);
    const targetVectorBackendId = input.targetVectorBackendId || placement.vectorBackendId;
    if (input.kind === 'backend_move' && targetVectorBackendId === placement.vectorBackendId) {
      throw new AppException(
        'vector_backend_move_target_required',
        'Backend move target must differ from active placement',
        'create_vector_operation',
        false,
      );
    }
    await this.vectorBackendSelector.requireEligibleBackend(targetVectorBackendId, workspace.id);
    const idempotencyKey = input.idempotencyKey || operationKey(input.kind, placement, targetVectorBackendId);
    const targetCollectionName = candidateCollectionName(placement.collectionAlias, idempotencyKey);
    const strategy =
      input.strategy ||
      (input.kind === 'backend_move' && placement.physicalCollectionName ? 'compatible_copy' : 'canonical_reembed');
    const existing = await this.prisma.vectorMaterializationOperation.findUnique({
      where: { knowledgeBaseId_idempotencyKey: { knowledgeBaseId: workspace.id, idempotencyKey } },
    });
    if (existing) return existing;
    return this.prisma.vectorMaterializationOperation.create({
      data: {
        knowledgeBaseId: workspace.id,
        kind: input.kind,
        strategy,
        idempotencyKey,
        sourceVectorBackendId: placement.vectorBackendId,
        targetVectorBackendId,
        sourceCollectionName: placement.physicalCollectionName,
        targetCollectionName,
        servingRevisionId: placement.servingRevisionId,
        sourceIndexBuildId: placement.activeIndexBuildId,
        rollbackUntil: new Date(Date.now() + (input.rollbackRetentionHours || 24) * 60 * 60 * 1000),
      },
    });
  }

  async markOperationValidated(operationId: string, validationSummary: Record<string, unknown>) {
    return this.prisma.vectorMaterializationOperation.update({
      where: { id: operationId },
      data: { state: 'ready_for_cutover', validationSummary: validationSummary as Prisma.InputJsonValue },
    });
  }

  async getMaterializationOperation(operationId: string) {
    const operation = await this.prisma.vectorMaterializationOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation) {
      throw new AppException(
        'vector_operation_not_found',
        'Vector materialization operation was not found',
        'get_vector_operation',
        false,
        { operationId },
      );
    }
    return operation;
  }

  async executeOperationBuild(
    operationId: string,
    requestedStrategy?: VectorMaterializationStrategy,
    options: BuildFailureOptions = {},
  ) {
    const operation = await this.prisma.vectorMaterializationOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation)
      throw new AppException(
        'vector_operation_not_found',
        'Vector materialization operation was not found',
        'build_vector_operation',
        false,
      );
    if (operation.state === 'ready_for_cutover' || operation.state === 'cutover_complete') return operation;
    const strategy = requestedStrategy || operation.strategy;
    await this.assertOperationStillFresh(operation);
    await this.prisma.vectorMaterializationOperation.update({
      where: { id: operation.id },
      data: {
        state: 'building',
        strategy,
        attemptCount: { increment: 1 },
        progressCheckpoint: {
          ...record(operation.progressCheckpoint),
          strategy,
          startedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    try {
      if (strategy === 'compatible_copy') {
        return this.executeCompatibleCopy(operation.id, options);
      }
      return this.executeCanonicalReembed(operation.id);
    } catch (error) {
      await this.failOperation(operation.id, error, options);
      throw error;
    }
  }

  async executeCompatibleCopy(operationId: string, options: BuildFailureOptions = {}) {
    const operation = await this.prisma.vectorMaterializationOperation.findUnique({ where: { id: operationId } });
    if (!operation)
      throw new AppException(
        'vector_operation_not_found',
        'Vector materialization operation was not found',
        'build_vector_operation',
        false,
      );
    if (operation.state === 'ready_for_cutover' || operation.state === 'cutover_complete') return operation;
    if (!operation.sourceCollectionName)
      throw new AppException(
        'vector_operation_source_missing',
        'Source collection is required for compatible transfer',
        'build_vector_operation',
        false,
      );
    const index = await this.prisma.indexVersion.findFirst({
      where: { knowledgeBaseId: operation.knowledgeBaseId, status: 'active' },
    });
    if (!index)
      throw new AppException(
        'vector_operation_index_missing',
        'Active index is required for compatible transfer',
        'build_vector_operation',
        false,
      );
    try {
      if (
        !(await this.qdrantAdapter.collectionExists(operation.targetCollectionName, operation.targetVectorBackendId))
      ) {
        await this.qdrantAdapter.createCollection(
          operation.targetCollectionName,
          index.embeddingDimension,
          'Cosine',
          qdrantOptionsForStorageProfile(normalizeStorageProfile(index.storageProfile)),
          operation.targetVectorBackendId,
        );
      }
      const checkpoint = record(operation.progressCheckpoint);
      const copied = await this.qdrantAdapter.copyCollectionPoints({
        sourceCollectionName: operation.sourceCollectionName,
        targetCollectionName: operation.targetCollectionName,
        sourceVectorBackendId: operation.sourceVectorBackendId || undefined,
        targetVectorBackendId: operation.targetVectorBackendId,
        startOffset: offsetValue(checkpoint.compatibleCopyOffset),
        batchSize: 256,
        onBatch: async (progress) => {
          await this.updateOperationProgress(operation.id, {
            phase: 'compatible_copy',
            copiedPoints: progress.copied,
            compatibleCopyOffset: progress.nextOffset,
            updatedAt: new Date().toISOString(),
          });
        },
      });
      await this.prisma.vectorMaterializationOperation.update({
        where: { id: operation.id },
        data: { state: 'validating' },
      });
      const [sourceCount, targetCount] = await Promise.all([
        this.qdrantAdapter.countCollection(
          operation.sourceCollectionName,
          operation.sourceVectorBackendId || undefined,
        ),
        this.qdrantAdapter.countCollection(operation.targetCollectionName, operation.targetVectorBackendId),
      ]);
      if (sourceCount !== targetCount)
        throw new AppException(
          'vector_operation_validation_failed',
          'Candidate point count differs from source',
          'build_vector_operation',
          true,
          { sourceCount, targetCount },
        );
      const manifest = operation.servingRevisionId
        ? await this.prisma.workspaceServingRevision.findUnique({
            where: { id: operation.servingRevisionId },
            include: { manifestEntries: { select: { sourceRevisionId: true } } },
          })
        : null;
      if (!manifest || manifest.manifestEntries.length === 0) {
        throw new AppException(
          'vector_operation_manifest_missing',
          'Complete active serving manifest is required for a full candidate',
          'build_vector_operation',
          false,
        );
      }
      const revisionCoverage = await Promise.all(
        manifest.manifestEntries.map(async (entry) => {
          const [sourcePoints, targetPoints] = await Promise.all([
            this.qdrantAdapter.countBySourceRevisionId(
              operation.sourceCollectionName!,
              entry.sourceRevisionId,
              operation.sourceVectorBackendId || undefined,
            ),
            this.qdrantAdapter.countBySourceRevisionId(
              operation.targetCollectionName,
              entry.sourceRevisionId,
              operation.targetVectorBackendId,
            ),
          ]);
          return { sourceRevisionId: entry.sourceRevisionId, sourcePoints, targetPoints };
        }),
      );
      if (revisionCoverage.some((item) => item.sourcePoints !== item.targetPoints || item.targetPoints === 0)) {
        throw new AppException(
          'vector_operation_manifest_coverage_failed',
          'Candidate does not cover every active source revision',
          'build_vector_operation',
          true,
          { revisionCoverage },
        );
      }
      const semanticProbes = await this.materializationValidator.candidateSemanticProbeSummary({
        knowledgeBaseId: operation.knowledgeBaseId,
        servingRevisionId: operation.servingRevisionId,
        collectionName: operation.targetCollectionName,
        vectorBackendId: operation.targetVectorBackendId,
        indexVersion: index,
      });
      return this.markOperationValidated(operation.id, {
        transfer: 'compatible_copy',
        copied,
        sourceCount,
        targetCount,
        revisionCoverage,
        semanticProbes,
        evalSample: semanticProbes,
        validatedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.failOperation(operation.id, error, options);
      throw error;
    }
  }

  private async executeCanonicalReembed(operationId: string) {
    const operation = await this.prisma.vectorMaterializationOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation)
      throw new AppException(
        'vector_operation_not_found',
        'Vector materialization operation was not found',
        'build_vector_operation',
        false,
      );
    const snapshot = await this.loadCanonicalBuildSnapshot(operation);
    const indexBuildId = await this.ensureTargetIndexBuild(operation.id, snapshot);
    const checkpoint = record(operation.progressCheckpoint);
    let startRevisionIndex = numberValue(checkpoint.revisionIndex);
    let startChunkOffset = numberValue(checkpoint.chunkOffset);
    let vectorsUpserted = numberValue(checkpoint.vectorsUpserted);
    const hasCanonicalProgress = startRevisionIndex > 0 || startChunkOffset > 0 || vectorsUpserted > 0;
    const resetCandidate = this.shouldResetCanonicalCandidate(operation, hasCanonicalProgress);
    let targetExists = await this.qdrantAdapter.collectionExists(
      operation.targetCollectionName,
      operation.targetVectorBackendId,
    );
    if (targetExists && resetCandidate) {
      await this.qdrantAdapter.deleteCollection(operation.targetCollectionName, operation.targetVectorBackendId);
      targetExists = false;
      startRevisionIndex = 0;
      startChunkOffset = 0;
      vectorsUpserted = 0;
      await this.updateOperationProgress(operation.id, {
        phase: 'canonical_reembed',
        revisionIndex: 0,
        chunkOffset: 0,
        vectorsUpserted: 0,
        resetAfterFailure: true,
        resetAt: new Date().toISOString(),
      });
    }
    if (!targetExists) {
      await this.qdrantAdapter.createCollection(
        operation.targetCollectionName,
        snapshot.indexVersion.embeddingDimension,
        'Cosine',
        qdrantOptionsForStorageProfile(normalizeStorageProfile(snapshot.indexVersion.storageProfile)),
        operation.targetVectorBackendId,
      );
    }

    for (let revisionIndex = startRevisionIndex; revisionIndex < snapshot.manifestEntries.length; revisionIndex += 1) {
      const entry = snapshot.manifestEntries[revisionIndex];
      const expectedChunks = await this.prisma.chunk.count({
        where: {
          sourceRevisionId: entry.sourceRevisionId,
          document: { status: 'active' },
        },
      });
      if (expectedChunks === 0 && entry.sourceRevision.documentCount > 0) {
        throw new AppException(
          'vector_operation_canonical_chunks_missing',
          'Active source revision has no canonical chunks to re-embed',
          'build_vector_operation',
          false,
          {
            sourceRevisionId: entry.sourceRevisionId,
            sourceId: entry.sourceRevision.sourceId,
          },
        );
      }

      const initialOffset = revisionIndex === startRevisionIndex ? startChunkOffset : 0;
      for (let chunkOffset = initialOffset; chunkOffset < expectedChunks; chunkOffset += VECTOR_OPERATION_BATCH_SIZE) {
        const chunks = await this.prisma.chunk.findMany({
          where: {
            sourceRevisionId: entry.sourceRevisionId,
            document: { status: 'active' },
          },
          include: {
            document: { select: { id: true, sourceId: true } },
          },
          orderBy: [{ documentId: 'asc' }, { chunkIndex: 'asc' }],
          skip: chunkOffset,
          take: VECTOR_OPERATION_BATCH_SIZE,
        });
        const vectors = await this.embeddingsService.embedTexts(
          chunks.map((chunk) => chunk.text),
          snapshot.provider,
        );
        await this.qdrantAdapter.upsertVectors(
          operation.targetCollectionName,
          vectors,
          chunks.map((chunk) =>
            toVectorPayload({
              chunk,
              indexVersionId: snapshot.indexVersion.id,
              sourceRevisionId: entry.sourceRevisionId,
              workspaceServingRevisionId: snapshot.serving.id,
              indexBuildId,
              vectorBackendId: operation.targetVectorBackendId,
              sourceId: entry.sourceRevision.sourceId,
            }),
          ),
          operation.targetVectorBackendId,
        );
        vectorsUpserted += chunks.length;
        await this.updateOperationProgress(operation.id, {
          phase: 'canonical_reembed',
          revisionIndex,
          sourceRevisionId: entry.sourceRevisionId,
          chunkOffset: chunkOffset + chunks.length,
          expectedChunks,
          vectorsUpserted,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    await this.prisma.vectorMaterializationOperation.update({
      where: { id: operation.id },
      data: { state: 'validating' },
    });
    await this.prisma.indexBuild.update({
      where: { id: indexBuildId },
      data: { status: IndexBuildStatus.validating },
    });

    const revisionCoverage = await this.materializationValidator.validateCanonicalCoverage(
      operation.targetCollectionName,
      operation.targetVectorBackendId,
      snapshot.manifestEntries,
    );
    const totalPoints = await this.qdrantAdapter.countCollection(
      operation.targetCollectionName,
      operation.targetVectorBackendId,
    );
    const expectedTotal = revisionCoverage.reduce((sum, item) => sum + item.expectedChunks, 0);
    if (totalPoints < expectedTotal) {
      throw new AppException(
        'vector_operation_validation_failed',
        'Candidate point count is lower than active manifest chunk count',
        'build_vector_operation',
        true,
        { totalPoints, expectedTotal, revisionCoverage },
      );
    }
    const semanticProbes = await this.materializationValidator.candidateSemanticProbeSummary({
      knowledgeBaseId: operation.knowledgeBaseId,
      servingRevisionId: operation.servingRevisionId,
      collectionName: operation.targetCollectionName,
      vectorBackendId: operation.targetVectorBackendId,
      indexVersion: snapshot.indexVersion,
    });
    const validationSummary = {
      transfer: 'canonical_reembed',
      totalPoints,
      expectedTotal,
      vectorsUpserted,
      revisionCoverage,
      semanticProbes,
      evalSample: semanticProbes,
      validatedAt: new Date().toISOString(),
    };
    await this.prisma.indexBuild.update({
      where: { id: indexBuildId },
      data: {
        status: IndexBuildStatus.ready,
        finishedAt: new Date(),
        validationSummary: validationSummary as Prisma.InputJsonValue,
        resourceObserved: {
          kind: 'observed',
          vectorBackendId: operation.targetVectorBackendId,
          collectionName: operation.targetCollectionName,
          totalPoints,
          sourceRevisionCount: revisionCoverage.length,
          measuredAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    await this.prisma.vectorMaterializationOperation.update({
      where: { id: operation.id },
      data: { targetIndexBuildId: indexBuildId },
    });
    return this.markOperationValidated(operation.id, validationSummary);
  }

  async cutoverOperation(operationId: string) {
    const prepared = await this.prisma.vectorMaterializationOperation.findUnique({
      where: { id: operationId },
    });
    if (
      prepared &&
      prepared.state === 'ready_for_cutover' &&
      prepared.sourceVectorBackendId === prepared.targetVectorBackendId
    ) {
      const placement = await this.prisma.workspaceVectorPlacement.findUnique({
        where: { knowledgeBaseId: prepared.knowledgeBaseId },
      });
      if (!placement || placement.physicalCollectionName !== prepared.sourceCollectionName) {
        throw new AppException(
          'vector_operation_stale_source',
          'Active placement changed before cutover',
          'cutover_vector_operation',
          true,
        );
      }
      // Qdrant applies alias actions atomically. PostgreSQL still records the
      // physical target so a crash between these systems remains retryable.
      await this.qdrantAdapter.switchCollectionAlias(
        placement.collectionAlias,
        prepared.targetCollectionName,
        prepared.targetVectorBackendId,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const operation = await tx.vectorMaterializationOperation.findUnique({ where: { id: operationId } });
      if (!operation)
        throw new AppException(
          'vector_operation_not_found',
          'Vector materialization operation was not found',
          'cutover_vector_operation',
          false,
        );
      if (operation.state === 'cutover_complete') return operation;
      if (operation.state !== 'ready_for_cutover')
        throw new AppException(
          'vector_operation_not_ready',
          'Vector operation must validate before cutover',
          'cutover_vector_operation',
          false,
        );
      const placement = await tx.workspaceVectorPlacement.findUnique({
        where: { knowledgeBaseId: operation.knowledgeBaseId },
      });
      if (
        !placement ||
        placement.vectorBackendId !== operation.sourceVectorBackendId ||
        placement.physicalCollectionName !== operation.sourceCollectionName
      ) {
        throw new AppException(
          'vector_operation_stale_source',
          'Active placement changed before cutover',
          'cutover_vector_operation',
          true,
        );
      }
      await tx.workspaceVectorPlacement.update({
        where: { id: placement.id },
        data: {
          vectorBackendId: operation.targetVectorBackendId,
          physicalCollectionName: operation.targetCollectionName,
          servingRevisionId: operation.servingRevisionId,
          activeIndexBuildId: operation.targetIndexBuildId || placement.activeIndexBuildId,
          state: WorkspaceVectorPlacementState.loaded,
          reasonSnapshot: { reason: 'blue_green_cutover', operationId: operation.id },
        },
      });
      return tx.vectorMaterializationOperation.update({
        where: { id: operation.id },
        data: { state: 'cutover_complete', cleanupAfter: operation.rollbackUntil },
      });
    });
  }

  async rollbackOperation(operationId: string) {
    const prepared = await this.prisma.vectorMaterializationOperation.findUnique({
      where: { id: operationId },
    });
    if (
      prepared &&
      prepared.state === 'cutover_complete' &&
      prepared.sourceVectorBackendId === prepared.targetVectorBackendId &&
      prepared.sourceCollectionName
    ) {
      const placement = await this.prisma.workspaceVectorPlacement.findUnique({
        where: { knowledgeBaseId: prepared.knowledgeBaseId },
      });
      if (!placement || placement.physicalCollectionName !== prepared.targetCollectionName) {
        throw new AppException(
          'vector_operation_stale_target',
          'Active placement changed after cutover',
          'rollback_vector_operation',
          true,
        );
      }
      await this.qdrantAdapter.switchCollectionAlias(
        placement.collectionAlias,
        prepared.sourceCollectionName,
        prepared.sourceVectorBackendId,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const operation = await tx.vectorMaterializationOperation.findUnique({ where: { id: operationId } });
      if (!operation)
        throw new AppException(
          'vector_operation_not_found',
          'Vector materialization operation was not found',
          'rollback_vector_operation',
          false,
        );
      if (operation.state === 'rollback_complete') return operation;
      if (operation.state !== 'cutover_complete' || !operation.rollbackUntil || operation.rollbackUntil < new Date()) {
        throw new AppException(
          'vector_operation_rollback_unavailable',
          'Vector operation is not inside its rollback retention window',
          'rollback_vector_operation',
          false,
        );
      }
      const placement = await tx.workspaceVectorPlacement.findUnique({
        where: { knowledgeBaseId: operation.knowledgeBaseId },
      });
      if (
        !placement ||
        placement.vectorBackendId !== operation.targetVectorBackendId ||
        placement.physicalCollectionName !== operation.targetCollectionName
      ) {
        throw new AppException(
          'vector_operation_stale_target',
          'Active placement changed after cutover',
          'rollback_vector_operation',
          true,
        );
      }
      await tx.workspaceVectorPlacement.update({
        where: { id: placement.id },
        data: {
          vectorBackendId: operation.sourceVectorBackendId || placement.vectorBackendId,
          physicalCollectionName: operation.sourceCollectionName,
          servingRevisionId: operation.servingRevisionId,
          activeIndexBuildId: operation.sourceIndexBuildId,
          state: WorkspaceVectorPlacementState.loaded,
          reasonSnapshot: { reason: 'blue_green_rollback', operationId: operation.id },
        },
      });
      return tx.vectorMaterializationOperation.update({
        where: { id: operation.id },
        data: { state: 'rollback_complete', cleanupAfter: null },
      });
    });
  }

  async scheduleOperationCleanup(operationId: string) {
    const operation = await this.prisma.vectorMaterializationOperation.findUnique({ where: { id: operationId } });
    if (!operation)
      throw new AppException(
        'vector_operation_not_found',
        'Vector materialization operation was not found',
        'cleanup_vector_operation',
        false,
      );
    if (operation.state === 'cleanup_pending' || operation.state === 'cleanup_complete') return operation;
    if (operation.state !== 'cutover_complete')
      throw new AppException(
        'vector_operation_cleanup_unavailable',
        'Only a successful cutover can schedule cleanup',
        'cleanup_vector_operation',
        false,
      );
    const placement = await this.prisma.workspaceVectorPlacement.findUnique({
      where: { knowledgeBaseId: operation.knowledgeBaseId },
    });
    if (
      placement?.physicalCollectionName === operation.sourceCollectionName &&
      placement.vectorBackendId === operation.sourceVectorBackendId
    ) {
      throw new AppException(
        'vector_operation_cleanup_active_collection',
        'Cleanup never targets the active physical collection',
        'cleanup_vector_operation',
        false,
      );
    }
    return this.prisma.vectorMaterializationOperation.update({
      where: { id: operation.id },
      data: { state: 'cleanup_pending' },
    });
  }

  async executeOperationCleanup(operationId: string) {
    const operation = await this.prisma.vectorMaterializationOperation.findUnique({ where: { id: operationId } });
    if (!operation)
      throw new AppException(
        'vector_operation_not_found',
        'Vector materialization operation was not found',
        'cleanup_vector_operation',
        false,
      );
    if (operation.state === 'cleanup_complete') return operation;
    if (operation.state !== 'cleanup_pending')
      throw new AppException(
        'vector_operation_cleanup_unavailable',
        'Cleanup must be scheduled after a successful cutover',
        'cleanup_vector_operation',
        false,
      );
    if (operation.cleanupAfter && operation.cleanupAfter > new Date()) {
      throw new AppException(
        'vector_operation_cleanup_retention_active',
        'Rollback retention has not expired',
        'cleanup_vector_operation',
        false,
        { cleanupAfter: operation.cleanupAfter.toISOString() },
      );
    }
    if (!operation.sourceCollectionName) {
      return this.prisma.vectorMaterializationOperation.update({
        where: { id: operation.id },
        data: { state: 'cleanup_complete' },
      });
    }
    const placement = await this.prisma.workspaceVectorPlacement.findUnique({
      where: { knowledgeBaseId: operation.knowledgeBaseId },
    });
    if (
      placement?.physicalCollectionName === operation.sourceCollectionName &&
      placement.vectorBackendId === operation.sourceVectorBackendId
    ) {
      throw new AppException(
        'vector_operation_cleanup_active_collection',
        'Cleanup never targets the active physical collection',
        'cleanup_vector_operation',
        false,
      );
    }
    await this.qdrantAdapter.deleteCollection(
      operation.sourceCollectionName,
      operation.sourceVectorBackendId || undefined,
    );
    return this.prisma.vectorMaterializationOperation.update({
      where: { id: operation.id },
      data: { state: 'cleanup_complete' },
    });
  }

  private async loadCanonicalBuildSnapshot(operation: {
    id: string;
    knowledgeBaseId: string;
    servingRevisionId: string | null;
    targetCollectionName: string;
    targetVectorBackendId: string;
  }) {
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: operation.knowledgeBaseId },
    });
    if (!knowledgeBase || !knowledgeBase.activeIndexVersionId) {
      throw new AppException(
        'vector_operation_index_missing',
        'Active index is required for canonical materialization',
        'build_vector_operation',
        false,
        { knowledgeBaseId: operation.knowledgeBaseId },
      );
    }
    const [indexVersion, serving] = await Promise.all([
      this.prisma.indexVersion.findUnique({
        where: { id: knowledgeBase.activeIndexVersionId },
      }),
      this.prisma.workspaceServingRevision.findUnique({
        where: { id: operation.servingRevisionId || '' },
        include: {
          manifestEntries: {
            include: { sourceRevision: true },
            orderBy: { position: 'asc' },
          },
        },
      }),
    ]);
    if (!indexVersion || indexVersion.status !== 'active') {
      throw new AppException(
        'vector_operation_index_missing',
        'Active index is required for canonical materialization',
        'build_vector_operation',
        false,
        { knowledgeBaseId: operation.knowledgeBaseId },
      );
    }
    if (!serving || serving.status !== 'active' || serving.manifestEntries.length === 0) {
      throw new AppException(
        'vector_operation_manifest_missing',
        'Complete active serving manifest is required for canonical materialization',
        'build_vector_operation',
        false,
        { knowledgeBaseId: operation.knowledgeBaseId },
      );
    }
    const provider = await this.embeddingsService.resolveProvider({
      knowledgeBase,
      indexVersion,
      purpose: 'indexing',
    });
    if (provider.model !== indexVersion.embeddingModel || provider.dimension !== indexVersion.embeddingDimension) {
      throw new AppException(
        'vector_operation_embedding_incompatible',
        'Embedding provider does not match active index compatibility',
        'build_vector_operation',
        false,
        {
          activeModel: indexVersion.embeddingModel,
          activeDimension: indexVersion.embeddingDimension,
          runtimeModel: provider.model,
          runtimeDimension: provider.dimension,
        },
      );
    }
    await this.embeddingsService.assertReady(provider);
    return { knowledgeBase, indexVersion, serving, manifestEntries: serving.manifestEntries, provider };
  }

  private async ensureTargetIndexBuild(
    operationId: string,
    snapshot: Awaited<ReturnType<WorkspaceVectorPlacementService['loadCanonicalBuildSnapshot']>>,
  ) {
    const operation = await this.prisma.vectorMaterializationOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation) {
      throw new AppException(
        'vector_operation_not_found',
        'Vector materialization operation was not found',
        'build_vector_operation',
        false,
      );
    }
    if (operation.targetIndexBuildId) return operation.targetIndexBuildId;
    const build = await this.prisma.indexBuild.create({
      data: {
        knowledgeBaseId: operation.knowledgeBaseId,
        workspaceServingRevisionId: snapshot.serving.id,
        buildKind: `${operation.kind}_${operation.strategy}`,
        physicalCollectionName: operation.targetCollectionName,
        storageProfile: snapshot.indexVersion.storageProfile,
        configSnapshot: {
          strategy: operation.strategy,
          embeddingModel: snapshot.indexVersion.embeddingModel,
          embeddingDimension: snapshot.indexVersion.embeddingDimension,
          payloadSchemaVersion: snapshot.serving.payloadSchemaVersion,
        } as Prisma.InputJsonValue,
        status: IndexBuildStatus.building,
      },
    });
    await this.prisma.vectorMaterializationOperation.update({
      where: { id: operation.id },
      data: { targetIndexBuildId: build.id },
    });
    return build.id;
  }

  private shouldResetCanonicalCandidate(
    operation: {
      attemptCount?: number | null;
      errorSummary?: Prisma.JsonValue | null;
    },
    hasCanonicalProgress: boolean,
  ): boolean {
    if (numberValue(operation.attemptCount) <= 1) return false;
    const errorSummary = record(operation.errorSummary);
    const stage = stringValue(errorSummary.stage);
    const code = stringValue(errorSummary.code);
    if (!hasCanonicalProgress) return true;
    return (
      stage === 'qdrant_create_collection' ||
      stage === 'qdrant_upsert_vectors' ||
      code === 'vector_collection_create_failed' ||
      code === 'vector_upsert_failed'
    );
  }

  private async assertOperationStillFresh(operation: {
    knowledgeBaseId: string;
    sourceVectorBackendId: string | null;
    sourceCollectionName: string | null;
    servingRevisionId: string | null;
    sourceIndexBuildId: string | null;
  }) {
    const placement = await this.prisma.workspaceVectorPlacement.findUnique({
      where: { knowledgeBaseId: operation.knowledgeBaseId },
    });
    if (
      !placement ||
      placement.vectorBackendId !== operation.sourceVectorBackendId ||
      placement.physicalCollectionName !== operation.sourceCollectionName ||
      placement.servingRevisionId !== operation.servingRevisionId ||
      placement.activeIndexBuildId !== operation.sourceIndexBuildId
    ) {
      throw new AppException(
        'vector_operation_stale_source',
        'Active placement changed before candidate build',
        'build_vector_operation',
        true,
        { knowledgeBaseId: operation.knowledgeBaseId },
      );
    }
  }

  private async updateOperationProgress(operationId: string, progress: Record<string, unknown>) {
    const operation = await this.prisma.vectorMaterializationOperation.findUnique({
      where: { id: operationId },
      select: { progressCheckpoint: true },
    });
    await this.prisma.vectorMaterializationOperation.update({
      where: { id: operationId },
      data: {
        progressCheckpoint: {
          ...record(operation?.progressCheckpoint),
          ...progress,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async failOperation(operationId: string, error: unknown, options: BuildFailureOptions = {}) {
    const appError = error as { code?: string; stage?: string; details?: Record<string, unknown> };
    const finalize = options.finalizeFailures !== false;
    await this.prisma.vectorMaterializationOperation.update({
      where: { id: operationId },
      data: {
        ...(finalize ? { state: 'failed' as const } : {}),
        errorSummary: {
          message: error instanceof Error ? error.message : String(error),
          code: appError.code,
          stage: appError.stage || 'build_vector_operation',
          details: sanitizeErrorDetails(appError.details),
          ...(finalize ? { failedAt: new Date().toISOString() } : { lastFailedAttemptAt: new Date().toISOString() }),
        } as Prisma.InputJsonValue,
      },
    });
    if (!finalize) return;
    const operation = await this.prisma.vectorMaterializationOperation.findUnique({
      where: { id: operationId },
      select: { targetIndexBuildId: true },
    });
    if (operation?.targetIndexBuildId) {
      await this.prisma.indexBuild
        .update({
          where: { id: operation.targetIndexBuildId },
          data: {
            status: IndexBuildStatus.failed,
            finishedAt: new Date(),
            validationSummary: {
              error: error instanceof Error ? error.message : String(error),
              failedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
    }
  }

  private async backfillCompatibilityPlacements() {
    const backend = await this.vectorBackendsService.ensureDefaultBackend();
    const workspaces = await this.prisma.knowledgeBase.findMany({
      include: {
        activeServingRevision: true,
        indexVersions: { where: { status: 'active' } },
      },
    });
    await Promise.all(
      workspaces.map(async (workspace) => {
        const index = workspace.indexVersions.find((item) => item.id === workspace.activeIndexVersionId);
        const state = placementState(index?.lifecycleStatus);
        await this.prisma.workspaceVectorPlacement.upsert({
          where: { knowledgeBaseId: workspace.id },
          create: {
            knowledgeBaseId: workspace.id,
            vectorBackendId: backend.id,
            servingRevisionId: workspace.activeServingRevisionId,
            collectionAlias: `workspace-${workspace.slug}`,
            physicalCollectionName: index?.vectorCollectionName || null,
            mode: WorkspaceVectorPlacementMode.pinned,
            state,
            reasonSnapshot: {
              reason: 'legacy_default_backend_backfill',
              backendName: backend.name,
            },
            capacitySnapshot: {},
          },
          update: {},
        });
      }),
    );
  }

  private async createPlacement(
    workspace: {
      id: string;
      slug: string;
      activeServingRevisionId?: string | null;
      activeIndexVersionId?: string | null;
    },
    backend: VectorBackend,
    mode: 'pinned' | 'capacity_assisted',
    snapshot: Record<string, unknown>,
  ) {
    const index = workspace.activeIndexVersionId
      ? await this.prisma.indexVersion.findUnique({
          where: { id: workspace.activeIndexVersionId },
        })
      : null;
    try {
      return await this.prisma.workspaceVectorPlacement.create({
        data: {
          knowledgeBaseId: workspace.id,
          vectorBackendId: backend.id,
          servingRevisionId: workspace.activeServingRevisionId || null,
          collectionAlias: `workspace-${workspace.slug}`,
          physicalCollectionName: index?.vectorCollectionName || null,
          mode,
          state: placementState(index?.lifecycleStatus),
          reasonSnapshot: {
            reason: mode === 'pinned' ? 'operator_pin' : 'capacity_assisted_initial',
          },
          capacitySnapshot: snapshot as Prisma.InputJsonValue,
        },
        include: { vectorBackend: true },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        const existing = await this.prisma.workspaceVectorPlacement.findUnique({
          where: { knowledgeBaseId: workspace.id },
          include: { vectorBackend: true },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }
}
