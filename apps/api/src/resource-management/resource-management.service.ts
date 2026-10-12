import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  IndexingJobType,
  IndexVersionStatus,
  SourceStatus,
} from "@prisma/client";
import { AppException } from "../common/app-error";
import { QueueService } from "../jobs/queue.service";
import { KnowledgeBasesService } from "../knowledge-bases/knowledge-bases.service";
import { PrismaService } from "../prisma/prisma.service";
import { QdrantAdapter } from "../vector-index/qdrant.adapter";
import { VectorIndexService } from "../vector-index/vector-index.service";
import { VectorBackendsService } from "../vector-backends/vector-backends.service";
import {
  normalizeStorageProfile,
  qdrantOptionsForStorageProfile,
  StorageProfile,
} from "../vector-index/storage-profile";

const DEV_TARGET = {
  cpuCores: 4,
  ramBytes: 8 * 1024 ** 3,
};

@Injectable()
export class ResourceManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly vectorIndexService: VectorIndexService,
    private readonly queueService: QueueService,
    private readonly qdrantAdapter: QdrantAdapter,
    @Optional()
    @Inject(VectorBackendsService)
    private readonly vectorBackendsService: Pick<
      VectorBackendsService,
      "list"
    > = {
      list: async () => [],
    },
  ) {}

  async getSystemResources() {
    const [collections, vectorBackends] = await Promise.all([
      this.safeCollections(),
      this.vectorBackendsService.list(),
    ]);
    const paths = this.localPaths();
    return {
      target: DEV_TARGET,
      host: {
        cpuCores: os.cpus().length,
        loadAverage: os.loadavg(),
        totalRamBytes: os.totalmem(),
        freeRamBytes: os.freemem(),
        processMemory: process.memoryUsage(),
        platform: os.platform(),
        arch: os.arch(),
      },
      disks: paths.map((item) => ({
        ...item,
        usage: this.safeDiskUsage(item.path),
      })),
      qdrant: {
        collections: collections.length,
        items: collections,
      },
      vectorBackends: {
        total: vectorBackends.length,
        enabled: vectorBackends.filter((backend) => backend.state === "enabled")
          .length,
        draining: vectorBackends.filter(
          (backend) => backend.state === "draining",
        ).length,
        offline: vectorBackends.filter((backend) => backend.state === "offline")
          .length,
        items: vectorBackends,
      },
      warnings: this.systemWarnings(
        os.cpus().length,
        os.totalmem(),
        os.freemem(),
      ),
    };
  }

  async getWorkspaceResources(identifier: string) {
    const workspace =
      await this.knowledgeBasesService.resolveIdentifier(identifier);
    const indexVersion = workspace.activeIndexVersionId
      ? await this.prisma.indexVersion.findUnique({
          where: { id: workspace.activeIndexVersionId },
        })
      : null;
    const placement = await this.prisma.workspaceVectorPlacement.findUnique({
      where: { knowledgeBaseId: workspace.id },
      include: { vectorBackend: true },
    });
    const estimate = await this.estimateWorkspace(identifier, {
      storageProfile: indexVersion?.storageProfile as
        | StorageProfile
        | undefined,
    });
    const collection = indexVersion
      ? await this.vectorIndexService.getCollectionInfo(
          placement?.physicalCollectionName || indexVersion.vectorCollectionName,
          placement?.vectorBackendId,
        )
      : null;
    const observed = this.observedMeasurement({
      placement,
      indexVersion,
      collection,
    });

    return {
      workspace: this.workspaceSummary(workspace),
      lifecycle: {
        status:
          indexVersion?.lifecycleStatus ||
          placement?.state ||
          "unloaded",
        activeIndexVersionId: workspace.activeIndexVersionId,
        vectorCollectionName: indexVersion?.vectorCollectionName || null,
        vectorBackendId: placement?.vectorBackendId || null,
        placementState: placement?.state || null,
        collectionAvailable: Boolean(collection),
      },
      activeIndexVersion: indexVersion
        ? {
            id: indexVersion.id,
            status: indexVersion.status,
            lifecycleStatus: indexVersion.lifecycleStatus,
            embeddingModel: indexVersion.embeddingModel,
            embeddingDimension: indexVersion.embeddingDimension,
            storageProfile: indexVersion.storageProfile,
            storageConfig: indexVersion.storageConfig,
            resourceEstimate: indexVersion.resourceEstimate,
            resourceRequested: this.record(
              (indexVersion as any).resourceRequested,
            ),
            resourceAllocated: this.record(
              (indexVersion as any).resourceAllocated,
            ),
            resourceObserved: this.record(
              (indexVersion as any).resourceObserved,
            ),
            resourceActual: indexVersion.resourceActual,
            createdAt: indexVersion.createdAt,
          }
        : null,
      resources: {
        estimate,
        requested: this.resourceRequested(indexVersion, estimate),
        allocated: this.resourceAllocated(placement, indexVersion),
        observed,
      },
      estimate,
      qdrantCollection: collection,
    };
  }

  async estimateWorkspace(
    identifier: string,
    options: { storageProfile?: StorageProfile | string } = {},
  ) {
    const workspace =
      await this.knowledgeBasesService.resolveIdentifier(identifier);
    const activeIndexVersion = workspace.activeIndexVersionId
      ? await this.prisma.indexVersion.findUnique({
          where: { id: workspace.activeIndexVersionId },
        })
      : null;
    const [documentCount, chunkCount, sourceStats] = await Promise.all([
      this.prisma.document.count({
        where: { source: { knowledgeBaseId: workspace.id }, status: "active" },
      }),
      this.prisma.chunk.count({
        where: activeIndexVersion
          ? { indexVersionId: activeIndexVersion.id }
          : { document: { source: { knowledgeBaseId: workspace.id } } },
      }),
      this.prisma.sourceSnapshot.aggregate({
        where: { knowledgeBaseId: workspace.id },
        _sum: { fileCount: true, contentBytes: true },
      }),
    ]);

    const embeddingDimension =
      activeIndexVersion?.embeddingDimension ||
      this.positiveNumber(process.env.EMBEDDING_DIMENSION) ||
      384;
    const estimatedChunks =
      chunkCount > 0
        ? chunkCount
        : Math.max(documentCount, sourceStats._sum.fileCount || 0, 1);
    const storageProfile = normalizeStorageProfile(
      options.storageProfile ||
        activeIndexVersion?.storageProfile ||
        process.env.QDRANT_STORAGE_PROFILE,
    );
    const rawVectorBytes = estimatedChunks * embeddingDimension * 4;
    const qdrantDiskBytesLow = Math.round(rawVectorBytes * 1.6);
    const qdrantDiskBytesHigh = Math.round(rawVectorBytes * 2.4);
    const estimatedRamBytes = this.estimateRamBytes(
      rawVectorBytes,
      storageProfile,
    );
    const warnings = this.estimateWarnings({
      embeddingDimension,
      estimatedChunks,
      estimatedRamBytes,
      qdrantDiskBytesHigh,
      storageProfile,
    });

    return {
      workspace: this.workspaceSummary(workspace),
      storageProfile,
      storageConfig: qdrantOptionsForStorageProfile(storageProfile),
      documentCount,
      sourceFileCount: sourceStats._sum.fileCount || 0,
      sourceContentBytes: sourceStats._sum.contentBytes || 0,
      estimatedChunks,
      embeddingDimension,
      rawVectorBytes,
      qdrantDiskBytesLow,
      qdrantDiskBytesHigh,
      estimatedRamBytes,
      target: DEV_TARGET,
      warnings,
      generatedAt: new Date().toISOString(),
    };
  }

  async unloadWorkspace(identifier: string) {
    const workspace =
      await this.knowledgeBasesService.resolveIdentifier(identifier);
    const indexVersion = await this.requireActiveIndex(workspace);
    const placement = await this.prisma.workspaceVectorPlacement.findUnique({
      where: { knowledgeBaseId: workspace.id },
    });
    await this.prisma.indexVersion.update({
      where: { id: indexVersion.id },
      data: { lifecycleStatus: "unloading" },
    });
    if (placement) {
      await this.prisma.workspaceVectorPlacement.update({
        where: { id: placement.id },
        data: {
          state: "loading",
          reasonSnapshot: {
            reason: "workspace_unload_started",
            indexVersionId: indexVersion.id,
          },
        },
      });
    }
    await this.vectorIndexService.deleteCollection(
      placement?.physicalCollectionName || indexVersion.vectorCollectionName,
      placement?.vectorBackendId,
    );
    const observed = {
      kind: "observed",
      vectorBackendId: placement?.vectorBackendId || null,
      collectionName:
        placement?.physicalCollectionName || indexVersion.vectorCollectionName,
      collectionDeleted: true,
      measuredAt: new Date().toISOString(),
    };
    const updated = await this.prisma.indexVersion.update({
      where: { id: indexVersion.id },
      data: {
        lifecycleStatus: "unloaded",
        resourceObserved: observed,
        resourceActual: observed,
      },
    });
    if (placement) {
      await this.prisma.workspaceVectorPlacement.update({
        where: { id: placement.id },
        data: {
          state: "unloaded",
          reasonSnapshot: {
            reason: "workspace_unloaded",
            collectionDeleted: true,
          },
        },
      });
    }
    return {
      workspace: this.workspaceSummary(workspace),
      lifecycle: {
        status: updated.lifecycleStatus,
        activeIndexVersionId: updated.id,
        vectorCollectionName: updated.vectorCollectionName,
        vectorBackendId: placement?.vectorBackendId || null,
        collectionAvailable: false,
      },
    };
  }

  async loadWorkspace(
    identifier: string,
    options: { storageProfile?: StorageProfile | string } = {},
  ) {
    const workspace =
      await this.knowledgeBasesService.resolveIdentifier(identifier);
    const indexVersion = await this.requireActiveIndex(workspace);
    const placement = await this.prisma.workspaceVectorPlacement.findUnique({
      where: { knowledgeBaseId: workspace.id },
      include: { vectorBackend: true },
    });
    if (!placement) {
      throw new AppException(
        "workspace_load_placement_missing",
        "Workspace vector placement is missing",
        "workspace_load",
        true,
        { workspaceId: workspace.id, workspaceSlug: workspace.slug },
      );
    }
    if (placement.vectorBackend.state !== "enabled") {
      await this.markWorkspaceLifecycle(
        indexVersion.id,
        placement.id,
        "degraded",
        "degraded",
        {
          reason: "vector_backend_unavailable",
          vectorBackendId: placement.vectorBackendId,
          backendState: placement.vectorBackend.state,
        },
      );
      throw new AppException(
        "workspace_load_backend_unavailable",
        "Assigned vector backend is unavailable for workspace load",
        "workspace_load",
        true,
        {
          workspaceId: workspace.id,
          vectorBackendId: placement.vectorBackendId,
          backendState: placement.vectorBackend.state,
        },
      );
    }
    const storageProfile = normalizeStorageProfile(
      options.storageProfile || indexVersion.storageProfile,
    );
    const serving = await this.requireActiveServingManifest(workspace.id);
    const existingLoadJob = await this.findActiveLoadJob(workspace.id);
    if (existingLoadJob) {
      await this.markWorkspaceLifecycle(
        indexVersion.id,
        placement.id,
        "loading",
        "loading",
        {
          reason: "workspace_load_reconcile_in_progress",
          jobId: existingLoadJob.id,
          vectorBackendId: placement.vectorBackendId,
          servingRevisionId: serving.id,
        },
      );
      return {
        workspace: this.workspaceSummary(workspace),
        lifecycle: {
          status: "loading",
          activeIndexVersionId: indexVersion.id,
          vectorCollectionName: indexVersion.vectorCollectionName,
          vectorBackendId: placement.vectorBackendId,
          collectionAvailable: false,
        },
        servingRevisionId: serving.id,
        job: { id: existingLoadJob.id },
      };
    }
    if (
      await this.vectorIndexService.getCollectionInfo(
        placement.physicalCollectionName || indexVersion.vectorCollectionName,
        placement.vectorBackendId,
      )
    ) {
      const coverage = await this.validateManifestCoverage({
        collectionName:
          placement.physicalCollectionName || indexVersion.vectorCollectionName,
        vectorBackendId: placement.vectorBackendId,
        serving,
      });
      if (coverage.complete) {
        const observed = {
          kind: "observed",
          vectorBackendId: placement.vectorBackendId,
          collectionName:
            placement.physicalCollectionName || indexVersion.vectorCollectionName,
          servingRevisionId: serving.id,
          revisionCoverage: coverage.revisionCoverage,
          measuredAt: new Date().toISOString(),
        };
        const updated = await this.prisma.indexVersion.update({
          where: { id: indexVersion.id },
          data: {
            lifecycleStatus: "loaded",
            resourceRequested: this.resourceRequested(
              indexVersion,
              await this.estimateWorkspace(identifier, { storageProfile }),
            ) as any,
            resourceAllocated: this.resourceAllocated(placement, indexVersion) as any,
            resourceObserved: observed,
            resourceActual: observed,
          },
        });
        await this.prisma.workspaceVectorPlacement.update({
          where: { id: placement.id },
          data: { state: "loaded" },
        });
        return {
          workspace: this.workspaceSummary(workspace),
          lifecycle: {
            status: updated.lifecycleStatus,
            activeIndexVersionId: updated.id,
            vectorCollectionName: updated.vectorCollectionName,
            vectorBackendId: placement.vectorBackendId,
            collectionAvailable: true,
          },
          coverage,
          job: null,
        };
      }
      await this.markWorkspaceLifecycle(
        indexVersion.id,
        placement.id,
        "partially_loaded",
        "partially_loaded",
        {
          reason: "manifest_coverage_incomplete",
          revisionCoverage: coverage.revisionCoverage,
        },
      );
    }

    await this.markWorkspaceLifecycle(
      indexVersion.id,
      placement.id,
      "loading",
      "loading",
      {
        reason: "workspace_load_reconcile_enqueued",
        vectorBackendId: placement.vectorBackendId,
        servingRevisionId: serving.id,
      },
    );
    const job = await this.queueService.enqueueIndexingJob({
      knowledgeBaseId: workspace.id,
      type: IndexingJobType.build_index,
      refresh: {
        mode: "rebuild_collection",
        trigger: "manual",
        reason: "workspace load manifest reconciliation requested",
        triggerMetadata: {
          storageProfile,
          lifecycleAction: "load_workspace",
          servingRevisionId: serving.id,
          vectorBackendId: placement.vectorBackendId,
        },
      },
    });

    return {
      workspace: this.workspaceSummary(workspace),
      lifecycle: {
        status: "loading",
        activeIndexVersionId: indexVersion.id,
        vectorCollectionName: indexVersion.vectorCollectionName,
        vectorBackendId: placement.vectorBackendId,
        collectionAvailable: false,
      },
      servingRevisionId: serving.id,
      job,
    };
  }

  private async findActiveLoadJob(knowledgeBaseId: string) {
    const jobs = await this.prisma.indexingJob.findMany({
      where: {
        knowledgeBaseId,
        type: IndexingJobType.build_index,
        status: { in: ["queued", "running"] },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return jobs.find((job) => {
      const stats = this.record(job.stats);
      const refresh = this.record(stats.refresh);
      const triggerMetadata = this.record(refresh.triggerMetadata);
      return triggerMetadata.lifecycleAction === "load_workspace";
    });
  }

  private async requireActiveServingManifest(knowledgeBaseId: string) {
    const workspace = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { activeServingRevisionId: true },
    });
    const serving = workspace?.activeServingRevisionId
      ? await this.prisma.workspaceServingRevision.findUnique({
          where: { id: workspace.activeServingRevisionId },
          include: {
            manifestEntries: {
              include: { sourceRevision: true },
              orderBy: { position: "asc" },
            },
          },
        })
      : null;
    if (!serving || serving.status !== "active" || serving.manifestEntries.length === 0) {
      throw new AppException(
        "workspace_load_stale_snapshot",
        "Workspace has no complete active serving manifest to load",
        "workspace_load",
        false,
        { knowledgeBaseId, activeServingRevisionId: workspace?.activeServingRevisionId },
      );
    }
    const activeSources = await this.prisma.source.findMany({
      where: { knowledgeBaseId, status: SourceStatus.active },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const manifestSourceIds = new Set(
      serving.manifestEntries.map((entry) => entry.sourceRevision.sourceId),
    );
    const missingSourceIds = activeSources
      .map((source) => source.id)
      .filter((sourceId) => !manifestSourceIds.has(sourceId));
    if (missingSourceIds.length > 0) {
      throw new AppException(
        "workspace_load_source_unavailable",
        "Active source is missing from the serving manifest",
        "workspace_load",
        false,
        { knowledgeBaseId, missingSourceIds },
      );
    }
    return serving;
  }

  private async validateManifestCoverage(input: {
    collectionName: string;
    vectorBackendId: string;
    serving: {
      id: string;
      manifestEntries: Array<{
        sourceRevisionId: string;
        sourceRevision: { sourceId: string; documentCount: number };
      }>;
    };
  }) {
    const revisionCoverage = await Promise.all(
      input.serving.manifestEntries.map(async (entry) => {
        const expectedChunks = await this.prisma.chunk.count({
          where: {
            document: { sourceId: entry.sourceRevision.sourceId, status: "active" },
            metadata: { path: ["sourceRevisionId"], equals: entry.sourceRevisionId },
          },
        });
        const observedPoints = await this.qdrantAdapter.countBySourceRevisionId(
          input.collectionName,
          entry.sourceRevisionId,
          input.vectorBackendId,
        );
        return {
          sourceId: entry.sourceRevision.sourceId,
          sourceRevisionId: entry.sourceRevisionId,
          expectedChunks,
          observedPoints,
        };
      }),
    );
    return {
      complete: revisionCoverage.every(
        (item) => item.expectedChunks === item.observedPoints,
      ),
      revisionCoverage,
    };
  }

  private async markWorkspaceLifecycle(
    indexVersionId: string,
    placementId: string,
    lifecycleStatus: string,
    placementState: "loaded" | "loading" | "unloaded" | "partially_loaded" | "degraded" | "failed",
    reason: Record<string, unknown>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.indexVersion.update({
        where: { id: indexVersionId },
        data: {
          lifecycleStatus,
          resourceObserved: {
            kind: "observed",
            status: lifecycleStatus,
            measuredAt: new Date().toISOString(),
            ...reason,
          },
        },
      });
      await tx.workspaceVectorPlacement.update({
        where: { id: placementId },
        data: {
          state: placementState,
          reasonSnapshot: reason as any,
        },
      });
    });
  }

  private async requireActiveIndex(workspace: {
    id: string;
    slug: string;
    activeIndexVersionId: string | null;
  }) {
    if (!workspace.activeIndexVersionId) {
      throw new AppException(
        "workspace_index_missing",
        "Workspace has no active index version",
        "workspace_lifecycle",
        false,
        { workspaceId: workspace.id, workspaceSlug: workspace.slug },
      );
    }
    const indexVersion = await this.prisma.indexVersion.findUnique({
      where: { id: workspace.activeIndexVersionId },
    });
    if (!indexVersion || indexVersion.status !== IndexVersionStatus.active) {
      throw new AppException(
        "workspace_index_not_active",
        "Workspace active index version is missing or not active",
        "workspace_lifecycle",
        false,
        { workspaceId: workspace.id, workspaceSlug: workspace.slug },
      );
    }
    return indexVersion;
  }

  private estimateRamBytes(
    rawVectorBytes: number,
    storageProfile: StorageProfile,
  ): number {
    if (storageProfile === "fast") return Math.round(rawVectorBytes * 1.4);
    if (storageProfile === "low_memory")
      return Math.round(rawVectorBytes * 0.25);
    if (storageProfile === "benchmark_remote")
      return Math.round(rawVectorBytes * 0.35);
    return Math.round(rawVectorBytes * 0.5);
  }

  private estimateWarnings(input: {
    embeddingDimension: number;
    estimatedChunks: number;
    estimatedRamBytes: number;
    qdrantDiskBytesHigh: number;
    storageProfile: StorageProfile;
  }) {
    const warnings = [];
    if (input.embeddingDimension >= 1536) {
      warnings.push({
        code: "embedding_dimension_large",
        message:
          "Embedding dimension is large for the 4 CPU / 8 GB local target",
      });
    }
    if (input.estimatedRamBytes > DEV_TARGET.ramBytes * 0.35) {
      warnings.push({
        code: "resource_budget_exceeded",
        message:
          "Estimated Qdrant RAM pressure is high for the local development target",
      });
    }
    if (input.qdrantDiskBytesHigh > 20 * 1024 ** 3) {
      warnings.push({
        code: "qdrant_disk_risk",
        message: "Estimated Qdrant disk usage is large for local development",
      });
    }
    if (
      input.estimatedChunks > 1_000_000 &&
      input.storageProfile !== "benchmark_remote"
    ) {
      warnings.push({
        code: "workspace_requires_remote_profile",
        message:
          "Large workspaces should use an explicit benchmark_remote profile or remote Qdrant host",
      });
    }
    return warnings;
  }

  private systemWarnings(
    cpuCores: number,
    totalRamBytes: number,
    freeRamBytes: number,
  ) {
    const warnings = [];
    if (cpuCores <= DEV_TARGET.cpuCores) {
      warnings.push({
        code: "cpu_dev_target",
        message: "System is at or below the 4 CPU dev target",
      });
    }
    if (totalRamBytes <= DEV_TARGET.ramBytes * 1.1) {
      warnings.push({
        code: "ram_dev_target",
        message: "System is near the 8 GB RAM dev target",
      });
    }
    if (freeRamBytes <= DEV_TARGET.ramBytes * 0.2) {
      warnings.push({ code: "ram_pressure", message: "Available RAM is low" });
    }
    return warnings;
  }

  private localPaths() {
    return [
      { role: "repo", path: process.cwd() },
      {
        role: "contextforge-cache",
        path: path.resolve(process.cwd(), ".contextforge"),
      },
      { role: "tmp", path: os.tmpdir() },
    ];
  }

  private safeDiskUsage(targetPath: string) {
    try {
      const existingPath = fs.existsSync(targetPath)
        ? targetPath
        : process.cwd();
      const stats = fs.statfsSync(existingPath);
      return {
        totalBytes: stats.blocks * stats.bsize,
        freeBytes: stats.bavail * stats.bsize,
        usedBytes: (stats.blocks - stats.bfree) * stats.bsize,
      };
    } catch {
      return null;
    }
  }

  private async safeCollections() {
    try {
      const activeIndexes = await this.prisma.indexVersion.findMany({
        where: { status: IndexVersionStatus.active },
        select: {
          id: true,
          vectorCollectionName: true,
          storageProfile: true,
          lifecycleStatus: true,
          embeddingDimension: true,
        },
      });
      return activeIndexes.map((index) => ({
        indexVersionId: index.id,
        name: index.vectorCollectionName,
        storageProfile: index.storageProfile,
        lifecycleStatus: index.lifecycleStatus,
        embeddingDimension: index.embeddingDimension,
      }));
    } catch {
      return [];
    }
  }

  private positiveNumber(value?: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private workspaceSummary(workspace: {
    id: string;
    slug: string;
    name: string;
    workspaceKind: string;
  }) {
    return {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      workspaceKind: workspace.workspaceKind,
    };
  }

  private resourceRequested(
    indexVersion: Record<string, unknown> | null,
    estimate: Record<string, unknown>,
  ) {
    const stored = this.record(indexVersion?.resourceRequested);
    if (Object.keys(stored).length > 0) return stored;
    return {
      kind: "requested",
      storageProfile: indexVersion?.storageProfile || estimate.storageProfile,
      storageConfig: indexVersion?.storageConfig || estimate.storageConfig,
      requestedAt: indexVersion?.createdAt || estimate.generatedAt,
    };
  }

  private resourceAllocated(
    placement: Record<string, unknown> | null,
    indexVersion: Record<string, unknown> | null,
  ) {
    const stored = this.record(indexVersion?.resourceAllocated);
    if (Object.keys(stored).length > 0) return stored;
    return {
      kind: "allocated",
      vectorBackendId: placement?.vectorBackendId || null,
      collectionName:
        placement?.physicalCollectionName ||
        indexVersion?.vectorCollectionName ||
        null,
      collectionAlias: placement?.collectionAlias || null,
      placementState: placement?.state || null,
      allocatedAt: placement?.updatedAt || indexVersion?.createdAt || null,
    };
  }

  private observedMeasurement(input: {
    placement: Record<string, unknown> | null;
    indexVersion: Record<string, unknown> | null;
    collection: Record<string, unknown> | null;
  }) {
    const stored = this.record(input.indexVersion?.resourceObserved);
    return {
      kind: "observed",
      ...stored,
      vectorBackendId:
        stored.vectorBackendId || input.placement?.vectorBackendId || null,
      collectionName:
        stored.collectionName ||
        input.placement?.physicalCollectionName ||
        input.indexVersion?.vectorCollectionName ||
        null,
      collectionAvailable: Boolean(input.collection),
      measuredAt: stored.measuredAt || new Date().toISOString(),
    };
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
