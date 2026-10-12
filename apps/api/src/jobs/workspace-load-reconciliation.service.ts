import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  IndexVersionStatus,
  JobStatus,
  Prisma,
  VectorBackendState,
  WorkspaceVectorPlacementState,
} from '@prisma/client';
import { AppException, getErrorCode, getErrorMessage } from '../common/app-error';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { PrismaService } from '../prisma/prisma.service';
import { QdrantAdapter, VectorPayload } from '../vector-index/qdrant.adapter';
import {
  normalizeStorageProfile,
  qdrantOptionsForStorageProfile,
} from '../vector-index/storage-profile';
import { SourceRefreshRequestContext } from './indexing.types';

type ReconcileLogEntry = {
  level: 'info' | 'warn' | 'error';
  message: string;
  at: string;
  data?: Record<string, unknown>;
};

type ChunkForReconcile = {
  id: string;
  indexVersionId: string;
  text: string;
  textHash: string;
  tokenCount: number;
  chunkIndex: number;
  startLine: number | null;
  endLine: number | null;
  metadata: Prisma.JsonValue;
  document: {
    id: string;
    status: string;
    sourceId: string;
  };
};

@Injectable()
export class WorkspaceLoadReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly qdrantAdapter: QdrantAdapter,
  ) {}

  async run(jobId: string, refresh?: SourceRefreshRequestContext) {
    const logs: ReconcileLogEntry[] = [];
    const log = (
      level: ReconcileLogEntry['level'],
      message: string,
      data?: Record<string, unknown>,
    ) => logs.push({ level, message, at: new Date().toISOString(), data });

    try {
      const job = await this.prisma.indexingJob.findUnique({
        where: { id: jobId },
        include: { knowledgeBase: true },
      });
      if (!job) {
        throw new AppException(
          'workspace_load_job_missing',
          'Workspace load reconciliation job was not found',
          'workspace_load_reconcile',
          false,
          { jobId },
        );
      }

      const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(
        job.knowledgeBaseId,
      );
      const indexVersion = knowledgeBase.activeIndexVersionId
        ? await this.prisma.indexVersion.findUnique({
            where: { id: knowledgeBase.activeIndexVersionId },
          })
        : null;
      if (!indexVersion || indexVersion.status !== IndexVersionStatus.active) {
        throw new AppException(
          'workspace_load_stale_snapshot',
          'Workspace has no active index version to reconcile',
          'workspace_load_reconcile',
          false,
          { knowledgeBaseId: knowledgeBase.id },
        );
      }

      const placement = await this.prisma.workspaceVectorPlacement.findUnique({
        where: { knowledgeBaseId: knowledgeBase.id },
        include: { vectorBackend: true },
      });
      if (!placement) {
        throw new AppException(
          'workspace_load_placement_missing',
          'Workspace vector placement is missing',
          'workspace_load_reconcile',
          true,
          { knowledgeBaseId: knowledgeBase.id },
        );
      }
      if (placement.vectorBackend.state !== VectorBackendState.enabled) {
        throw new AppException(
          'workspace_load_backend_unavailable',
          'Assigned vector backend is unavailable for workspace load',
          'workspace_load_reconcile',
          true,
          {
            knowledgeBaseId: knowledgeBase.id,
            vectorBackendId: placement.vectorBackendId,
            backendState: placement.vectorBackend.state,
          },
        );
      }

      const serving = await this.prisma.workspaceServingRevision.findUnique({
        where: { id: knowledgeBase.activeServingRevisionId || '' },
        include: {
          manifestEntries: {
            include: { sourceRevision: true },
            orderBy: { position: 'asc' },
          },
        },
      });
      if (
        !serving ||
        serving.status !== 'active' ||
        serving.manifestEntries.length === 0
      ) {
        throw new AppException(
          'workspace_load_stale_snapshot',
          'Active serving manifest is missing, inactive, or empty',
          'workspace_load_reconcile',
          false,
          {
            knowledgeBaseId: knowledgeBase.id,
            servingRevisionId: knowledgeBase.activeServingRevisionId,
          },
        );
      }

      const activeSources = await this.prisma.source.findMany({
        where: { knowledgeBaseId: knowledgeBase.id, status: 'active' },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      const manifestSourceIds = new Set(
        serving.manifestEntries.map((entry) => entry.sourceRevision.sourceId),
      );
      const missingSourceIds = activeSources
        .map((source) => source.id)
        .filter((sourceId) => !manifestSourceIds.has(sourceId));
      if (missingSourceIds.length > 0) {
        throw new AppException(
          'workspace_load_source_unavailable',
          'Active serving manifest does not cover every active source',
          'workspace_load_reconcile',
          false,
          { knowledgeBaseId: knowledgeBase.id, missingSourceIds },
        );
      }

      const provider = await this.embeddingsService.resolveProvider({
        knowledgeBase,
        indexVersion,
        purpose: 'indexing',
      });
      if (
        provider.model !== indexVersion.embeddingModel ||
        provider.dimension !== indexVersion.embeddingDimension
      ) {
        throw new AppException(
          'workspace_load_stale_snapshot',
          'Current embedding provider does not match active index compatibility',
          'workspace_load_reconcile',
          false,
          {
            knowledgeBaseId: knowledgeBase.id,
            activeModel: indexVersion.embeddingModel,
            activeDimension: indexVersion.embeddingDimension,
            runtimeModel: provider.model,
            runtimeDimension: provider.dimension,
          },
        );
      }
      await this.embeddingsService.assertReady(provider);

      const collectionName =
        placement.physicalCollectionName || indexVersion.vectorCollectionName;
      const requestedStorageProfile =
        typeof refresh?.triggerMetadata?.storageProfile === 'string'
          ? refresh.triggerMetadata.storageProfile
          : indexVersion.storageProfile;
      const storageProfile = normalizeStorageProfile(
        requestedStorageProfile,
      );
      if (
        !(await this.qdrantAdapter.collectionExists(
          collectionName,
          placement.vectorBackendId,
        ))
      ) {
        await this.qdrantAdapter.createCollection(
          collectionName,
          indexVersion.embeddingDimension,
          'Cosine',
          qdrantOptionsForStorageProfile(storageProfile),
          placement.vectorBackendId,
        );
      }

      const chunks = await this.prisma.chunk.findMany({
        where: {
          document: {
            source: { knowledgeBaseId: knowledgeBase.id },
            status: 'active',
          },
        },
        include: {
          document: {
            select: { id: true, status: true, sourceId: true },
          },
        },
        orderBy: [{ documentId: 'asc' }, { chunkIndex: 'asc' }],
      });
      const chunksByRevision = this.groupActiveChunks(chunks);
      const revisionCoverage = [];
      let vectorsUpserted = 0;

      for (const entry of serving.manifestEntries) {
        const revisionChunks =
          chunksByRevision.get(entry.sourceRevisionId) || [];
        if (
          revisionChunks.length === 0 &&
          entry.sourceRevision.documentCount > 0
        ) {
          throw new AppException(
            'workspace_load_stale_snapshot',
            'Active source revision has no stored chunks to rematerialize',
            'workspace_load_reconcile',
            false,
            {
              sourceRevisionId: entry.sourceRevisionId,
              sourceId: entry.sourceRevision.sourceId,
            },
          );
        }

        for (let offset = 0; offset < revisionChunks.length; offset += 64) {
          const batch = revisionChunks.slice(offset, offset + 64);
          const vectors = await this.embeddingsService.embedTexts(
            batch.map((chunk) => chunk.text),
            provider,
          );
          await this.qdrantAdapter.upsertVectors(
            collectionName,
            vectors,
            batch.map((chunk) =>
              this.toPayload({
                chunk,
                indexVersionId: indexVersion.id,
                sourceRevisionId: entry.sourceRevisionId,
                workspaceServingRevisionId: serving.id,
                indexBuildId: placement.activeIndexBuildId || undefined,
                vectorBackendId: placement.vectorBackendId,
                sourceId: entry.sourceRevision.sourceId,
              }),
            ),
            placement.vectorBackendId,
          );
          vectorsUpserted += batch.length;
        }

        const observedPoints = await this.qdrantAdapter.countBySourceRevisionId(
          collectionName,
          entry.sourceRevisionId,
          placement.vectorBackendId,
        );
        revisionCoverage.push({
          sourceId: entry.sourceRevision.sourceId,
          sourceRevisionId: entry.sourceRevisionId,
          expectedChunks: revisionChunks.length,
          observedPoints,
        });
      }

      const incomplete = revisionCoverage.filter(
        (item) => item.expectedChunks !== item.observedPoints,
      );
      if (incomplete.length > 0) {
        await this.setLifecycleState(
          knowledgeBase.id,
          indexVersion.id,
          placement.id,
          'partially_loaded',
          WorkspaceVectorPlacementState.partially_loaded,
          { revisionCoverage },
        );
        throw new AppException(
          'workspace_load_partial_materialization',
          'Workspace load did not materialize every active source revision',
          'workspace_load_reconcile',
          true,
          { revisionCoverage },
        );
      }

      const totalPoints = await this.qdrantAdapter.countCollection(
        collectionName,
        placement.vectorBackendId,
      );
      const observed = {
        kind: 'observed',
        vectorBackendId: placement.vectorBackendId,
        collectionName,
        servingRevisionId: serving.id,
        totalPoints,
        activeManifestPoints: revisionCoverage.reduce(
          (sum, item) => sum + item.observedPoints,
          0,
        ),
        revisionCoverage,
        vectorsUpserted,
        measuredAt: new Date().toISOString(),
      };
      const allocated = {
        kind: 'allocated',
        vectorBackendId: placement.vectorBackendId,
        collectionName,
        collectionAlias: placement.collectionAlias,
        storageProfile,
        servingRevisionId: serving.id,
        allocatedAt: new Date().toISOString(),
      };
      const requested = {
        kind: 'requested',
        storageProfile,
        storageConfig: qdrantOptionsForStorageProfile(storageProfile),
        requestedAt: new Date().toISOString(),
        reason: refresh?.reason || 'workspace load reconciliation',
        trigger: refresh?.trigger || 'manual',
      };
      await this.prisma.$transaction(async (tx) => {
        await tx.indexVersion.update({
          where: { id: indexVersion.id },
          data: {
            lifecycleStatus: 'loaded',
            storageProfile,
            storageConfig: requested.storageConfig as Prisma.InputJsonValue,
            resourceRequested: requested as Prisma.InputJsonValue,
            resourceAllocated: allocated as Prisma.InputJsonValue,
            resourceObserved: observed as Prisma.InputJsonValue,
            resourceActual: observed as Prisma.InputJsonValue,
          },
        });
        await tx.workspaceVectorPlacement.update({
          where: { id: placement.id },
          data: {
            servingRevisionId: serving.id,
            physicalCollectionName: collectionName,
            state: WorkspaceVectorPlacementState.loaded,
            reasonSnapshot: {
              reason: 'workspace_load_reconciled',
              jobId,
              revisionCoverage,
            } as Prisma.InputJsonValue,
          },
        });
      });

      const stats = {
        lifecycleAction: 'load_workspace',
        workspaceId: knowledgeBase.id,
        activeIndexVersionId: indexVersion.id,
        servingRevisionId: serving.id,
        vectorBackendId: placement.vectorBackendId,
        collectionName,
        sourceRevisionCount: serving.manifestEntries.length,
        vectorsUpserted,
        totalPoints,
        revisionCoverage,
      };
      log('info', 'Workspace load reconciliation completed', stats);
      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: {
          stats: stats as Prisma.InputJsonValue,
          logs: logs as Prisma.InputJsonValue,
        },
      });
      return { stats, logs };
    } catch (error) {
      log('error', getErrorMessage(error), {
        code: getErrorCode(error) || 'workspace_load_reconcile_failed',
        stage: (error as any)?.stage || 'workspace_load_reconcile',
      });
      await this.prisma.indexingJob.update({
        where: { id: jobId },
        data: {
          logs: logs as Prisma.InputJsonValue,
          status: JobStatus.failed,
          finishedAt: new Date(),
        },
      }).catch(() => undefined);
      throw error;
    }
  }

  private async setLifecycleState(
    knowledgeBaseId: string,
    indexVersionId: string,
    placementId: string,
    lifecycleStatus: string,
    placementState: WorkspaceVectorPlacementState,
    summary: Record<string, unknown>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.indexVersion.update({
        where: { id: indexVersionId },
        data: {
          lifecycleStatus,
          resourceObserved: {
            kind: 'observed',
            vectorBackendId: summary.vectorBackendId,
            status: lifecycleStatus,
            measuredAt: new Date().toISOString(),
            ...summary,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.workspaceVectorPlacement.update({
        where: { id: placementId },
        data: {
          state: placementState,
          reasonSnapshot: {
            reason: 'workspace_load_validation_failed',
            knowledgeBaseId,
            ...summary,
          } as Prisma.InputJsonValue,
        },
      });
    });
  }

  private groupActiveChunks(chunks: ChunkForReconcile[]) {
    const grouped = new Map<string, ChunkForReconcile[]>();
    for (const chunk of chunks) {
      const metadata = this.record(chunk.metadata);
      const sourceRevisionId = this.stringValue(metadata.sourceRevisionId);
      if (!sourceRevisionId) continue;
      const items = grouped.get(sourceRevisionId) || [];
      items.push(chunk);
      grouped.set(sourceRevisionId, items);
    }
    return grouped;
  }

  private toPayload(input: {
    chunk: ChunkForReconcile;
    indexVersionId: string;
    sourceRevisionId: string;
    workspaceServingRevisionId: string;
    indexBuildId?: string;
    vectorBackendId: string;
    sourceId: string;
  }): VectorPayload {
    const metadata = this.record(input.chunk.metadata);
    return {
      documentId: input.chunk.document.id,
      chunkId: input.chunk.id,
      indexVersionId: input.indexVersionId,
      sourceRevisionId: input.sourceRevisionId,
      workspaceServingRevisionId: input.workspaceServingRevisionId,
      indexBuildId: input.indexBuildId,
      parserVersion: this.stringValue(metadata.parserVersion) || 'builtin-parser-v1',
      chunkerVersion: this.stringValue(metadata.chunkerVersion) || 'fixed_char-v1',
      contentHash: input.chunk.textHash || this.hash(input.chunk.text),
      payloadSchemaVersion:
        this.stringValue(metadata.payloadSchemaVersion) ||
        'qdrant-chunk-payload-v2',
      vectorBackendId: input.vectorBackendId,
      vectorPointId: this.vectorPointId(input.sourceRevisionId, input.chunk.id),
      text: input.chunk.text,
      tokenCount: input.chunk.tokenCount,
      chunkIndex: input.chunk.chunkIndex,
      startLine: input.chunk.startLine ?? undefined,
      endLine: input.chunk.endLine ?? undefined,
      metadata: {
        ...metadata,
        sourceId: input.sourceId,
        sourceRevisionId: input.sourceRevisionId,
        workspaceServingRevisionId: input.workspaceServingRevisionId,
        indexBuildId: input.indexBuildId,
      },
    };
  }

  private vectorPointId(sourceRevisionId: string, chunkId: string): string {
    return this.formatUuid(this.hash(`${sourceRevisionId}:${chunkId}`));
  }

  private hash(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  }

  private formatUuid(hex: string): string {
    const value = hex.slice(0, 32);
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
