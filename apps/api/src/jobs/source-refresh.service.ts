import { Injectable } from '@nestjs/common';
import { IndexingJobType, Source, SourceType } from '@prisma/client';
import { AppException } from '../common/app-error';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { PrismaService } from '../prisma/prisma.service';
import { IndexingChangePlannerService } from './indexing-change-planner.service';
import { IndexingSourcePreparationService } from './indexing-source-preparation.service';
import { SourceRefreshMode, SourceRefreshRequestContext } from './indexing.types';
import { QueueService } from './queue.service';
import { RefreshSourceDto } from './dto/refresh-source.dto';

const DEFAULT_REFRESH_MODE: SourceRefreshMode = 'incremental';
const SUPPORTED_REFRESH_SOURCE_TYPES: SourceType[] = [
  SourceType.local_folder,
  SourceType.git_repo,
  SourceType.upload,
  SourceType.url,
  SourceType.obsidian_vault,
];

@Injectable()
export class SourceRefreshService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly queueService: QueueService,
    private readonly sourcePreparation: IndexingSourcePreparationService,
    private readonly changePlanner: IndexingChangePlannerService,
  ) {}

  async refresh(identifier: string, sourceId: string, dto: RefreshSourceDto) {
    const { knowledgeBase, source } = await this.resolveRefreshTarget(identifier, sourceId);
    const refresh = this.normalizeRefreshContext(dto);

    if (refresh.dryRun) {
      return this.buildDryRunPlan(knowledgeBase, source, refresh);
    }

    const job = await this.queueService.enqueueIndexingJob({
      knowledgeBaseId: knowledgeBase.id,
      sourceId: source.id,
      type: IndexingJobType.scan_source,
      refresh: {
        ...refresh,
        dryRun: false,
      },
    });

    return {
      dryRun: false,
      mode: refresh.mode,
      reason: refresh.reason,
      workspace: this.toWorkspaceSummary(knowledgeBase),
      source: this.toSourceSummary(source),
      job,
    };
  }

  private async buildDryRunPlan(
    knowledgeBase: Awaited<ReturnType<KnowledgeBasesService['resolveIdentifier']>>,
    source: Source,
    refresh: SourceRefreshRequestContext,
  ) {
    const preparedSource = await this.sourcePreparation.prepare(source);
    const existingDocuments = await this.prisma.document.findMany({
      where: { sourceId: source.id },
    });
    const planning = this.changePlanner.buildPlan({
      sourceId: source.id,
      workspaceKind: knowledgeBase.workspaceKind,
      files: preparedSource.files,
      existingDocuments,
    });

    return {
      dryRun: true,
      mode: refresh.mode,
      reason: refresh.reason,
      workspace: this.toWorkspaceSummary(knowledgeBase),
      source: this.toSourceSummary(source),
      preparedSource: {
        scanRoot: preparedSource.scanRoot,
        git: preparedSource.gitMetadata,
        upload: preparedSource.uploadMetadata,
        url: preparedSource.urlMetadata,
        obsidian: preparedSource.obsidianMetadata,
      },
      plan: {
        stats: planning.stats,
        addedPaths: planning.plan.parsedFiles
          .filter((item) => item.changeType === 'added')
          .map((item) => item.file.relativePath),
        changedPaths: planning.plan.parsedFiles
          .filter((item) => item.changeType === 'changed')
          .map((item) => item.file.relativePath),
        unchangedCount: planning.stats.unchanged,
        deletedPaths: planning.plan.deletedDocuments.map((item) => item.path),
        dependencyHints: planning.plan.dependencyHints,
        validationIssues: planning.validationIssues,
      },
    };
  }

  private async resolveRefreshTarget(identifier: string, sourceId: string) {
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
        'refresh_source',
        false,
        { workspaceId: knowledgeBase.id, workspaceSlug: knowledgeBase.slug, sourceId },
      );
    }

    if (!SUPPORTED_REFRESH_SOURCE_TYPES.includes(source.type)) {
      throw new AppException(
        'source_refresh_unsupported_type',
        'Source refresh is only supported for local_folder, git_repo, upload, url, and obsidian_vault sources',
        'refresh_source',
        false,
        { sourceId: source.id, sourceType: source.type },
      );
    }

    if (source.status === 'disabled') {
      throw new AppException(
        'source_refresh_disabled',
        'Disabled sources cannot be refreshed',
        'refresh_source',
        false,
        { sourceId: source.id },
      );
    }

    return { knowledgeBase, source };
  }

  private normalizeRefreshContext(dto: RefreshSourceDto): SourceRefreshRequestContext {
    return {
      mode: dto.mode || DEFAULT_REFRESH_MODE,
      reason: dto.reason?.trim() || undefined,
      dryRun: dto.dryRun || false,
      trigger: 'manual',
      triggerMetadata: dto.storageProfile ? { storageProfile: dto.storageProfile } : undefined,
    };
  }

  private toWorkspaceSummary(knowledgeBase: {
    id: string;
    slug: string;
    name: string;
    workspaceKind: string;
  }) {
    return {
      id: knowledgeBase.id,
      slug: knowledgeBase.slug,
      name: knowledgeBase.name,
      workspaceKind: knowledgeBase.workspaceKind,
    };
  }

  private toSourceSummary(source: Source) {
    return {
      id: source.id,
      type: source.type,
      uri: source.uri,
      status: source.status,
    };
  }
}
