import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-error';
import { VectorBackend, VectorBackendState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { positiveNumber, record } from './vector-placement.utils';

const BUILD_HEADROOM_MULTIPLIER = 2;
const RESERVED_CAPACITY_FRACTION = 0.2;

type CapacitySnapshot = {
  requiredDiskBytes: number;
  requiredRamBytes: number;
  usedDiskBytes: number;
  usedRamBytes: number;
  reserveDiskBytes: number;
  reserveRamBytes: number;
  freeDiskAfterReserveBytes: number;
  freeRamAfterReserveBytes: number;
  candidateBuildMultiplier: number;
};

export type CapacityCandidate = {
  backend: VectorBackend;
  snapshot: CapacitySnapshot;
};

@Injectable()
export class VectorBackendSelector {
  constructor(private readonly prisma: PrismaService) {}

  async selectCapacityAssistedBackend(knowledgeBaseId: string) {
    const backends = await this.prisma.vectorBackend.findMany({
      where: { state: VectorBackendState.enabled },
      orderBy: { name: 'asc' },
    });
    const candidates = await Promise.all(backends.map((backend) => this.capacityCandidate(backend, knowledgeBaseId)));
    const eligible = candidates.filter((candidate): candidate is CapacityCandidate => Boolean(candidate));
    if (eligible.length === 0) {
      throw new AppException(
        'workspace_vector_backend_capacity_unavailable',
        'No healthy compatible vector backend has reserved capacity',
        'workspace_vector_placement_select',
        false,
        { knowledgeBaseId },
      );
    }
    eligible.sort(
      (left, right) =>
        right.snapshot.freeDiskAfterReserveBytes - left.snapshot.freeDiskAfterReserveBytes ||
        right.snapshot.freeRamAfterReserveBytes - left.snapshot.freeRamAfterReserveBytes ||
        left.backend.name.localeCompare(right.backend.name),
    );
    return eligible[0];
  }

  async requireEligibleBackend(vectorBackendId: string, knowledgeBaseId: string) {
    const backend = await this.prisma.vectorBackend.findUnique({
      where: { id: vectorBackendId },
    });
    if (!backend) {
      throw new AppException(
        'vector_backend_not_found',
        'Vector backend was not found',
        'workspace_vector_placement_pin',
        false,
        { vectorBackendId },
      );
    }
    const candidate = await this.capacityCandidate(backend, knowledgeBaseId);
    if (!candidate) {
      throw new AppException(
        'workspace_vector_backend_not_eligible',
        'Vector backend is disabled, unhealthy, incompatible, or lacks reserved capacity',
        'workspace_vector_placement_pin',
        false,
        { vectorBackendId },
      );
    }
    return candidate;
  }

  private async capacityCandidate(backend: VectorBackend, knowledgeBaseId: string): Promise<CapacityCandidate | null> {
    const health = record(backend.healthMetadata);
    if (backend.state !== 'enabled' || health.healthy !== true || health.compatible !== true) {
      return null;
    }
    const hints = record(backend.capacityHints);
    const diskBytes = positiveNumber(hints.diskBytes);
    const ramBytes = positiveNumber(hints.ramBytes);
    const maxWorkspaces = positiveNumber(hints.maxWorkspaces);
    if (!diskBytes || !ramBytes || !maxWorkspaces) return null;
    const [placements, workspace] = await Promise.all([
      this.prisma.workspaceVectorPlacement.findMany({
        where: { vectorBackendId: backend.id },
        select: { capacitySnapshot: true },
      }),
      this.prisma.knowledgeBase.findUnique({
        where: { id: knowledgeBaseId },
        select: { activeIndexVersionId: true },
      }),
    ]);
    const index = workspace?.activeIndexVersionId
      ? await this.prisma.indexVersion.findUnique({
          where: { id: workspace.activeIndexVersionId },
        })
      : null;
    const estimate = record(index?.resourceEstimate);
    const requiredDiskBytes = positiveNumber(estimate.qdrantDiskBytesHigh);
    const requiredRamBytes = positiveNumber(estimate.estimatedRamBytes);
    const usedDiskBytes = placements.reduce(
      (sum, placement) => sum + positiveNumber(record(placement.capacitySnapshot).requiredDiskBytes),
      0,
    );
    const usedRamBytes = placements.reduce(
      (sum, placement) => sum + positiveNumber(record(placement.capacitySnapshot).requiredRamBytes),
      0,
    );
    const reserveDiskBytes = Math.max(
      positiveNumber(hints.reserveDiskBytes),
      Math.round(diskBytes * RESERVED_CAPACITY_FRACTION),
    );
    const reserveRamBytes = Math.max(
      positiveNumber(hints.reserveRamBytes),
      Math.round(ramBytes * RESERVED_CAPACITY_FRACTION),
    );
    const freeDiskAfterReserveBytes =
      diskBytes - reserveDiskBytes - usedDiskBytes - requiredDiskBytes * BUILD_HEADROOM_MULTIPLIER;
    const freeRamAfterReserveBytes =
      ramBytes - reserveRamBytes - usedRamBytes - requiredRamBytes * BUILD_HEADROOM_MULTIPLIER;
    if (placements.length >= maxWorkspaces || freeDiskAfterReserveBytes < 0 || freeRamAfterReserveBytes < 0) {
      return null;
    }
    return {
      backend,
      snapshot: {
        requiredDiskBytes,
        requiredRamBytes,
        usedDiskBytes,
        usedRamBytes,
        reserveDiskBytes,
        reserveRamBytes,
        freeDiskAfterReserveBytes,
        freeRamAfterReserveBytes,
        candidateBuildMultiplier: BUILD_HEADROOM_MULTIPLIER,
      },
    };
  }
}
