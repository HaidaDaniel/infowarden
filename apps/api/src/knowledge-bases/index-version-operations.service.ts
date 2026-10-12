import { HttpStatus, Injectable } from '@nestjs/common';
import { IndexVersionStatus } from '@prisma/client';
import { AppException } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { QdrantAdapter } from '../vector-index/qdrant.adapter';
import { KnowledgeBasesService } from './knowledge-bases.service';

type IndexVersionRow = {
  id: string;
  knowledgeBaseId: string;
  datasetVersionId: string;
  embeddingModel: string;
  embeddingDimension: number;
  chunkingConfig: unknown;
  vectorCollectionName: string;
  materializationMode: string;
  status: IndexVersionStatus;
  createdAt: Date;
  datasetVersion: {
    id: string;
    documentCount: number;
    contentHash: string;
    status: string;
    createdAt: Date;
    sourceSnapshots: Array<{
      id: string;
      sourceId: string;
      snapshotType: string;
      ref: string | null;
      fileCount: number;
      contentBytes: number;
      createdAt: Date;
    }>;
  };
  validationReports: Array<{
    id: string;
    level: string;
    status: string;
    summary: unknown;
    issues: unknown;
    createdAt: Date;
  }>;
};

@Injectable()
export class IndexVersionOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly qdrantAdapter: QdrantAdapter,
  ) {}

  async compare(identifier: string, baseIndexVersionId: string, targetIndexVersionId: string) {
    if (!baseIndexVersionId || !targetIndexVersionId) {
      throw new AppException(
        'index_compare_versions_required',
        'base and target index version ids are required',
        'compare_index_versions',
        false,
        {},
        HttpStatus.BAD_REQUEST,
      );
    }

    const workspace = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const [base, target] = await Promise.all([
      this.findIndexVersion(workspace.id, baseIndexVersionId),
      this.findIndexVersion(workspace.id, targetIndexVersionId),
    ]);
    const stats = await this.loadStats([base.id, target.id]);
    const baseSummary = this.toIndexVersionSummary(base, workspace.activeIndexVersionId, stats);
    const targetSummary = this.toIndexVersionSummary(target, workspace.activeIndexVersionId, stats);

    return {
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        activeIndexVersionId: workspace.activeIndexVersionId,
      },
      base: baseSummary,
      target: targetSummary,
      comparison: {
        documentCountDelta: targetSummary.dataset.documentCount - baseSummary.dataset.documentCount,
        chunkVersionCountDelta: targetSummary.chunks.versionedCount - baseSummary.chunks.versionedCount,
        liveChunkCountDelta: targetSummary.chunks.liveCount - baseSummary.chunks.liveCount,
        tokenCountDelta: targetSummary.chunks.tokenCount - baseSummary.chunks.tokenCount,
        embeddingModelChanged: base.embeddingModel !== target.embeddingModel,
        embeddingDimensionChanged: base.embeddingDimension !== target.embeddingDimension,
        chunkingConfigChanged:
          JSON.stringify(base.chunkingConfig) !== JSON.stringify(target.chunkingConfig),
        sourceSnapshotRefs: this.compareSnapshotRefs(
          base.datasetVersion.sourceSnapshots,
          target.datasetVersion.sourceSnapshots,
        ),
        rollback: this.rollbackReadiness(workspace.activeIndexVersionId, target),
      },
    };
  }

  async rollback(identifier: string, targetIndexVersionId: string) {
    const workspace = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const target = await this.findIndexVersion(workspace.id, targetIndexVersionId);
    const readiness = this.rollbackReadiness(workspace.activeIndexVersionId, target);

    if (!readiness.safe) {
      throw new AppException(
        readiness.code,
        readiness.message,
        'rollback_index_version',
        false,
        {
          workspaceId: workspace.id,
          activeIndexVersionId: workspace.activeIndexVersionId,
          targetIndexVersionId: target.id,
          materializationMode: target.materializationMode,
          recommendedAction: readiness.recommendedAction,
        },
        HttpStatus.CONFLICT,
      );
    }

    const exists = await this.qdrantAdapter.collectionExists(target.vectorCollectionName);
    if (!exists) {
      throw new AppException(
        'index_rollback_collection_missing',
        'Rollback target vector collection is not available',
        'rollback_index_version',
        false,
        {
          workspaceId: workspace.id,
          targetIndexVersionId: target.id,
          vectorCollectionName: target.vectorCollectionName,
          recommendedAction: 'rebuild_collection',
        },
        HttpStatus.CONFLICT,
      );
    }

    const previousActiveIndexVersionId = workspace.activeIndexVersionId;
    if (previousActiveIndexVersionId && previousActiveIndexVersionId !== target.id) {
      await this.prisma.indexVersion.update({
        where: { id: previousActiveIndexVersionId },
        data: { status: IndexVersionStatus.archived },
      });
    }
    await this.prisma.indexVersion.update({
      where: { id: target.id },
      data: { status: IndexVersionStatus.active },
    });
    await this.prisma.knowledgeBase.update({
      where: { id: workspace.id },
      data: { activeIndexVersionId: target.id },
    });

    return {
      applied: true,
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        previousActiveIndexVersionId,
        activeIndexVersionId: target.id,
      },
      targetIndexVersion: {
        id: target.id,
        vectorCollectionName: target.vectorCollectionName,
        materializationMode: target.materializationMode,
      },
      warnings: [],
    };
  }

  private async findIndexVersion(knowledgeBaseId: string, indexVersionId: string): Promise<IndexVersionRow> {
    const indexVersion = await this.prisma.indexVersion.findFirst({
      where: {
        id: indexVersionId,
        knowledgeBaseId,
      },
      include: {
        datasetVersion: {
          include: {
            sourceSnapshots: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        validationReports: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!indexVersion) {
      throw new AppException(
        'index_version_not_found',
        'Index version was not found in the requested workspace',
        'index_version_lookup',
        false,
        { knowledgeBaseId, indexVersionId },
        HttpStatus.NOT_FOUND,
      );
    }

    return indexVersion as unknown as IndexVersionRow;
  }

  private async loadStats(indexVersionIds: string[]) {
    const [chunkVersionCounts, chunkVersionTokens, liveChunkCounts, liveChunkTokens] =
      await Promise.all([
        this.prisma.chunkVersion.groupBy({
          by: ['indexVersionId'],
          where: { indexVersionId: { in: indexVersionIds } },
          _count: { _all: true },
        }),
        this.prisma.chunkVersion.groupBy({
          by: ['indexVersionId'],
          where: { indexVersionId: { in: indexVersionIds } },
          _sum: { tokenCount: true },
        }),
        this.prisma.chunk.groupBy({
          by: ['indexVersionId'],
          where: { indexVersionId: { in: indexVersionIds } },
          _count: { _all: true },
        }),
        this.prisma.chunk.groupBy({
          by: ['indexVersionId'],
          where: { indexVersionId: { in: indexVersionIds } },
          _sum: { tokenCount: true },
        }),
      ]);

    return {
      versionedCount: new Map(chunkVersionCounts.map((row) => [row.indexVersionId, row._count._all])),
      versionedTokens: new Map(
        chunkVersionTokens.map((row) => [row.indexVersionId, row._sum.tokenCount || 0]),
      ),
      liveCount: new Map(liveChunkCounts.map((row) => [row.indexVersionId, row._count._all])),
      liveTokens: new Map(liveChunkTokens.map((row) => [row.indexVersionId, row._sum.tokenCount || 0])),
    };
  }

  private toIndexVersionSummary(
    indexVersion: IndexVersionRow,
    activeIndexVersionId: string | null,
    stats: Awaited<ReturnType<IndexVersionOperationsService['loadStats']>>,
  ) {
    const latestValidationReport = indexVersion.validationReports[0];

    return {
      id: indexVersion.id,
      status: indexVersion.status,
      isActive: activeIndexVersionId === indexVersion.id,
      createdAt: indexVersion.createdAt,
      provider: {
        embeddingModel: indexVersion.embeddingModel,
        embeddingDimension: indexVersion.embeddingDimension,
      },
      chunkingConfig: indexVersion.chunkingConfig,
      vector: {
        collectionName: indexVersion.vectorCollectionName,
        materializationMode: indexVersion.materializationMode,
      },
      dataset: {
        id: indexVersion.datasetVersion.id,
        documentCount: indexVersion.datasetVersion.documentCount,
        contentHash: indexVersion.datasetVersion.contentHash,
        status: indexVersion.datasetVersion.status,
        createdAt: indexVersion.datasetVersion.createdAt,
        sourceSnapshots: indexVersion.datasetVersion.sourceSnapshots.map((snapshot) => ({
          id: snapshot.id,
          sourceId: snapshot.sourceId,
          snapshotType: snapshot.snapshotType,
          ref: snapshot.ref,
          fileCount: snapshot.fileCount,
          contentBytes: snapshot.contentBytes,
          createdAt: snapshot.createdAt,
        })),
      },
      chunks: {
        versionedCount: stats.versionedCount.get(indexVersion.id) || 0,
        liveCount: stats.liveCount.get(indexVersion.id) || 0,
        tokenCount:
          stats.versionedTokens.get(indexVersion.id) || stats.liveTokens.get(indexVersion.id) || 0,
      },
      validation: latestValidationReport
        ? {
            latest: {
              id: latestValidationReport.id,
              level: latestValidationReport.level,
              status: latestValidationReport.status,
              summary: latestValidationReport.summary,
              issues: latestValidationReport.issues,
              createdAt: latestValidationReport.createdAt,
            },
            reportCount: indexVersion.validationReports.length,
          }
        : {
            latest: null,
            reportCount: 0,
          },
    };
  }

  private rollbackReadiness(activeIndexVersionId: string | null, target: IndexVersionRow) {
    if (activeIndexVersionId === target.id) {
      return {
        safe: false,
        code: 'index_rollback_target_already_active',
        message: 'Target index version is already active',
        recommendedAction: 'no_action',
      };
    }

    if (target.status === IndexVersionStatus.failed || target.status === IndexVersionStatus.building) {
      return {
        safe: false,
        code: 'index_rollback_target_not_successful',
        message: 'Only successful index versions can be rollback targets',
        recommendedAction: 'choose_active_or_archived_index_version',
      };
    }

    if (target.materializationMode !== 'immutable_collection') {
      return {
        safe: false,
        code: 'index_rollback_blocked_mutable_collection',
        message:
          'Rollback is blocked because mutable_collection reuses the serving vector collection across builds',
        recommendedAction: 'run_source_refresh_with_rebuild_collection',
      };
    }

    return {
      safe: true,
      code: 'index_rollback_safe',
      message: 'Target index version uses an immutable vector collection and can be activated if the collection exists',
      recommendedAction: 'rollback',
    };
  }

  private compareSnapshotRefs(
    baseSnapshots: IndexVersionRow['datasetVersion']['sourceSnapshots'],
    targetSnapshots: IndexVersionRow['datasetVersion']['sourceSnapshots'],
  ) {
    const baseRefs = new Set(baseSnapshots.map((snapshot) => this.snapshotKey(snapshot)));
    const targetRefs = new Set(targetSnapshots.map((snapshot) => this.snapshotKey(snapshot)));

    return {
      added: [...targetRefs].filter((ref) => !baseRefs.has(ref)).sort(),
      removed: [...baseRefs].filter((ref) => !targetRefs.has(ref)).sort(),
      unchanged: [...targetRefs].filter((ref) => baseRefs.has(ref)).sort(),
    };
  }

  private snapshotKey(snapshot: { sourceId: string; snapshotType: string; ref: string | null }) {
    return `${snapshot.sourceId}:${snapshot.snapshotType}:${snapshot.ref || 'none'}`;
  }
}
