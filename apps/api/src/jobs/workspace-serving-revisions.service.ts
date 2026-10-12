import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  IndexBuildStatus,
  Prisma,
  SourceRevisionStatus,
  WorkspaceServingRevisionStatus,
  WorkspaceServingState,
  WorkspaceVectorPlacementState,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const CURRENT_PARSER_VERSION = 'builtin-parser-v1';
export const CURRENT_VECTOR_PAYLOAD_SCHEMA_VERSION = 'qdrant-chunk-payload-v2';

export type PreparedServingBuild = {
  sourceRevisionId: string;
  workspaceServingRevisionId: string;
  indexBuildId: string;
  manifestHash: string;
  missingSourceIds: string[];
};

type PrepareServingBuildInput = {
  knowledgeBaseId: string;
  sourceId: string;
  sourceSnapshotId: string;
  sourceContentHash: string;
  documentCount: number;
  parserVersion?: string;
  indexVersionId: string;
  physicalCollectionName: string;
  storageProfile: string;
  embeddingProfileSnapshot: Record<string, unknown>;
  chunkingProfileSnapshot: Record<string, unknown>;
  payloadSchemaVersion?: string;
  resourceEstimate?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type FinalizeServingBuildInput = PreparedServingBuild & {
  knowledgeBaseId: string;
  physicalCollectionName: string;
  validationSummary?: Record<string, unknown>;
  resourceObserved?: Record<string, unknown>;
};

@Injectable()
export class WorkspaceServingRevisionsService {
  constructor(private readonly prisma: PrismaService) {}

  async prepareBuild(input: PrepareServingBuildInput): Promise<PreparedServingBuild> {
    return this.prisma.$transaction(async (tx) => {
      const parserVersion = input.parserVersion || CURRENT_PARSER_VERSION;
      const payloadSchemaVersion = input.payloadSchemaVersion || CURRENT_VECTOR_PAYLOAD_SCHEMA_VERSION;
      const sourceRevision = await tx.sourceRevision.upsert({
        where: { sourceSnapshotId: input.sourceSnapshotId },
        create: {
          sourceId: input.sourceId,
          knowledgeBaseId: input.knowledgeBaseId,
          sourceSnapshotId: input.sourceSnapshotId,
          contentHash: input.sourceContentHash,
          parserVersion,
          documentCount: input.documentCount,
          status: SourceRevisionStatus.building,
          metadata: (input.metadata || {}) as Prisma.InputJsonValue,
        },
        update: {},
      });

      const [workspaceSources, workspace] = await Promise.all([
        tx.source.findMany({
          where: {
            knowledgeBaseId: input.knowledgeBaseId,
          },
          select: { id: true, status: true },
          orderBy: { id: 'asc' },
        }),
        tx.knowledgeBase.findUnique({
          where: { id: input.knowledgeBaseId },
          select: {
            activeServingRevision: {
              select: {
                manifestEntries: {
                  select: {
                    sourceRevision: {
                      select: { id: true, sourceId: true },
                    },
                  },
                  orderBy: { position: 'asc' },
                },
              },
            },
          },
        }),
      ]);
      const activeSourceIds = workspaceSources
        .filter((source) => !source.status || String(source.status) === 'active')
        .map((source) => source.id);
      const inactiveSourceIds = workspaceSources
        .filter((source) => source.status && String(source.status) !== 'active')
        .map((source) => source.id);
      const readyRevisions = activeSourceIds.length
        ? await tx.sourceRevision.findMany({
            where: {
              sourceId: { in: activeSourceIds },
              status: SourceRevisionStatus.ready,
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      const revisionBySourceId = new Map<string, { id: string; sourceId: string }>();
      for (const entry of workspace?.activeServingRevision?.manifestEntries || []) {
        revisionBySourceId.set(entry.sourceRevision.sourceId, entry.sourceRevision);
      }
      revisionBySourceId.set(input.sourceId, sourceRevision);
      if (!workspace?.activeServingRevision) {
        for (const revision of readyRevisions) {
          if (!revisionBySourceId.has(revision.sourceId)) {
            revisionBySourceId.set(revision.sourceId, revision);
          }
        }
      }

      const manifestEntries = activeSourceIds
        .map((sourceId) => ({
          sourceId,
          sourceRevisionId: revisionBySourceId.get(sourceId)?.id,
        }))
        .filter((entry): entry is { sourceId: string; sourceRevisionId: string } => Boolean(entry.sourceRevisionId));
      const missingSourceIds = activeSourceIds.filter((sourceId) => !revisionBySourceId.has(sourceId));
      const manifestHash = this.computeManifestHash({
        knowledgeBaseId: input.knowledgeBaseId,
        sources: manifestEntries,
        missingSourceIds,
        embeddingProfileSnapshot: input.embeddingProfileSnapshot,
        chunkingProfileSnapshot: input.chunkingProfileSnapshot,
        payloadSchemaVersion,
      });

      const servingRevision = await tx.workspaceServingRevision.upsert({
        where: {
          knowledgeBaseId_manifestHash: {
            knowledgeBaseId: input.knowledgeBaseId,
            manifestHash,
          },
        },
        create: {
          knowledgeBaseId: input.knowledgeBaseId,
          manifestHash,
          embeddingProfileSnapshot: input.embeddingProfileSnapshot as Prisma.InputJsonValue,
          chunkingProfileSnapshot: input.chunkingProfileSnapshot as Prisma.InputJsonValue,
          payloadSchemaVersion,
          status: WorkspaceServingRevisionStatus.building,
          metadata: {
            ...(input.metadata || {}),
            complete: missingSourceIds.length === 0,
            activeSourceIds,
            inactiveSourceIds,
            missingSourceIds,
          } as Prisma.InputJsonValue,
          manifestEntries: {
            create: manifestEntries.map((entry, position) => ({
              sourceRevisionId: entry.sourceRevisionId,
              position,
            })),
          },
        },
        update: {},
      });

      const indexBuild = await tx.indexBuild.upsert({
        where: { indexVersionId: input.indexVersionId },
        create: {
          knowledgeBaseId: input.knowledgeBaseId,
          workspaceServingRevisionId: servingRevision.id,
          sourceRevisionId: sourceRevision.id,
          indexVersionId: input.indexVersionId,
          buildKind: 'incremental_source',
          physicalCollectionName: input.physicalCollectionName,
          storageProfile: input.storageProfile,
          configSnapshot: {
            embeddingProfile: input.embeddingProfileSnapshot,
            chunkingProfile: input.chunkingProfileSnapshot,
            payloadSchemaVersion,
          } as Prisma.InputJsonValue,
          resourceEstimate: (input.resourceEstimate || {}) as Prisma.InputJsonValue,
          status: IndexBuildStatus.building,
        },
        update: {},
      });

      return {
        sourceRevisionId: sourceRevision.id,
        workspaceServingRevisionId: servingRevision.id,
        indexBuildId: indexBuild.id,
        manifestHash,
        missingSourceIds,
      };
    });
  }

  async finalizeBuild(input: FinalizeServingBuildInput) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const [activeSources, servingRevision, knowledgeBase, sourceRevision, indexBuild] = await Promise.all([
        tx.source.findMany({
          where: {
            knowledgeBaseId: input.knowledgeBaseId,
            status: 'active',
          },
          select: { id: true },
          orderBy: { id: 'asc' },
        }),
        tx.workspaceServingRevision.findUnique({
          where: { id: input.workspaceServingRevisionId },
          include: {
            manifestEntries: {
              include: { sourceRevision: true },
              orderBy: { position: 'asc' },
            },
          },
        }),
        tx.knowledgeBase.findUnique({
          where: { id: input.knowledgeBaseId },
          select: { activeServingRevisionId: true },
        }),
        tx.sourceRevision.findUnique({
          where: { id: input.sourceRevisionId },
        }),
        tx.indexBuild.findUnique({ where: { id: input.indexBuildId } }),
      ]);

      if (
        !servingRevision ||
        servingRevision.knowledgeBaseId !== input.knowledgeBaseId ||
        servingRevision.manifestHash !== input.manifestHash
      ) {
        throw new Error('Workspace serving revision not found for build');
      }
      if (!knowledgeBase) {
        throw new Error('Workspace not found for serving revision activation');
      }
      const validationStatus = input.validationSummary?.status;
      if (validationStatus !== 'passed' && validationStatus !== 'warning') {
        throw new Error('Index build validation did not pass');
      }
      if (
        !sourceRevision ||
        sourceRevision.knowledgeBaseId !== input.knowledgeBaseId ||
        (sourceRevision.status !== SourceRevisionStatus.building &&
          sourceRevision.status !== SourceRevisionStatus.ready)
      ) {
        throw new Error('Source revision is not eligible for serving activation');
      }
      if (
        servingRevision.status !== WorkspaceServingRevisionStatus.building &&
        servingRevision.status !== WorkspaceServingRevisionStatus.ready
      ) {
        throw new Error('Workspace serving revision is not eligible for activation');
      }
      if (
        !indexBuild ||
        indexBuild.knowledgeBaseId !== input.knowledgeBaseId ||
        indexBuild.workspaceServingRevisionId !== input.workspaceServingRevisionId ||
        indexBuild.sourceRevisionId !== input.sourceRevisionId ||
        (indexBuild.status !== IndexBuildStatus.building && indexBuild.status !== IndexBuildStatus.validating)
      ) {
        throw new Error('Index build is not eligible for serving activation');
      }

      await tx.sourceRevision.update({
        where: { id: input.sourceRevisionId },
        data: {
          status: SourceRevisionStatus.ready,
          validationSummary: (input.validationSummary || {}) as Prisma.InputJsonValue,
        },
      });

      const activeSourceIds = activeSources.map((source) => source.id);
      const entrySourceIds = servingRevision.manifestEntries.map((entry) => entry.sourceRevision.sourceId);
      const readyEntrySourceIds = new Set(
        servingRevision.manifestEntries
          .filter(
            (entry) =>
              entry.sourceRevision.id === input.sourceRevisionId ||
              entry.sourceRevision.status === SourceRevisionStatus.ready,
          )
          .map((entry) => entry.sourceRevision.sourceId),
      );
      const missingSourceIds = activeSourceIds.filter((sourceId) => !readyEntrySourceIds.has(sourceId));
      const unexpectedSourceIds = entrySourceIds.filter((sourceId) => !activeSourceIds.includes(sourceId));
      const currentEntry = servingRevision.manifestEntries.find(
        (entry) => entry.sourceRevision.id === input.sourceRevisionId,
      );
      const complete =
        activeSourceIds.length > 0 &&
        Boolean(currentEntry) &&
        missingSourceIds.length === 0 &&
        unexpectedSourceIds.length === 0 &&
        entrySourceIds.length === activeSourceIds.length;

      await tx.indexBuild.update({
        where: { id: input.indexBuildId },
        data: {
          status: complete ? IndexBuildStatus.active : IndexBuildStatus.ready,
          validationSummary: (input.validationSummary || {}) as Prisma.InputJsonValue,
          resourceObserved: (input.resourceObserved || {}) as Prisma.InputJsonValue,
          finishedAt: now,
        },
      });

      if (!complete) {
        await tx.workspaceServingRevision.update({
          where: { id: input.workspaceServingRevisionId },
          data: {
            status: WorkspaceServingRevisionStatus.reconciliation_required,
            metadata: {
              ...this.asRecord(servingRevision.metadata),
              complete: false,
              activeSourceIds,
              missingSourceIds,
              unexpectedSourceIds,
            } as Prisma.InputJsonValue,
          },
        });
        await tx.knowledgeBase.update({
          where: { id: input.knowledgeBaseId },
          data: {
            servingRevisionState: WorkspaceServingState.reconciliation_required,
          },
        });

        return {
          activated: false,
          state: WorkspaceServingState.reconciliation_required,
          missingSourceIds,
          unexpectedSourceIds,
          supersededSourceRevisionIds: [],
        };
      }

      if (!currentEntry) {
        throw new Error('Current source revision is missing from serving manifest');
      }

      await tx.sourceRevision.updateMany({
        where: {
          sourceId: currentEntry.sourceRevision.sourceId,
          id: { not: input.sourceRevisionId },
          status: SourceRevisionStatus.ready,
        },
        data: { status: SourceRevisionStatus.superseded },
      });
      await tx.workspaceServingRevision.update({
        where: { id: input.workspaceServingRevisionId },
        data: {
          status: WorkspaceServingRevisionStatus.active,
          activatedAt: now,
          metadata: {
            ...this.asRecord(servingRevision.metadata),
            complete: true,
            activeSourceIds,
            missingSourceIds: [],
            unexpectedSourceIds: [],
          } as Prisma.InputJsonValue,
        },
      });
      const pointerUpdate = await tx.knowledgeBase.updateMany({
        where: {
          id: input.knowledgeBaseId,
          activeServingRevisionId: knowledgeBase.activeServingRevisionId,
        },
        data: {
          activeServingRevisionId: input.workspaceServingRevisionId,
          activeIndexVersionId: indexBuild.indexVersionId,
          servingRevisionState: WorkspaceServingState.active,
        },
      });
      if (pointerUpdate.count !== 1) {
        throw new Error('Workspace serving revision changed during activation');
      }
      await tx.workspaceVectorPlacement.update({
        where: { knowledgeBaseId: input.knowledgeBaseId },
        data: {
          servingRevisionId: input.workspaceServingRevisionId,
          activeIndexBuildId: input.indexBuildId,
          physicalCollectionName: input.physicalCollectionName,
          state: WorkspaceVectorPlacementState.loaded,
        },
      });

      const supersededSourceRevisionIds = knowledgeBase.activeServingRevisionId
        ? (
            await tx.workspaceServingRevision.findUnique({
              where: { id: knowledgeBase.activeServingRevisionId },
              include: {
                manifestEntries: {
                  include: { sourceRevision: { select: { id: true, sourceId: true } } },
                },
              },
            })
          )?.manifestEntries
            .filter((entry) => entry.sourceRevision.sourceId === currentEntry.sourceRevision.sourceId)
            .map((entry) => entry.sourceRevision.id)
            .filter((id) => id !== input.sourceRevisionId) || []
        : [];

      if (knowledgeBase.activeServingRevisionId) {
        await tx.workspaceServingRevision.updateMany({
          where: {
            id: knowledgeBase.activeServingRevisionId,
            status: WorkspaceServingRevisionStatus.active,
          },
          data: { status: WorkspaceServingRevisionStatus.archived },
        });
        await tx.indexBuild.updateMany({
          where: {
            workspaceServingRevisionId: knowledgeBase.activeServingRevisionId,
            status: IndexBuildStatus.active,
          },
          data: { status: IndexBuildStatus.archived },
        });
      }

      return {
        activated: true,
        state: WorkspaceServingState.active,
        missingSourceIds: [],
        unexpectedSourceIds: [],
        supersededSourceRevisionIds,
      };
    });
  }

  async failBuild(input: PreparedServingBuild & { knowledgeBaseId: string; reason: string }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.indexBuild.updateMany({
        where: {
          id: input.indexBuildId,
          status: { in: [IndexBuildStatus.building, IndexBuildStatus.validating] },
        },
        data: {
          status: IndexBuildStatus.failed,
          validationSummary: { error: input.reason },
          finishedAt: new Date(),
        },
      });
      await tx.sourceRevision.updateMany({
        where: {
          id: input.sourceRevisionId,
          status: SourceRevisionStatus.building,
        },
        data: {
          status: SourceRevisionStatus.failed,
          validationSummary: { error: input.reason },
        },
      });
      await tx.workspaceServingRevision.updateMany({
        where: {
          id: input.workspaceServingRevisionId,
          status: WorkspaceServingRevisionStatus.building,
        },
        data: { status: WorkspaceServingRevisionStatus.failed },
      });

      const workspace = await tx.knowledgeBase.findUnique({
        where: { id: input.knowledgeBaseId },
        select: { activeServingRevisionId: true },
      });
      if (!workspace?.activeServingRevisionId) {
        await tx.knowledgeBase.update({
          where: { id: input.knowledgeBaseId },
          data: { servingRevisionState: WorkspaceServingState.failed },
        });
      }
    });
  }

  computeManifestHash(value: {
    knowledgeBaseId: string;
    sources: Array<{ sourceId: string; sourceRevisionId: string }>;
    missingSourceIds: string[];
    embeddingProfileSnapshot: Record<string, unknown>;
    chunkingProfileSnapshot: Record<string, unknown>;
    payloadSchemaVersion: string;
  }): string {
    const canonical = {
      knowledgeBaseId: value.knowledgeBaseId,
      sources: [...value.sources].sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
      missingSourceIds: [...value.missingSourceIds].sort(),
      embeddingProfileSnapshot: value.embeddingProfileSnapshot,
      chunkingProfileSnapshot: value.chunkingProfileSnapshot,
      payloadSchemaVersion: value.payloadSchemaVersion,
    };
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(this.canonicalize(canonical)), 'utf8')
      .digest('hex');
  }

  private canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.canonicalize(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.canonicalize(item)]),
      );
    }
    return value;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }
}
