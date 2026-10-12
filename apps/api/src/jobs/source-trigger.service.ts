import { HttpStatus, Injectable } from '@nestjs/common';
import { IndexingJobType, Source, SourceType } from '@prisma/client';
import { AppException } from '../common/app-error';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { PrismaService } from '../prisma/prisma.service';
import { readSourceSyncPolicy, SourceSyncPolicy } from '../sources/source-sync-policy';
import { SourceRefreshRequestContext } from './indexing.types';
import { QueueService } from './queue.service';

const SUPPORTED_TRIGGER_SOURCE_TYPES: SourceType[] = [
  SourceType.local_folder,
  SourceType.git_repo,
  SourceType.upload,
  SourceType.url,
  SourceType.obsidian_vault,
];

export type SourceTriggerKind = 'schedule' | 'webhook' | 'watch';

@Injectable()
export class SourceTriggerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly queueService: QueueService,
  ) {}

  async enqueueTriggeredRefresh(
    identifier: string,
    sourceId: string,
    trigger: SourceTriggerKind,
    triggerMetadata: Record<string, unknown> = {},
  ) {
    const { source } = await this.resolveTriggerTarget(identifier, sourceId);
    return this.enqueueTriggeredRefreshForSource(source, trigger, triggerMetadata);
  }

  async enqueueTriggeredRefreshForSource(
    source: Source,
    trigger: SourceTriggerKind,
    triggerMetadata: Record<string, unknown> = {},
  ) {
    const policy = this.assertPolicy(source, trigger);
    const refresh: SourceRefreshRequestContext = {
      mode: policy.mode,
      reason: policy.reason || `${trigger} source refresh`,
      trigger,
      triggerMetadata: {
        triggerMode: policy.triggerMode,
        sourceId: source.id,
        ...triggerMetadata,
      },
    };

    const job = await this.queueService.enqueueIndexingJob({
      knowledgeBaseId: source.knowledgeBaseId,
      sourceId: source.id,
      type: IndexingJobType.scan_source,
      refresh,
    });

    return {
      trigger,
      mode: refresh.mode,
      reason: refresh.reason,
      source: {
        id: source.id,
        type: source.type,
        uri: source.uri,
        status: source.status,
      },
      job,
    };
  }

  async resolveSource(sourceId: string): Promise<Source> {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });

    if (!source) {
      throw new AppException(
        'source_not_found',
        'Source was not found',
        'source_trigger',
        false,
        { sourceId },
        HttpStatus.NOT_FOUND,
      );
    }

    this.assertRefreshable(source);
    return source;
  }

  getPolicy(source: Source): SourceSyncPolicy | undefined {
    return readSourceSyncPolicy(source.metadata);
  }

  private async resolveTriggerTarget(identifier: string, sourceId: string) {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const source = await this.prisma.source.findFirst({
      where: {
        id: sourceId,
        knowledgeBaseId: knowledgeBase.id,
      },
    });

    if (!source) {
      throw new AppException(
        'source_not_found',
        'Source was not found in the requested workspace',
        'source_trigger',
        false,
        { workspaceId: knowledgeBase.id, workspaceSlug: knowledgeBase.slug, sourceId },
        HttpStatus.NOT_FOUND,
      );
    }

    this.assertRefreshable(source);
    return { knowledgeBase, source };
  }

  private assertRefreshable(source: Source): void {
    if (!SUPPORTED_TRIGGER_SOURCE_TYPES.includes(source.type)) {
      throw new AppException(
        'source_trigger_unsupported_type',
        'Source triggers are only supported for local_folder, git_repo, upload, url, and obsidian_vault sources',
        'source_trigger',
        false,
        { sourceId: source.id, sourceType: source.type },
      );
    }

    if (source.status === 'disabled') {
      throw new AppException(
        'source_trigger_disabled',
        'Disabled sources cannot be refreshed by triggers',
        'source_trigger',
        false,
        { sourceId: source.id },
      );
    }
  }

  private assertPolicy(source: Source, trigger: SourceTriggerKind): SourceSyncPolicy {
    this.assertRefreshable(source);
    const policy = this.getPolicy(source);

    if (!policy || policy.enabled === false || policy.triggerMode !== trigger) {
      throw new AppException(
        'source_trigger_not_enabled',
        `Source is not configured for ${trigger} refresh`,
        'source_trigger',
        false,
        { sourceId: source.id, trigger },
      );
    }

    return policy;
  }
}
