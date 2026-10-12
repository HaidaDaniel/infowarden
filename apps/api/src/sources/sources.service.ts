import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { CreateSourceDto, GitSourceConfigDto, UrlSourceConfigDto } from './dto/create-source.dto';
import {
  SourceSyncPolicyDto,
  SourceTruthPolicyDto,
  UpdateSourceDto,
  UpdateSourcePolicyDto,
} from './dto/update-source.dto';
import { SourceType } from './enums/source.enums';
import {
  normalizePlainMetadata,
  normalizeSourceTruthPolicy,
  normalizeSourceSyncPolicy,
  parseScheduleIntervalMs,
  readSourceSyncPolicy,
  readSourceTruthPolicy,
} from './source-sync-policy';
import * as path from 'path';

type SourceMetadata = {
  branch?: string;
  commit?: string;
  clonePath?: string;
  credentialsRef?: string;
  sourceTruthPolicy?: ReturnType<typeof normalizeSourceTruthPolicy>;
  syncPolicy?: ReturnType<typeof normalizeSourceSyncPolicy>;
  maxPages?: number;
  maxBytesPerPage?: number;
  totalMaxBytes?: number;
  timeoutMs?: number;
  sameHost?: boolean;
  respectRobots?: boolean;
  obsidian?: {
    defaultExcludes: string[];
    attachmentPatterns: string[];
    readOnly: true;
  };
  [key: string]: unknown;
};

const OBSIDIAN_DEFAULT_EXCLUDES = [
  '**/.obsidian/**',
  '**/.trash/**',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/*.canvas',
];

const OBSIDIAN_ATTACHMENT_PATTERNS = [
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.webp',
  '**/*.svg',
  '**/*.pdf',
  '**/*.mp3',
  '**/*.mp4',
  '**/*.mov',
];

export type ManagedUploadSourceMetadata = {
  managed: true;
  uploadId: string;
  originalFileName: string;
  archiveFormat: 'single_file' | 'zip';
  storageRoot: string;
  originalPath: string;
  extractedPath: string;
  sizeBytes: number;
  fileCount: number;
  contentBytes: number;
  uploadedAt: string;
  cleanupStrategy: 'manual';
};

