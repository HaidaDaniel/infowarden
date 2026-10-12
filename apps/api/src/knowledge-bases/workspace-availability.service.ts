import { Injectable } from '@nestjs/common';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { RuntimeEmbeddingProviderConfig } from '../providers/providers.service';
import { PrismaService } from '../prisma/prisma.service';

const WORKSPACE_PREFLIGHT_TIMEOUT_MS = 2_000;

export type WorkspaceAvailability = {
  status: 'available' | 'unavailable' | 'unindexed';
  reason?: string;
  retryable?: boolean;
  provider?: {
    source: RuntimeEmbeddingProviderConfig['source'];
    name: string;
    model: string;
    dimension: number;
  };
};

export type WorkspaceAvailabilityInput = {
  id: string;
  defaultIndexProfile?: string | null;
  activeIndexVersionId?: string | null;
};

export const UNINDEXED_WORKSPACE_AVAILABILITY: WorkspaceAvailability = {
  status: 'unindexed',
  reason: 'active_index_missing',
  retryable: false,
};

@Injectable()
export class WorkspaceAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  async evaluate(workspaces: WorkspaceAvailabilityInput[]): Promise<Map<string, WorkspaceAvailability>> {
    const availability = new Map<string, WorkspaceAvailability>();
    const indexedWorkspaces = workspaces.filter(
      (workspace): workspace is WorkspaceAvailabilityInput & { activeIndexVersionId: string } =>
        Boolean(workspace.activeIndexVersionId),
    );

    for (const workspace of workspaces) {
      if (!workspace.activeIndexVersionId) {
        availability.set(workspace.id, UNINDEXED_WORKSPACE_AVAILABILITY);
      }
    }

    if (indexedWorkspaces.length === 0) {
      return availability;
    }

    const indexVersions = await this.prisma.indexVersion.findMany({
      where: {
        id: { in: [...new Set(indexedWorkspaces.map((workspace) => workspace.activeIndexVersionId))] },
      },
      select: {
        id: true,
        embeddingModel: true,
        embeddingDimension: true,
      },
    });
    const indexVersionById = new Map(indexVersions.map((indexVersion) => [indexVersion.id, indexVersion]));
    const preflights = new Map<string, Promise<WorkspaceAvailability>>();

    await Promise.all(
      indexedWorkspaces.map(async (workspace) => {
        const indexVersion = indexVersionById.get(workspace.activeIndexVersionId);
        if (!indexVersion) {
          availability.set(workspace.id, {
            status: 'unavailable',
            reason: 'active_index_version_missing',
            retryable: false,
          });
          return;
        }

        try {
          const provider = await this.embeddingsService.resolveProvider({
            knowledgeBase: {
              id: workspace.id,
              defaultIndexProfile: workspace.defaultIndexProfile,
            },
            indexVersion,
            purpose: 'health',
          });
          const providerSummary = this.providerSummary(provider);

          if (provider.reindexRequired) {
            availability.set(workspace.id, {
              status: 'unavailable',
              reason: 'embedding_reindex_required',
              retryable: false,
              provider: providerSummary,
            });
            return;
          }

          const key = [
            provider.providerConfigId || provider.source,
            provider.baseUrl,
            provider.model,
            provider.dimension,
          ].join('|');
          if (!preflights.has(key)) {
            preflights.set(
              key,
              this.preflight({
                ...provider,
                timeoutMs: Math.min(provider.timeoutMs, WORKSPACE_PREFLIGHT_TIMEOUT_MS),
              }),
            );
          }
          const preflight = preflights.get(key)!;
          availability.set(workspace.id, await preflight);
        } catch {
          availability.set(workspace.id, {
            status: 'unavailable',
            reason: 'embedding_provider_unavailable',
            retryable: true,
          });
        }
      }),
    );

    return availability;
  }

  private async preflight(provider: RuntimeEmbeddingProviderConfig): Promise<WorkspaceAvailability> {
    const result = await this.embeddingsService.preflight(provider);
    const summary = this.providerSummary(provider);
    if (result.status === 'up') {
      return {
        status: 'available',
        retryable: false,
        provider: summary,
      };
    }

    return {
      status: 'unavailable',
      reason: result.error?.code || 'embedding_provider_unavailable',
      retryable: result.error?.retryable ?? result.status === 'down',
      provider: summary,
    };
  }

  private providerSummary(provider: RuntimeEmbeddingProviderConfig) {
    return {
      source: provider.source,
      name: provider.name,
      model: provider.model,
      dimension: provider.dimension,
    };
  }
}
