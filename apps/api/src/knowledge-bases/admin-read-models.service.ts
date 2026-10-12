import { Injectable } from '@nestjs/common';
import { IndexVersionStatus, JobStatus, Prisma, WorkspaceKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from '../health/health.service';
import { RetrievalService, SearchRequest } from '../retrieval/retrieval.service';
import { KnowledgeBasesService } from './knowledge-bases.service';
import { WorkspaceAvailability } from './workspace-availability.service';

type JobWithRelations = Prisma.IndexingJobGetPayload<{
  include: {
    knowledgeBase: {
      select: {
        id: true;
        slug: true;
        name: true;
      };
    };
    source: {
      select: {
        id: true;
        type: true;
        uri: true;
        status: true;
      };
    };
  };
}>;

type KnowledgeBaseListItem = Prisma.KnowledgeBaseGetPayload<{
  include: {
    sources: {
      select: {
        id: true;
        status: true;
      };
    };
    indexVersions: {
      select: {
        id: true;
      };
    };
  };
}>;

type KnowledgeBaseDetail = Prisma.KnowledgeBaseGetPayload<{
  include: {
    retrievalProfiles: {
      select: {
        key: true;
        name: true;
        intent: true;
        denseTopK: true;
        scoreThreshold: true;
        neighborBefore: true;
        neighborAfter: true;
        tokenBudget: true;
        grouping: true;
        recencyBoost: true;
      };
    };
    sources: {
      select: {
        id: true;
        type: true;
        uri: true;
        status: true;
        includeRules: true;
        excludeRules: true;
        lastSyncedAt: true;
        createdAt: true;
        updatedAt: true;
      };
    };
    indexVersions: {
      select: {
        id: true;
        status: true;
        createdAt: true;
        embeddingModel: true;
        embeddingDimension: true;
        vectorCollectionName: true;
        materializationMode: true;
      };
      orderBy: {
        createdAt: 'desc';
      };
    };
  };
}>;

type SnapshotRow = {
  sourceId: string;
  createdAt: Date;
  ref: string | null;
  snapshotType: string;
  fileCount: number;
  contentBytes: number;
};

type ExplorerDocumentRow = Prisma.DocumentGetPayload<{
  select: {
    id: true;
    sourceId: true;
    path: true;
    mimeType: true;
    contentHash: true;
    status: true;
    metadata: true;
    createdAt: true;
    updatedAt: true;
  };
}>;

const EXPLORER_DOCUMENT_LIMIT = 50;

@Injectable()
export class AdminReadModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly healthService: HealthService,
    private readonly retrievalService: RetrievalService,
  ) {}

  async getDashboard() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      knowledgeBaseCount,
      sourceCount,
      documentCount,
      activeIndexCount,
      statusCounts,
      jobs,
      health,
      workspaceKindCounts,
      activeWorkspaceRows,
      chunkCounts,
      recentSucceeded,
      recentFailed,
    ] = await Promise.all([
      this.prisma.knowledgeBase.count(),
      this.prisma.source.count(),
      this.prisma.document.count(),
      this.prisma.knowledgeBase.count({
        where: {
          activeIndexVersionId: {
            not: null,
          },
        },
      }),
      this.prisma.indexingJob.groupBy({
        by: ['status'],
        _count: {
          _all: true,
        },
      }),
      this.prisma.indexingJob.findMany({
        include: {
          knowledgeBase: {
            select: {
              id: true,
              slug: true,
              name: true,
            },
          },
          source: {
            select: {
              id: true,
              type: true,
              uri: true,
              status: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 5,
      }),
      this.healthService.checkAll(),
      this.prisma.knowledgeBase.groupBy({
        by: ['workspaceKind'],
        _count: {
          _all: true,
        },
      }),
      this.prisma.knowledgeBase.findMany({
        where: {
          activeIndexVersionId: {
            not: null,
          },
        },
        select: {
          id: true,
          slug: true,
          name: true,
          workspaceKind: true,
          activeIndexVersionId: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 8,
      }),
      this.prisma.chunk.groupBy({
        by: ['indexVersionId'],
        _count: {
          _all: true,
        },
      }),
      this.prisma.indexingJob.count({
        where: {
          status: JobStatus.succeeded,
          finishedAt: {
            gte: oneHourAgo,
          },
        },
      }),
      this.prisma.indexingJob.count({
        where: {
          status: JobStatus.failed,
          finishedAt: {
            gte: oneDayAgo,
          },
        },
      }),
    ]);

    const jobCounts = this.buildJobStatusCounts(statusCounts);
    const lastSuccessfulJob = jobs.find((job) => job.status === JobStatus.succeeded);
    const activeWorkspaceByIndexVersionId = new Map(
      activeWorkspaceRows
        .filter((knowledgeBase) => knowledgeBase.activeIndexVersionId)
        .map((knowledgeBase) => [knowledgeBase.activeIndexVersionId as string, knowledgeBase]),
    );
    const activeCollections = activeWorkspaceByIndexVersionId.size
      ? await this.prisma.indexVersion.findMany({
          where: {
            id: {
              in: [...activeWorkspaceByIndexVersionId.keys()],
            },
            status: IndexVersionStatus.active,
          },
          orderBy: {
            createdAt: 'desc',
          },
        })
      : [];
    const chunkCountByIndexVersion = new Map(chunkCounts.map((row) => [row.indexVersionId, row._count._all]));

    return {
      totals: {
        knowledgeBases: knowledgeBaseCount,
        sources: sourceCount,
        documents: documentCount,
        activeIndexes: activeIndexCount,
      },
      jobs: jobCounts,
      lastSuccessfulIndexAt: lastSuccessfulJob?.finishedAt ?? null,
      recentJobs: jobs.map((job) => this.buildJobSummary(job)),
      system: {
        health,
        queue: {
          queued: jobCounts.queued,
          running: jobCounts.running,
          succeededLastHour: recentSucceeded,
          failedLast24Hours: recentFailed,
          pressure: this.deriveQueuePressure(jobCounts),
        },
        workspaceKinds: this.buildWorkspaceKindCounts(workspaceKindCounts),
        collections: {
          totalActiveCollections: activeCollections.length,
          totalChunks: activeCollections.reduce(
            (sum, indexVersion) => sum + (chunkCountByIndexVersion.get(indexVersion.id) ?? 0),
            0,
          ),
          items: activeCollections
            .map((indexVersion) => {
              const knowledgeBase = activeWorkspaceByIndexVersionId.get(indexVersion.id);
              if (!knowledgeBase) {
                return null;
              }

              return {
                knowledgeBaseId: knowledgeBase.id,
                knowledgeBaseSlug: knowledgeBase.slug,
                knowledgeBaseName: knowledgeBase.name,
                workspaceKind: knowledgeBase.workspaceKind,
                indexVersionId: indexVersion.id,
                vectorCollectionName: indexVersion.vectorCollectionName,
                materializationMode: indexVersion.materializationMode,
                chunkCount: chunkCountByIndexVersion.get(indexVersion.id) ?? 0,
                createdAt: indexVersion.createdAt,
                embeddingModel: indexVersion.embeddingModel,
                embeddingDimension: indexVersion.embeddingDimension,
              };
            })
            .filter(Boolean),
        },
      },
    };
  }

  async getSystemOverview() {
    const dashboard = await this.getDashboard();
    return dashboard.system;
  }

  async listKnowledgeBaseOverviews() {
    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      include: {
        sources: {
          select: {
            id: true,
            status: true,
          },
        },
        indexVersions: {
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const sourceIds = knowledgeBases.flatMap((knowledgeBase) => knowledgeBase.sources.map((source) => source.id));
    const [documentCounts, jobs, availability] = await Promise.all([
      this.getDocumentCountsBySourceId(sourceIds),
      this.getJobsForKnowledgeBaseIds(knowledgeBases.map((knowledgeBase) => knowledgeBase.id)),
      this.knowledgeBasesService.evaluateAvailability(knowledgeBases),
    ]);

    return {
      knowledgeBases: knowledgeBases.map((knowledgeBase) =>
        this.buildKnowledgeBaseListItem(knowledgeBase, documentCounts, jobs, availability.get(knowledgeBase.id)),
      ),
    };
  }

  async getKnowledgeBaseOverview(identifier: string) {
    const knowledgeBaseRef = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: {
        id: knowledgeBaseRef.id,
      },
      include: {
        retrievalProfiles: {
          select: {
            key: true,
            name: true,
            intent: true,
            denseTopK: true,
            scoreThreshold: true,
            neighborBefore: true,
            neighborAfter: true,
            tokenBudget: true,
            grouping: true,
            recencyBoost: true,
          },
          orderBy: {
            key: 'asc',
          },
        },
        sources: {
          select: {
            id: true,
            type: true,
            uri: true,
            status: true,
            includeRules: true,
            excludeRules: true,
            lastSyncedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        indexVersions: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            embeddingModel: true,
            embeddingDimension: true,
            vectorCollectionName: true,
            materializationMode: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    const sourceIds = knowledgeBase?.sources.map((source) => source.id) || [];
    const [documentCounts, jobs, latestSnapshots, explorerDocuments, availability] = await Promise.all([
      this.getDocumentCountsBySourceId(sourceIds),
      this.getJobsForKnowledgeBaseIds([knowledgeBaseRef.id]),
      this.getLatestSnapshotsBySourceId(sourceIds),
      this.getExplorerDocuments(knowledgeBaseRef.id),
      this.knowledgeBasesService.evaluateAvailability(knowledgeBase ? [knowledgeBase] : [knowledgeBaseRef]),
    ]);

    const recentJobs = jobs
      .filter((job) => job.knowledgeBaseId === knowledgeBaseRef.id)
      .slice(0, 10)
      .map((job) => this.buildJobSummary(job));

    return {
      knowledgeBase: this.buildKnowledgeBaseDetail(knowledgeBase as KnowledgeBaseDetail, {
        documentCounts,
        jobs,
        latestSnapshots,
        availability: availability.get(knowledgeBaseRef.id),
      }),
      recentJobs,
      explorer: explorerDocuments,
      retrievalPlayground: this.buildRetrievalPlaygroundConfig(knowledgeBase as KnowledgeBaseDetail),
    };
  }

  async runRetrievalPlayground(identifier: string, request: SearchRequest) {
    const knowledgeBaseRef = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseRef.id },
      select: {
        id: true,
        slug: true,
        name: true,
        workspaceKind: true,
        defaultRetrievalProfile: true,
      },
    });
    const trace = await this.retrievalService.traceRetrieval(knowledgeBaseRef.id, request);

    return {
      knowledgeBase,
      request: {
        query: request.query,
        topK: request.topK ?? request.limit ?? null,
        tokenBudget: request.tokenBudget ?? null,
        profileKey: request.profileKey ?? knowledgeBase?.defaultRetrievalProfile ?? 'default',
        filters: request.filters ?? null,
      },
      trace,
    };
  }

  async getRecentJobs(filters: {
    knowledgeBaseId?: string;
    knowledgeBaseSlug?: string;
    sourceId?: string;
    limit?: number;
  }) {
    const limit = this.normalizeLimit(filters.limit);
    const knowledgeBase =
      filters.knowledgeBaseId || filters.knowledgeBaseSlug
        ? await this.knowledgeBasesService.resolveReference(filters.knowledgeBaseId, filters.knowledgeBaseSlug)
        : null;

    const jobs = await this.prisma.indexingJob.findMany({
      where: {
        ...(knowledgeBase ? { knowledgeBaseId: knowledgeBase.id } : {}),
        ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
      },
      include: {
        knowledgeBase: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
        source: {
          select: {
            id: true,
            type: true,
            uri: true,
            status: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });

    return {
      filters: {
        knowledgeBaseId: knowledgeBase?.id ?? null,
        knowledgeBaseSlug: knowledgeBase?.slug ?? null,
        sourceId: filters.sourceId ?? null,
        limit,
      },
      jobs: jobs.map((job) => this.buildJobSummary(job)),
    };
  }

  private async getDocumentCountsBySourceId(sourceIds: string[]) {
    if (sourceIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await this.prisma.document.groupBy({
      by: ['sourceId'],
      where: {
        sourceId: {
          in: sourceIds,
        },
      },
      _count: {
        _all: true,
      },
    });

    return new Map(rows.map((row) => [row.sourceId, row._count._all]));
  }

  private async getJobsForKnowledgeBaseIds(knowledgeBaseIds: string[]) {
    if (knowledgeBaseIds.length === 0) {
      return [] as JobWithRelations[];
    }

    return this.prisma.indexingJob.findMany({
      where: {
        knowledgeBaseId: {
          in: knowledgeBaseIds,
        },
      },
      include: {
        knowledgeBase: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
        source: {
          select: {
            id: true,
            type: true,
            uri: true,
            status: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  private async getLatestSnapshotsBySourceId(sourceIds: string[]) {
    if (sourceIds.length === 0) {
      return new Map<string, SnapshotRow>();
    }

    const snapshots = await this.prisma.sourceSnapshot.findMany({
      where: {
        sourceId: {
          in: sourceIds,
        },
      },
      select: {
        sourceId: true,
        createdAt: true,
        ref: true,
        snapshotType: true,
        fileCount: true,
        contentBytes: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const latestBySourceId = new Map<string, SnapshotRow>();
    for (const snapshot of snapshots) {
      if (!latestBySourceId.has(snapshot.sourceId)) {
        latestBySourceId.set(snapshot.sourceId, snapshot);
      }
    }

    return latestBySourceId;
  }

  private async getExplorerDocuments(knowledgeBaseId: string) {
    const documents = await this.prisma.document.findMany({
      where: {
        source: {
          knowledgeBaseId,
        },
      },
      select: {
        id: true,
        sourceId: true,
        path: true,
        mimeType: true,
        contentHash: true,
        status: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        path: 'asc',
      },
      take: EXPLORER_DOCUMENT_LIMIT,
    });

    const chunkCountByDocumentId = await this.getChunkCountsByDocumentId(documents.map((document) => document.id));

    return {
      documentLimit: EXPLORER_DOCUMENT_LIMIT,
      documents: documents.map((document) => this.buildExplorerDocument(document, chunkCountByDocumentId)),
    };
  }

  private async getChunkCountsByDocumentId(documentIds: string[]) {
    if (documentIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await this.prisma.chunk.groupBy({
      by: ['documentId'],
      where: {
        documentId: {
          in: documentIds,
        },
      },
      _count: {
        _all: true,
      },
    });

    return new Map(rows.map((row) => [row.documentId, row._count._all]));
  }

  private buildExplorerDocument(document: ExplorerDocumentRow, chunkCountByDocumentId: Map<string, number>) {
    return {
      id: document.id,
      sourceId: document.sourceId,
      path: document.path,
      mimeType: document.mimeType,
      contentHash: document.contentHash,
      status: document.status,
      chunkCount: chunkCountByDocumentId.get(document.id) ?? 0,
      metadata: document.metadata,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private buildJobStatusCounts(
    rows: Array<{
      status: JobStatus;
      _count: {
        _all: number;
      };
    }>,
  ) {
    const counts = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    };

    for (const row of rows) {
      counts[row.status] = row._count._all;
    }

    return counts;
  }

  private buildWorkspaceKindCounts(
    rows: Array<{
      workspaceKind: WorkspaceKind;
      _count: {
        _all: number;
      };
    }>,
  ) {
    const counts: Partial<Record<WorkspaceKind, number>> = {};
    for (const row of rows) {
      counts[row.workspaceKind] = row._count._all;
    }
    return counts;
  }

  private deriveQueuePressure(counts: { queued: number; running: number; succeeded: number; failed: number }) {
    if (counts.queued === 0 && counts.running === 0) {
      return 'idle';
    }

    if (counts.queued > counts.running + 2) {
      return 'backlogged';
    }

    return 'active';
  }

  private buildKnowledgeBaseListItem(
    knowledgeBase: KnowledgeBaseListItem,
    documentCounts: Map<string, number>,
    jobs: JobWithRelations[],
    availability?: WorkspaceAvailability,
  ) {
    const knowledgeBaseJobs = jobs.filter((job) => job.knowledgeBaseId === knowledgeBase.id);
    const latestJob = knowledgeBaseJobs[0] ?? null;
    const latestSuccess = knowledgeBaseJobs.find((job) => job.status === JobStatus.succeeded) ?? null;
    const documentCount = knowledgeBase.sources.reduce((sum, source) => sum + (documentCounts.get(source.id) ?? 0), 0);

    return {
      id: knowledgeBase.id,
      slug: knowledgeBase.slug,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      activeIndexVersionId: knowledgeBase.activeIndexVersionId,
      activeServingRevisionId: knowledgeBase.activeServingRevisionId,
      servingRevisionState: knowledgeBase.servingRevisionState,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      ...(availability ? { availability } : {}),
      counts: {
        sources: knowledgeBase.sources.length,
        activeSources: knowledgeBase.sources.filter((source) => source.status === 'active').length,
        documents: documentCount,
        indexVersions: knowledgeBase.indexVersions.length,
        jobs: knowledgeBaseJobs.length,
      },
      lastSuccessfulIndexAt: latestSuccess?.finishedAt ?? null,
      lastJobStatus: latestJob?.status ?? null,
      lastErrorSummary: latestJob ? this.extractLastErrorSummary(latestJob.logs) : null,
    };
  }

  private buildKnowledgeBaseDetail(
    knowledgeBase: KnowledgeBaseDetail,
    data: {
      documentCounts: Map<string, number>;
      jobs: JobWithRelations[];
      latestSnapshots: Map<string, SnapshotRow>;
      availability?: WorkspaceAvailability;
    },
  ) {
    const knowledgeBaseJobs = data.jobs.filter((job) => job.knowledgeBaseId === knowledgeBase.id);
    const latestJob = knowledgeBaseJobs[0] ?? null;
    const latestSuccess = knowledgeBaseJobs.find((job) => job.status === JobStatus.succeeded) ?? null;

    return {
      id: knowledgeBase.id,
      slug: knowledgeBase.slug,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      workspaceKind: knowledgeBase.workspaceKind,
      defaultRetrievalProfile: knowledgeBase.defaultRetrievalProfile,
      activeIndexVersionId: knowledgeBase.activeIndexVersionId,
      activeServingRevisionId: knowledgeBase.activeServingRevisionId,
      servingRevisionState: knowledgeBase.servingRevisionState,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      ...(data.availability ? { availability: data.availability } : {}),
      counts: {
        sources: knowledgeBase.sources.length,
        documents: knowledgeBase.sources.reduce((sum, source) => sum + (data.documentCounts.get(source.id) ?? 0), 0),
        indexVersions: knowledgeBase.indexVersions.length,
        jobs: knowledgeBaseJobs.length,
      },
      lastSuccessfulIndexAt: latestSuccess?.finishedAt ?? null,
      lastJobStatus: latestJob?.status ?? null,
      lastErrorSummary: latestJob ? this.extractLastErrorSummary(latestJob.logs) : null,
      activeIndexVersion:
        knowledgeBase.activeIndexVersionId === null
          ? null
          : (knowledgeBase.indexVersions.find(
              (indexVersion) => indexVersion.id === knowledgeBase.activeIndexVersionId,
            ) ?? { id: knowledgeBase.activeIndexVersionId }),
      indexVersions: knowledgeBase.indexVersions,
      sources: knowledgeBase.sources.map((source) => {
        const latestSourceJob = knowledgeBaseJobs.find((job) => job.sourceId === source.id) ?? null;
        const latestSourceSuccess =
          knowledgeBaseJobs.find((job) => job.sourceId === source.id && job.status === JobStatus.succeeded) ?? null;
        const latestSnapshot = data.latestSnapshots.get(source.id) ?? null;

        return {
          id: source.id,
          type: source.type,
          uri: source.uri,
          status: source.status,
          includeRules: source.includeRules,
          excludeRules: source.excludeRules,
          lastSyncedAt: source.lastSyncedAt,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
          documentCount: data.documentCounts.get(source.id) ?? 0,
          lastSnapshot: latestSnapshot
            ? {
                at: latestSnapshot.createdAt,
                ref: latestSnapshot.ref,
                snapshotType: latestSnapshot.snapshotType,
                fileCount: latestSnapshot.fileCount,
                contentBytes: latestSnapshot.contentBytes,
              }
            : null,
          lastSuccessfulIndexAt: latestSourceSuccess?.finishedAt ?? null,
          lastJob: latestSourceJob ? this.buildJobSummary(latestSourceJob) : null,
          lastErrorSummary: latestSourceJob ? this.extractLastErrorSummary(latestSourceJob.logs) : null,
        };
      }),
    };
  }

  private buildRetrievalPlaygroundConfig(knowledgeBase: KnowledgeBaseDetail) {
    const activeIndexVersion =
      knowledgeBase.activeIndexVersionId === null
        ? null
        : (knowledgeBase.indexVersions.find((indexVersion) => indexVersion.id === knowledgeBase.activeIndexVersionId) ??
          null);

    return {
      defaultProfileKey: knowledgeBase.defaultRetrievalProfile,
      profiles: knowledgeBase.retrievalProfiles.map((profile) => ({
        key: profile.key,
        name: profile.name,
        intent: profile.intent,
        denseTopK: profile.denseTopK,
        scoreThreshold: profile.scoreThreshold,
        neighborBefore: profile.neighborBefore,
        neighborAfter: profile.neighborAfter,
        tokenBudget: profile.tokenBudget,
        grouping: profile.grouping,
        recencyBoost: profile.recencyBoost,
      })),
      activeCollection: activeIndexVersion
        ? {
            indexVersionId: activeIndexVersion.id,
            vectorCollectionName: activeIndexVersion.vectorCollectionName,
            materializationMode: activeIndexVersion.materializationMode,
            embeddingModel: activeIndexVersion.embeddingModel,
            embeddingDimension: activeIndexVersion.embeddingDimension,
            createdAt: activeIndexVersion.createdAt,
          }
        : null,
      suggestedRequest: {
        queryPlaceholder: this.buildQueryPlaceholder(knowledgeBase.workspaceKind),
        topK: this.buildSuggestedTopK(knowledgeBase.workspaceKind),
        tokenBudget: this.buildSuggestedTokenBudget(knowledgeBase.workspaceKind),
      },
    };
  }

  private buildJobSummary(job: JobWithRelations) {
    return {
      id: job.id,
      knowledgeBase: job.knowledgeBase,
      source: job.source,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      progress: this.extractProgress(job.stats),
      lastErrorSummary: this.extractLastErrorSummary(job.logs),
      lastLogAt: this.extractLastLogAt(job.logs),
    };
  }

  private extractProgress(stats: unknown) {
    const value = this.asRecord(stats);
    const numberOrNull = (key: string) => (typeof value[key] === 'number' ? (value[key] as number) : null);

    return {
      added: numberOrNull('added'),
      changed: numberOrNull('changed'),
      deleted: numberOrNull('deleted'),
      unchanged: numberOrNull('unchanged'),
      filesScanned: numberOrNull('filesScanned'),
      filesParsed: numberOrNull('filesParsed'),
      filesIgnored: numberOrNull('filesIgnored'),
      parseFailures: numberOrNull('parseFailures'),
      chunksCreated: numberOrNull('chunksCreated'),
      vectorsDeleted: numberOrNull('vectorsDeleted'),
      vectorsUpserted: numberOrNull('vectorsUpserted'),
      documentsCreated: numberOrNull('documentsCreated'),
      documentsChanged: numberOrNull('documentsChanged'),
      documentsDeleted: numberOrNull('documentsDeleted'),
      documentsSkipped: numberOrNull('documentsSkipped'),
      validationReportId: typeof value.validationReportId === 'string' ? value.validationReportId : null,
    };
  }

  private extractLastErrorSummary(logs: unknown) {
    const entries = this.asArray(logs);

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = this.asRecord(entries[index]);
      if (entry.level !== 'error') {
        continue;
      }

      const data = this.asRecord(entry.data);
      return {
        at: typeof entry.at === 'string' ? entry.at : null,
        message: typeof entry.message === 'string' ? entry.message : 'Unknown error',
        code: typeof data.code === 'string' ? data.code : null,
        stage: typeof data.stage === 'string' ? data.stage : null,
      };
    }

    return null;
  }

  private extractLastLogAt(logs: unknown) {
    const entries = this.asArray(logs);
    const lastEntry = entries[entries.length - 1];
    const value = this.asRecord(lastEntry);
    return typeof value.at === 'string' ? value.at : null;
  }

  private normalizeLimit(limit?: number) {
    if (!limit || Number.isNaN(limit)) {
      return 10;
    }

    return Math.min(Math.max(limit, 1), 50);
  }

  private buildQueryPlaceholder(workspaceKind: WorkspaceKind) {
    if (workspaceKind === 'codebase') {
      return 'Why does the worker retry loop reopen the same source?';
    }
    if (workspaceKind === 'agent_memory' || workspaceKind === 'personal_work_history') {
      return 'What did we decide about the last deployment rollback?';
    }
    if (workspaceKind === 'ops_context') {
      return 'Show the runbook for Redis connectivity failures.';
    }

    return 'Find the most relevant context for this task.';
  }

  private buildSuggestedTopK(workspaceKind: WorkspaceKind) {
    return workspaceKind === 'codebase' ? 8 : 6;
  }

  private buildSuggestedTokenBudget(workspaceKind: WorkspaceKind) {
    if (workspaceKind === 'codebase') {
      return 1800;
    }
    if (workspaceKind === 'agent_memory' || workspaceKind === 'personal_work_history') {
      return 900;
    }
    return 1200;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }
}