@Injectable()
export class SourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
  ) {}

  async create(dto: CreateSourceDto) {
    this.validateCreateInput(dto);
    const knowledgeBase = await this.knowledgeBasesService.resolveReference(
      dto.knowledgeBaseId,
      dto.knowledgeBaseSlug,
    );

    return this.prisma.source.create({
      data: this.buildCreateData(dto, knowledgeBase.id),
    });
  }

  async createOrReuse(dto: CreateSourceDto) {
    this.validateCreateInput(dto);
    const knowledgeBase = await this.knowledgeBasesService.resolveReference(
      dto.knowledgeBaseId,
      dto.knowledgeBaseSlug,
    );
    const createData = this.buildCreateData(dto, knowledgeBase.id);
    const includeRules = dto.includeRules || [];
    const excludeRules = this.defaultExcludeRules(dto.type, dto.excludeRules);
    const metadata = this.buildSourceMetadata(dto) as Prisma.InputJsonValue;

    const existing = await this.prisma.source.findFirst({
      where: {
        knowledgeBaseId: knowledgeBase.id,
        type: createData.type,
        uri: createData.uri,
        includeRules: { equals: includeRules },
        excludeRules: { equals: excludeRules },
        metadata: { equals: metadata },
      },
    });

    if (existing) {
      return {
        source: existing,
        created: false,
      };
    }

    return {
      source: await this.prisma.source.create({
        data: createData,
      }),
      created: true,
    };
  }

  async createManagedUploadSource(input: {
    knowledgeBaseId: string;
    uploadId: string;
    includeRules?: string[];
    excludeRules?: string[];
    metadata: ManagedUploadSourceMetadata;
  }) {
    const metadata = this.mergeSourceMetadata(input.metadata, {});
    return this.prisma.source.create({
      data: {
        knowledgeBaseId: input.knowledgeBaseId,
        type: SourceType.UPLOAD,
        uri: `upload://${input.uploadId}`,
        includeRules: input.includeRules || [],
        excludeRules: input.excludeRules || [],
        metadata: metadata as Prisma.InputJsonValue,
        status: 'active',
      },
    });
  }

  async findAll(knowledgeBaseId?: string, knowledgeBaseSlug?: string) {
    let resolvedKnowledgeBaseId = knowledgeBaseId;

    if (knowledgeBaseSlug) {
      resolvedKnowledgeBaseId = (
        await this.knowledgeBasesService.resolveReference(knowledgeBaseId, knowledgeBaseSlug)
      ).id;
    }

    const where = resolvedKnowledgeBaseId ? { knowledgeBaseId: resolvedKnowledgeBaseId } : {};
    return this.prisma.source.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        knowledgeBase: true,
      },
    });
  }

  async findOne(id: string) {
    const source = await this.prisma.source.findUnique({
      where: { id },
      include: {
        knowledgeBase: true,
        documents: true,
      },
    });

    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }

    return source;
  }

  async update(id: string, dto: UpdateSourceDto) {
    const existing = await this.prisma.source.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }

    if (existing.type === SourceType.GIT_REPO) {
      if (dto.uri !== undefined) {
        if (dto.uri.trim() === '') {
          throw new BadRequestException('URI is required for git_repo source');
        }
        this.validateGitSourceUri(dto.uri);
      }
      if (dto.git) {
        this.validateGitConfig(dto.git);
      }
    } else if (existing.type === SourceType.URL) {
      if (dto.uri !== undefined) {
        this.validateUrlSourceUri(dto.uri);
      }
      if (dto.url) {
        this.validateUrlConfig(dto.url);
      }
    } else if (dto.uri !== undefined && dto.uri.trim() === '') {
      throw new BadRequestException(`URI is required for ${existing.type} source`);
    }

    if (dto.sourceTruthPolicy) {
      this.validateSourceTruthPolicy(dto.sourceTruthPolicy);
    }

    if (dto.syncPolicy) {
      this.validateSyncPolicy(dto.syncPolicy, existing.type);
    }

    try {
      const metadata =
        dto.git || dto.sourceTruthPolicy || dto.syncPolicy || dto.url
          ? this.mergeSourceMetadata(existing.metadata, {
              git: existing.type === SourceType.GIT_REPO ? dto.git : undefined,
              url: existing.type === SourceType.URL ? dto.url : undefined,
              sourceTruthPolicy: dto.sourceTruthPolicy,
              syncPolicy: dto.syncPolicy,
            })
          : undefined;

      return this.prisma.source.update({
        where: { id },
        data: {
          uri: dto.uri?.trim(),
          includeRules: dto.includeRules,
          excludeRules: dto.excludeRules,
          status: dto.status,
          metadata: metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }
  }

  async getPolicy(identifier: string, sourceId: string) {
    const source = await this.resolveSourceInWorkspace(identifier, sourceId);
    return this.buildSourcePolicyReadModel(source);
  }

  async updatePolicy(identifier: string, sourceId: string, dto: UpdateSourcePolicyDto) {
    const source = await this.resolveSourceInWorkspace(identifier, sourceId);

    if (dto.sourceTruthPolicy) {
      this.validateSourceTruthPolicy(dto.sourceTruthPolicy);
    }

    if (dto.syncPolicy) {
      this.validateSyncPolicy(dto.syncPolicy, source.type);
    }

    const metadata = this.mergeSourceMetadata(source.metadata, {
      sourceTruthPolicy: dto.sourceTruthPolicy,
      syncPolicy: dto.syncPolicy,
    });

    const updated = await this.prisma.source.update({
      where: { id: source.id },
      data: {
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    return this.buildSourcePolicyReadModel(updated);
  }

  async remove(id: string): Promise<void> {
    const source = await this.prisma.source.findUnique({
      where: { id },
      include: {
        documents: true,
        snapshots: true,
      },
    });

    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }

    const hasDependents = source.documents.length > 0 || source.snapshots.length > 0;

    if (hasDependents) {
      throw new BadRequestException(
        'Cannot delete source with existing documents or snapshots'
      );
    }

    await this.prisma.source.delete({
      where: { id },
    });
  }

  private validateCreateInput(dto: CreateSourceDto): void {
    if (
      dto.type !== SourceType.LOCAL_FOLDER &&
      dto.type !== SourceType.GIT_REPO &&
      dto.type !== SourceType.URL &&
      dto.type !== SourceType.OBSIDIAN_VAULT
    ) {
      throw new BadRequestException(
        `Source type "${dto.type}" is not supported in MVP. Only "local_folder", "git_repo", "url", and "obsidian_vault" are accepted.`
      );
    }

    if (!dto.uri || dto.uri.trim() === '') {
      throw new BadRequestException(`URI is required for ${dto.type} source`);
    }

    if (dto.type === SourceType.GIT_REPO) {
      this.validateGitSourceUri(dto.uri);
      this.validateGitConfig(dto.git);
    } else if (dto.type === SourceType.URL) {
      this.validateUrlSourceUri(dto.uri);
      this.validateUrlConfig(dto.url);
    } else if (dto.type === SourceType.OBSIDIAN_VAULT) {
      this.validateLocalFolderLikeUri(dto.uri, 'obsidian_vault');
    }
  }

  private buildCreateData(
    dto: CreateSourceDto,
    knowledgeBaseId: string,
  ): Prisma.SourceUncheckedCreateInput {
    return {
      knowledgeBaseId,
      type: dto.type,
      uri: dto.uri.trim(),
      includeRules: dto.includeRules || [],
      excludeRules: this.defaultExcludeRules(dto.type, dto.excludeRules),
      metadata: this.buildSourceMetadata(dto) as Prisma.InputJsonValue,
      status: 'active',
    };
  }

  private buildSourceMetadata(dto: CreateSourceDto): SourceMetadata {
    const base: SourceMetadata = {
      sourceTruthPolicy: normalizeSourceTruthPolicy(),
    };

    if (dto.type === SourceType.GIT_REPO) {
      return this.mergeSourceMetadata(base, { git: dto.git });
    }
    if (dto.type === SourceType.URL) {
      return this.mergeSourceMetadata(base, { url: dto.url });
    }
    if (dto.type === SourceType.OBSIDIAN_VAULT) {
      return {
        ...base,
        obsidian: {
          defaultExcludes: OBSIDIAN_DEFAULT_EXCLUDES,
          attachmentPatterns: OBSIDIAN_ATTACHMENT_PATTERNS,
          readOnly: true,
        },
      };
    }
    return base;
  }

  private defaultExcludeRules(type: SourceType, excludeRules?: string[]): string[] {
    if (type !== SourceType.OBSIDIAN_VAULT) {
      return excludeRules || [];
    }

    return [
      ...new Set([
        ...OBSIDIAN_DEFAULT_EXCLUDES,
        ...OBSIDIAN_ATTACHMENT_PATTERNS,
        ...(excludeRules || []),
      ]),
    ];
  }

  private validateGitSourceUri(uri: string): void {
    const value = uri.trim();
    const isTransportUri = /^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/)/i.test(value);
    const isScpStyle = /^[\w.-]+@[\w.-]+:[\w./-]+(?:\.git)?$/i.test(value);
    const isFilePath =
      value.startsWith('./') ||
      value.startsWith('../') ||
      value.startsWith('/') ||
      value.startsWith('~/') ||
      path.isAbsolute(value);

    if (!isTransportUri && !isScpStyle && !isFilePath) {
      throw new BadRequestException(
        'Git source URI must be an HTTP(S), SSH, git, file URL, or a local filesystem path',
      );
    }
  }

  private validateLocalFolderLikeUri(uri: string, sourceType: string): void {
    if (!uri || uri.trim() === '') {
      throw new BadRequestException(`URI is required for ${sourceType} source`);
    }
  }

  private validateGitConfig(git?: GitSourceConfigDto): void {
    if (!git) {
      throw new BadRequestException('git configuration is required for git_repo sources');
    }

    if (git.branch !== undefined && git.branch.trim() === '') {
      throw new BadRequestException('Git branch must not be empty');
    }

    if (git.commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(git.commit.trim())) {
      throw new BadRequestException('Git commit must be a 7-40 character hexadecimal SHA');
    }

    if (git.clonePath !== undefined && git.clonePath.trim() === '') {
      throw new BadRequestException('Git clonePath must not be empty');
    }

    if (git.credentialsRef !== undefined) {
      const credentialsRef = git.credentialsRef.trim();
      const looksLikeSecret =
        credentialsRef === '' ||
        credentialsRef.includes('://') ||
        /\s/.test(credentialsRef) ||
        credentialsRef.startsWith('ghp_') ||
        credentialsRef.startsWith('github_pat_') ||
        credentialsRef.startsWith('glpat-') ||
        credentialsRef.startsWith('sk-') ||
        credentialsRef.includes('-----BEGIN');

      if (looksLikeSecret) {
        throw new BadRequestException(
          'Git credentials must be provided as a reference identifier, not a raw secret',
        );
      }
    }
  }

  private validateUrlSourceUri(uri: string): void {
    if (!uri || uri.trim() === '') {
      throw new BadRequestException('URI is required for url source');
    }

    let url: URL;
    try {
      url = new URL(uri.trim());
    } catch {
      throw new BadRequestException('URL source URI must be a valid URL');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('URL source URI must use http or https');
    }

    if (url.username || url.password) {
      throw new BadRequestException('URL source URI must not include credentials');
    }
  }

  private validateUrlConfig(url?: UrlSourceConfigDto): void {
    if (!url) {
      return;
    }

    if (
      url.totalMaxBytes !== undefined &&
      url.maxBytesPerPage !== undefined &&
      url.totalMaxBytes < url.maxBytesPerPage
    ) {
      throw new BadRequestException(
        'URL totalMaxBytes must be greater than or equal to maxBytesPerPage',
      );
    }
  }

  private validateSyncPolicy(policy: SourceSyncPolicyDto, sourceType: string): void {
    if (policy.triggerMode === 'schedule') {
      if (!policy.schedule?.trim()) {
        throw new BadRequestException('schedule is required for schedule sync policy');
      }

      const intervalMs = parseScheduleIntervalMs(policy.schedule);
      if (!intervalMs || intervalMs < 1000) {
        throw new BadRequestException(
          'schedule must use a duration like "30s", "5m", "1h", or "every 1d"',
        );
      }
    }

    if (
      policy.triggerMode === 'watch' &&
      sourceType !== SourceType.LOCAL_FOLDER &&
      sourceType !== SourceType.OBSIDIAN_VAULT
    ) {
      throw new BadRequestException(
        'watch sync policy is only supported for local_folder and obsidian_vault sources',
      );
    }

    if (policy.triggerMode === 'webhook' && policy.webhookSecretRef?.includes('://')) {
      throw new BadRequestException(
        'webhookSecretRef must be a reference identifier, not a raw secret or URI',
      );
    }
  }

  private validateSourceTruthPolicy(policy: SourceTruthPolicyDto): void {
    const normalized = normalizeSourceTruthPolicy(policy);
    if (normalized.truthMode !== 'read_only' || normalized.writePolicy !== 'disabled') {
      throw new BadRequestException(
        'Source truth writes are disabled; only read_only truth mode with disabled write policy is supported',
      );
    }
  }

  private mergeSourceMetadata(
    existingMetadata: unknown,
    input: {
      git?: GitSourceConfigDto;
      url?: UrlSourceConfigDto;
      sourceTruthPolicy?: SourceTruthPolicyDto;
      syncPolicy?: SourceSyncPolicyDto;
    },
  ): SourceMetadata {
    const current = this.normalizeMetadata(existingMetadata);
    const next: SourceMetadata = {
      ...current,
    };

    if (input.git) {
      Object.assign(next, {
        ...(input.git.branch !== undefined ? { branch: input.git.branch.trim() } : {}),
        ...(input.git.commit !== undefined ? { commit: input.git.commit.trim() } : {}),
        ...(input.git.clonePath !== undefined ? { clonePath: input.git.clonePath.trim() } : {}),
        ...(input.git.credentialsRef !== undefined
          ? { credentialsRef: input.git.credentialsRef.trim() }
          : {}),
      });
    }

    if (input.url) {
      Object.assign(next, {
        ...(input.url.maxPages !== undefined ? { maxPages: input.url.maxPages } : {}),
        ...(input.url.maxBytesPerPage !== undefined
          ? { maxBytesPerPage: input.url.maxBytesPerPage }
          : {}),
        ...(input.url.totalMaxBytes !== undefined
          ? { totalMaxBytes: input.url.totalMaxBytes }
          : {}),
        ...(input.url.timeoutMs !== undefined ? { timeoutMs: input.url.timeoutMs } : {}),
        ...(input.url.sameHost !== undefined ? { sameHost: input.url.sameHost } : {}),
        ...(input.url.respectRobots !== undefined
          ? { respectRobots: input.url.respectRobots }
          : {}),
      });
    }

    if (input.sourceTruthPolicy) {
      next.sourceTruthPolicy = normalizeSourceTruthPolicy(input.sourceTruthPolicy);
    } else if (!next.sourceTruthPolicy) {
      next.sourceTruthPolicy = normalizeSourceTruthPolicy();
    }

    if (input.syncPolicy) {
      next.syncPolicy = normalizeSourceSyncPolicy(input.syncPolicy);
    }

    return next;
  }

  private normalizeMetadata(metadata: unknown): SourceMetadata {
    const value = normalizePlainMetadata(metadata);
    return {
      ...value,
      ...(typeof value.branch === 'string' ? { branch: value.branch } : {}),
      ...(typeof value.commit === 'string' ? { commit: value.commit } : {}),
      ...(typeof value.clonePath === 'string' ? { clonePath: value.clonePath } : {}),
      ...(typeof value.credentialsRef === 'string'
        ? { credentialsRef: value.credentialsRef }
        : {}),
      sourceTruthPolicy: readSourceTruthPolicy(value),
      ...(readSourceSyncPolicy(value) ? { syncPolicy: readSourceSyncPolicy(value) } : {}),
      ...(typeof value.maxPages === 'number' ? { maxPages: value.maxPages } : {}),
      ...(typeof value.maxBytesPerPage === 'number'
        ? { maxBytesPerPage: value.maxBytesPerPage }
        : {}),
      ...(typeof value.totalMaxBytes === 'number'
        ? { totalMaxBytes: value.totalMaxBytes }
        : {}),
      ...(typeof value.timeoutMs === 'number' ? { timeoutMs: value.timeoutMs } : {}),
      ...(typeof value.sameHost === 'boolean' ? { sameHost: value.sameHost } : {}),
      ...(typeof value.respectRobots === 'boolean' ? { respectRobots: value.respectRobots } : {}),
    };
  }

  private async resolveSourceInWorkspace(identifier: string, sourceId: string) {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const source = await this.prisma.source.findFirst({
      where: {
        id: sourceId,
        knowledgeBaseId: knowledgeBase.id,
      },
      include: {
        knowledgeBase: true,
      },
    });

    if (!source) {
      throw new NotFoundException(`Source with ID ${sourceId} not found in workspace ${identifier}`);
    }

    return source;
  }

  private buildSourcePolicyReadModel(source: {
    id: string;
    knowledgeBaseId: string;
    type: string;
    uri: string;
    status: string;
    metadata: unknown;
    lastSyncedAt?: Date | string | null;
    updatedAt?: Date | string;
  }) {
    const sourceTruthPolicy = readSourceTruthPolicy(source.metadata);
    const syncPolicy = readSourceSyncPolicy(source.metadata);
    const nextTriggerAt = this.computeNextTriggerAt(syncPolicy, source.lastSyncedAt);

    return {
      source: {
        id: source.id,
        knowledgeBaseId: source.knowledgeBaseId,
        type: source.type,
        uri: source.uri,
        status: source.status,
      },
      sourceTruthPolicy,
      syncPolicy: syncPolicy || {
        triggerMode: 'manual',
        enabled: false,
        mode: 'incremental',
      },
      autoRefreshEnabled:
        syncPolicy?.enabled === true && syncPolicy.triggerMode !== 'manual',
      lastSyncedAt: source.lastSyncedAt || null,
      nextTriggerAt,
    };
  }

  private computeNextTriggerAt(
    syncPolicy: ReturnType<typeof readSourceSyncPolicy>,
    lastSyncedAt?: Date | string | null,
  ): string | null {
    if (
      !syncPolicy ||
      syncPolicy.enabled === false ||
      syncPolicy.triggerMode !== 'schedule' ||
      !syncPolicy.schedule
    ) {
      return null;
    }

    const intervalMs = parseScheduleIntervalMs(syncPolicy.schedule);
    if (!intervalMs) {
      return null;
    }

    const base = lastSyncedAt ? new Date(lastSyncedAt).getTime() : Date.now();
    if (!Number.isFinite(base)) {
      return null;
    }

    return new Date(base + intervalMs).toISOString();
  }
}
