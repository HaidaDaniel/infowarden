import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { IndexingJobType, Prisma, SourceStatus, SourceType } from '@prisma/client';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { QueueService } from '../jobs/queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceImportDto, WorkspaceImportSourceRemapDto } from './dto/workspace-import.dto';
import { PortableMetadataSanitizer } from './portable-metadata-sanitizer';

const EXPORT_FORMAT_VERSION = 'workspace-export-manifest.v1';

@Injectable()
export class WorkspaceExportsService {
  private readonly metadataSanitizer: PortableMetadataSanitizer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly queueService: QueueService,
    @Optional() metadataSanitizer?: PortableMetadataSanitizer,
  ) {
    this.metadataSanitizer = metadataSanitizer || new PortableMetadataSanitizer();
  }

  async buildManifest(identifier: string) {
    const workspace = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const [
      sources,
      retrievalProfiles,
      indexVersions,
      memoryEntries,
      sourceSnapshots,
      validationReports,
      documentRows,
      chunkCounts,
    ] = await Promise.all([
      this.prisma.source.findMany({
        where: { knowledgeBaseId: workspace.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.retrievalProfile.findMany({
        where: { knowledgeBaseId: workspace.id },
        orderBy: { key: 'asc' },
      }),
      this.prisma.indexVersion.findMany({
        where: { knowledgeBaseId: workspace.id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.memoryEntry.findMany({
        where: { knowledgeBaseId: workspace.id },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.sourceSnapshot.findMany({
        where: { knowledgeBaseId: workspace.id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.validationReport.findMany({
        where: { knowledgeBaseId: workspace.id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.document.findMany({
        where: {
          source: {
            knowledgeBaseId: workspace.id,
          },
        },
        orderBy: { path: 'asc' },
      }),
      this.prisma.chunk.groupBy({
        by: ['documentId'],
        where: {
          document: {
            source: {
              knowledgeBaseId: workspace.id,
            },
          },
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    const chunkCountByDocumentId = new Map(chunkCounts.map((row) => [row.documentId, row._count._all]));

    return {
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      exportScope: {
        kind: 'metadata_manifest',
        includes: [
          'workspace_metadata',
          'source_definitions',
          'retrieval_profiles',
          'memory_entries',
          'document_metadata',
          'index_version_metadata',
          'validation_summaries',
          'restore_plan',
        ],
        excludes: [
          'provider_api_keys',
          'qdrant_physical_backup',
          'database_physical_backup',
          'local_file_contents',
          'git_credentials',
        ],
      },
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        description: workspace.description,
        kind: workspace.workspaceKind,
        defaultIndexProfile: workspace.defaultIndexProfile,
        defaultRetrievalProfile: workspace.defaultRetrievalProfile,
        activeIndexVersionId: workspace.activeIndexVersionId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        compatibility: {
          sourceModel: 'KnowledgeBase',
          workspaceApiVersion: 'v1',
        },
      },
      sources: sources.map((source) => ({
        id: source.id,
        type: source.type,
        uri: this.metadataSanitizer.sanitizeUri(source.uri),
        includeRules: source.includeRules,
        excludeRules: source.excludeRules,
        status: source.status,
        lastSyncedAt: source.lastSyncedAt,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        metadata: this.metadataSanitizer.sanitize(source.metadata),
      })),
      retrievalProfiles: retrievalProfiles.map((profile) => ({
        id: profile.id,
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
        metadata: this.metadataSanitizer.sanitize(profile.metadata),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      })),
      memoryEntries: memoryEntries.map((entry) => ({
        id: entry.id,
        entryType: entry.entryType,
        title: entry.title,
        body: entry.body,
        summary: entry.summary,
        tags: entry.tags,
        authoredBy: entry.authoredBy,
        sessionId: entry.sessionId,
        sourceRefs: entry.sourceRefs,
        occurredAt: entry.occurredAt,
        metadata: this.metadataSanitizer.sanitize(entry.metadata),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
      documentMetadata: documentRows.map((document) => ({
        id: document.id,
        sourceId: document.sourceId,
        path: document.path,
        mimeType: document.mimeType,
        contentHash: document.contentHash,
        status: document.status,
        chunkCount: chunkCountByDocumentId.get(document.id) ?? 0,
        metadata: this.metadataSanitizer.sanitize(document.metadata),
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })),
      sourceSnapshots: sourceSnapshots.map((snapshot) => ({
        id: snapshot.id,
        sourceId: snapshot.sourceId,
        snapshotType: snapshot.snapshotType,
        ref: snapshot.ref,
        fileCount: snapshot.fileCount,
        contentBytes: snapshot.contentBytes,
        metadata: this.metadataSanitizer.sanitize(snapshot.metadata),
        createdAt: snapshot.createdAt,
      })),
      indexVersions: indexVersions.map((indexVersion) => ({
        id: indexVersion.id,
        datasetVersionId: indexVersion.datasetVersionId,
        embeddingModel: indexVersion.embeddingModel,
        embeddingDimension: indexVersion.embeddingDimension,
        chunkingConfig: this.metadataSanitizer.sanitize(indexVersion.chunkingConfig),
        vectorCollectionName: indexVersion.vectorCollectionName,
        materializationMode: indexVersion.materializationMode,
        status: indexVersion.status,
        isActive: workspace.activeIndexVersionId === indexVersion.id,
        createdAt: indexVersion.createdAt,
      })),
      validationReports: validationReports.map((report) => ({
        id: report.id,
        datasetVersionId: report.datasetVersionId,
        indexVersionId: report.indexVersionId,
        level: report.level,
        status: report.status,
        summary: this.metadataSanitizer.sanitize(report.summary),
        issues: this.metadataSanitizer.sanitize(report.issues),
        createdAt: report.createdAt,
      })),
      restorePlan: this.buildRestorePlan({ sources, indexVersions, memoryEntryCount: memoryEntries.length }),
      counts: {
        sources: sources.length,
        retrievalProfiles: retrievalProfiles.length,
        memoryEntries: memoryEntries.length,
        documents: documentRows.length,
        chunks: chunkCounts.reduce((sum, row) => sum + row._count._all, 0),
        sourceSnapshots: sourceSnapshots.length,
        indexVersions: indexVersions.length,
        validationReports: validationReports.length,
      },
    };
  }

  private buildRestorePlan(input: {
    sources: Array<{ type: string; uri: string }>;
    indexVersions: Array<{ id: string }>;
    memoryEntryCount: number;
  }) {
    return {
      mode: 'plan_only',
      supportedFirstRestoreModes: ['metadata_only', 'metadata_plus_reindex'],
      recommendedSteps: [
        'create_workspace_with_same_slug_or_new_slug',
        'restore_source_definitions_without_provider_secrets',
        'restore_retrieval_profiles_and_memory_entries',
        'validate_source_uris_or_attach_imported_files',
        'run_reindex_to_recreate_vectors',
      ],
      requiresReindexForSearch: input.indexVersions.length > 0,
      sourceWarnings: input.sources
        .filter((source) => source.type === 'local_folder' || source.type === 'git_repo')
        .map((source) => ({
          type: source.type,
          uri: this.metadataSanitizer.sanitizeUri(source.uri),
          message:
            source.type === 'local_folder'
              ? 'Local folder paths must exist on the restore host or be remapped.'
              : 'Git credentials are not exported; configure access before restore indexing.',
        })),
      notes: [
        'This manifest is portable metadata, not a physical PostgreSQL or Qdrant backup.',
        'Provider secrets and credentials are intentionally omitted.',
        input.memoryEntryCount > 0
          ? 'Memory entries are included as first-class portable records.'
          : 'No memory entries were present at export time.',
      ],
    };
  }

  async validateImport(dto: WorkspaceImportDto) {
    const manifest = this.normalizeManifest(dto.manifest);
    const sourceRemaps = this.sourceRemapMap(dto.sourceRemaps || []);
    const errors: Array<{ code: string; message: string; details?: Record<string, unknown> }> = [];
    const warnings: Array<{ code: string; message: string; details?: Record<string, unknown> }> = [];
    const requiredRemaps: Array<{ sourceId: string; type: string; required: string[]; reason: string }> = [];

    if (!manifest) {
      errors.push({
        code: 'restore_manifest_invalid',
        message: 'Request must include a workspace export manifest object',
      });
      return this.importValidationResult(undefined, dto, errors, warnings, requiredRemaps);
    }

    if (manifest.formatVersion !== EXPORT_FORMAT_VERSION) {
      errors.push({
        code: 'restore_manifest_unsupported_version',
        message: `Only ${EXPORT_FORMAT_VERSION} is supported`,
        details: { received: manifest.formatVersion },
      });
    }

    if (!manifest.workspace?.slug && !manifest.workspace?.name) {
      errors.push({
        code: 'restore_manifest_workspace_missing',
        message: 'Manifest workspace slug or name is required',
      });
    }

    for (const source of manifest.sources) {
      if (!source.id || !this.isSupportedRestoreSourceType(source.type)) {
        errors.push({
          code: 'restore_source_invalid',
          message: 'Manifest source must include a supported source id and type',
          details: { sourceId: source.id, type: source.type },
        });
        continue;
      }

      const remap = sourceRemaps.get(source.id);
      const missing = this.requiredSourceRemaps(source, remap);
      if (missing.length === 0) {
        continue;
      }

      requiredRemaps.push({
        sourceId: source.id,
        type: source.type,
        required: missing,
        reason: this.sourceRemapReason(source),
      });
      errors.push({
        code: 'restore_source_remap_required',
        message: `Source ${source.id} requires explicit restore remapping`,
        details: { sourceId: source.id, type: source.type, required: missing },
      });
    }

    if (manifest.indexVersions.length > 0) {
      warnings.push({
        code: 'restore_reindex_required',
        message: 'Index versions are metadata only; vectors must be rebuilt with reindex jobs',
        details: { indexVersions: manifest.indexVersions.length },
      });
    }

    if (dto.enqueueReindex === false) {
      warnings.push({
        code: 'restore_reindex_not_enqueued',
        message: 'Source definitions can be restored, but search will not be rebuilt until reindexing runs',
      });
    }

    return this.importValidationResult(manifest, dto, errors, warnings, requiredRemaps);
  }

  async applyImport(dto: WorkspaceImportDto) {
    const validation = await this.validateImport(dto);
    if (!validation.valid) {
      throw new BadRequestException({
        code: 'restore_manifest_validation_failed',
        message: 'Workspace restore manifest validation failed',
        validation,
      });
    }

    const manifest = this.normalizeManifest(dto.manifest);
    if (!manifest) {
      throw new BadRequestException('Workspace restore manifest is required');
    }

    const workspaceResult = await this.createOrUpdateWorkspace(manifest, dto);
    const sourceRemaps = this.sourceRemapMap(dto.sourceRemaps || []);
    const restoredProfiles = await this.restoreRetrievalProfiles(workspaceResult.workspace.id, manifest);
    const restoredMemoryEntries = await this.restoreMemoryEntries(workspaceResult.workspace.id, manifest);
    const restoredSources = await this.restoreSources(workspaceResult.workspace.id, manifest, sourceRemaps);
    const jobs =
      dto.enqueueReindex === false
        ? []
        : await this.enqueueRestoreReindexJobs(workspaceResult.workspace.id, restoredSources);

    return {
      applied: true,
      workspace: {
        id: workspaceResult.workspace.id,
        slug: workspaceResult.workspace.slug,
        name: workspaceResult.workspace.name,
        created: workspaceResult.created,
        updated: workspaceResult.updated,
      },
      restored: {
        retrievalProfiles: restoredProfiles.length,
        memoryEntries: restoredMemoryEntries.length,
        sources: restoredSources.length,
      },
      reindexJobs: jobs,
      warnings: validation.warnings,
      nextActions: [
        jobs.length > 0 ? 'wait_for_reindex_jobs_to_finish' : 'enqueue_source_reindex_when_ready',
        'verify_restored_workspace_search',
      ],
    };
  }

  private importValidationResult(
    manifest: WorkspaceImportManifest | undefined,
    dto: WorkspaceImportDto,
    errors: Array<{ code: string; message: string; details?: Record<string, unknown> }>,
    warnings: Array<{ code: string; message: string; details?: Record<string, unknown> }>,
    requiredRemaps: Array<{ sourceId: string; type: string; required: string[]; reason: string }>,
  ) {
    return {
      valid: errors.length === 0,
      formatVersion: manifest?.formatVersion,
      target: {
        id: dto.targetWorkspace?.id,
        slug: dto.targetWorkspace?.slug || manifest?.workspace.slug,
        updateExisting: dto.targetWorkspace?.updateExisting || false,
      },
      counts: {
        sources: manifest?.sources.length || 0,
        retrievalProfiles: manifest?.retrievalProfiles.length || 0,
        memoryEntries: manifest?.memoryEntries.length || 0,
        indexVersions: manifest?.indexVersions.length || 0,
      },
      requiredRemaps,
      errors,
      warnings,
      reindexRequired: Boolean(manifest && manifest.indexVersions.length > 0),
    };
  }

  private async createOrUpdateWorkspace(manifest: WorkspaceImportManifest, dto: WorkspaceImportDto) {
    const target = dto.targetWorkspace || {};
    const targetIdOrSlug = target.id || target.slug;
    const targetSlug = target.slug || manifest.workspace.slug;
    const targetName = target.name || manifest.workspace.name || targetSlug;
    const targetDescription = target.description !== undefined ? target.description : manifest.workspace.description;

    if (targetIdOrSlug) {
      const existing = await this.prisma.knowledgeBase.findFirst({
        where: target.id ? { id: target.id } : { slug: targetSlug },
      });

      if (existing) {
        if (!target.updateExisting) {
          throw new BadRequestException({
            code: 'restore_target_exists',
            message: 'Target workspace already exists; set targetWorkspace.updateExisting=true',
            target: { id: existing.id, slug: existing.slug },
          });
        }

        const workspace = await this.prisma.knowledgeBase.update({
          where: { id: existing.id },
          data: {
            name: targetName,
            slug: target.slug || existing.slug,
            description: targetDescription,
            workspaceKind: this.normalizeWorkspaceKind(manifest.workspace.kind),
            defaultIndexProfile: manifest.workspace.defaultIndexProfile || 'default',
            defaultRetrievalProfile: manifest.workspace.defaultRetrievalProfile || 'default',
          },
        });
        return { workspace, created: false, updated: true };
      }
    }

    const workspace = await this.knowledgeBasesService.create({
      name: targetName,
      slug: targetSlug,
      description: targetDescription,
      workspaceKind: manifest.workspace.kind,
      defaultIndexProfile: manifest.workspace.defaultIndexProfile,
      defaultRetrievalProfile: manifest.workspace.defaultRetrievalProfile,
    });

    return { workspace, created: true, updated: false };
  }

  private async restoreRetrievalProfiles(knowledgeBaseId: string, manifest: WorkspaceImportManifest) {
    const restored = [];
    for (const profile of manifest.retrievalProfiles) {
      const result = await this.prisma.retrievalProfile.upsert({
        where: {
          knowledgeBaseId_key: {
            knowledgeBaseId,
            key: profile.key,
          },
        },
        create: {
          knowledgeBaseId,
          key: profile.key,
          name: profile.name || profile.key,
          intent: profile.intent || 'general_search',
          denseTopK: profile.denseTopK ?? 10,
          scoreThreshold: profile.scoreThreshold,
          neighborBefore: profile.neighborBefore ?? 0,
          neighborAfter: profile.neighborAfter ?? 0,
          tokenBudget: profile.tokenBudget,
          grouping: profile.grouping || 'document',
          recencyBoost: profile.recencyBoost || false,
          metadata: this.withRestoreMetadata(profile.metadata, 'retrievalProfileId', profile.id),
        },
        update: {
          name: profile.name || profile.key,
          intent: profile.intent || 'general_search',
          denseTopK: profile.denseTopK ?? 10,
          scoreThreshold: profile.scoreThreshold,
          neighborBefore: profile.neighborBefore ?? 0,
          neighborAfter: profile.neighborAfter ?? 0,
          tokenBudget: profile.tokenBudget,
          grouping: profile.grouping || 'document',
          recencyBoost: profile.recencyBoost || false,
          metadata: this.withRestoreMetadata(profile.metadata, 'retrievalProfileId', profile.id),
        },
      });
      restored.push(result);
    }
    return restored;
  }

  private async restoreMemoryEntries(knowledgeBaseId: string, manifest: WorkspaceImportManifest) {
    const restored = [];
    for (const entry of manifest.memoryEntries) {
      const result = await this.prisma.memoryEntry.create({
        data: {
          knowledgeBaseId,
          entryType: entry.entryType,
          title: entry.title,
          body: entry.body,
          summary: entry.summary,
          tags: entry.tags || [],
          authoredBy: entry.authoredBy,
          sessionId: entry.sessionId,
          sourceRefs: entry.sourceRefs || [],
          occurredAt: entry.occurredAt ? new Date(entry.occurredAt) : undefined,
          metadata: this.withRestoreMetadata(entry.metadata, 'memoryEntryId', entry.id),
        },
      });
      restored.push(result);
    }
    return restored;
  }

  private async restoreSources(
    knowledgeBaseId: string,
    manifest: WorkspaceImportManifest,
    sourceRemaps: Map<string, WorkspaceImportSourceRemapDto>,
  ) {
    const restored: Array<{ id: string; originalSourceId: string; type: SourceType; uri: string }> = [];

    for (const source of manifest.sources) {
      const remap = sourceRemaps.get(source.id);
      const metadata = this.restoreSourceMetadata(source, remap);
      const created = await this.prisma.source.create({
        data: {
          knowledgeBaseId,
          type: source.type as SourceType,
          uri: remap?.uri?.trim() || source.uri,
          includeRules: source.includeRules || [],
          excludeRules: source.excludeRules || [],
          metadata,
          status: remap?.disable ? SourceStatus.disabled : SourceStatus.active,
        },
      });

      restored.push({
        id: created.id,
        originalSourceId: source.id,
        type: created.type,
        uri: created.uri,
      });
    }

    return restored;
  }

  private async enqueueRestoreReindexJobs(
    knowledgeBaseId: string,
    sources: Array<{ id: string; originalSourceId: string; type: SourceType }>,
  ) {
    const jobs = [];
    for (const source of sources) {
      const job = await this.queueService.enqueueIndexingJob({
        knowledgeBaseId,
        sourceId: source.id,
        type: IndexingJobType.scan_source,
        refresh: {
          mode: 'rebuild_collection',
          reason: 'workspace restore apply',
          dryRun: false,
          trigger: 'manual',
          triggerMetadata: {
            restore: true,
            originalSourceId: source.originalSourceId,
            sourceType: source.type,
          },
        },
      });
      jobs.push({ sourceId: source.id, originalSourceId: source.originalSourceId, jobId: job.id });
    }
    return jobs;
  }

  private restoreSourceMetadata(
    source: WorkspaceImportSource,
    remap?: WorkspaceImportSourceRemapDto,
  ): Prisma.InputJsonValue {
    const metadata = this.metadataSanitizer.removeRedacted(source.metadata);
    const restore = {
      importedAt: new Date().toISOString(),
      originalSourceId: source.id,
      originalUri: source.uri,
    };

    if (source.type === 'git_repo' && remap?.credentialsRef) {
      metadata.credentialsRef = remap.credentialsRef.trim();
    }

    return {
      ...metadata,
      ...(remap?.metadata || {}),
      restore,
    } as Prisma.InputJsonValue;
  }

  private requiredSourceRemaps(source: WorkspaceImportSource, remap?: WorkspaceImportSourceRemapDto): string[] {
    const required: string[] = [];

    if ((source.type === 'local_folder' || source.type === 'upload') && !remap?.uri?.trim()) {
      required.push('uri');
    }

    if (
      source.type === 'git_repo' &&
      this.metadataSanitizer.hasRedactedSecret(source.metadata) &&
      !remap?.credentialsRef?.trim()
    ) {
      required.push('credentialsRef');
    }

    return required;
  }

  private sourceRemapReason(source: WorkspaceImportSource): string {
    if (source.type === 'local_folder') {
      return 'Local folder paths must be selected explicitly on the restore host';
    }
    if (source.type === 'upload') {
      return 'Managed upload files are not part of the metadata manifest';
    }
    if (source.type === 'git_repo') {
      return 'Git credential references are redacted from exported manifests';
    }
    return 'Source requires explicit restore input';
  }

  private sourceRemapMap(remaps: WorkspaceImportSourceRemapDto[]) {
    return new Map(remaps.map((remap) => [remap.sourceId, remap]));
  }

  private normalizeManifest(value: unknown): WorkspaceImportManifest | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const manifest = value as Record<string, any>;
    return {
      formatVersion: typeof manifest.formatVersion === 'string' ? manifest.formatVersion : '',
      workspace: {
        slug: String(manifest.workspace?.slug || ''),
        name: String(manifest.workspace?.name || manifest.workspace?.slug || ''),
        description: typeof manifest.workspace?.description === 'string' ? manifest.workspace.description : undefined,
        kind: String(manifest.workspace?.kind || 'general'),
        defaultIndexProfile: String(manifest.workspace?.defaultIndexProfile || 'default'),
        defaultRetrievalProfile: String(manifest.workspace?.defaultRetrievalProfile || 'default'),
      },
      sources: Array.isArray(manifest.sources) ? manifest.sources.map((source) => this.normalizeSource(source)) : [],
      retrievalProfiles: Array.isArray(manifest.retrievalProfiles)
        ? manifest.retrievalProfiles.map((profile) => this.normalizeRetrievalProfile(profile))
        : [],
      memoryEntries: Array.isArray(manifest.memoryEntries)
        ? manifest.memoryEntries.map((entry) => this.normalizeMemoryEntry(entry))
        : [],
      indexVersions: Array.isArray(manifest.indexVersions) ? manifest.indexVersions : [],
    };
  }

  private normalizeSource(source: any): WorkspaceImportSource {
    return {
      id: String(source?.id || ''),
      type: String(source?.type || '') as SourceType,
      uri: String(source?.uri || ''),
      includeRules: Array.isArray(source?.includeRules)
        ? source.includeRules.filter((item: unknown): item is string => typeof item === 'string')
        : [],
      excludeRules: Array.isArray(source?.excludeRules)
        ? source.excludeRules.filter((item: unknown): item is string => typeof item === 'string')
        : [],
      metadata: this.metadataSanitizer.plainObject(source?.metadata),
    };
  }

  private normalizeRetrievalProfile(profile: any): WorkspaceImportRetrievalProfile {
    return {
      id: String(profile?.id || ''),
      key: String(profile?.key || 'default'),
      name: String(profile?.name || profile?.key || 'Default'),
      intent: String(profile?.intent || 'general_search'),
      denseTopK: Number.isFinite(Number(profile?.denseTopK)) ? Number(profile.denseTopK) : 10,
      scoreThreshold:
        profile?.scoreThreshold === null || profile?.scoreThreshold === undefined
          ? null
          : Number(profile.scoreThreshold),
      neighborBefore: Number.isFinite(Number(profile?.neighborBefore)) ? Number(profile.neighborBefore) : 0,
      neighborAfter: Number.isFinite(Number(profile?.neighborAfter)) ? Number(profile.neighborAfter) : 0,
      tokenBudget:
        profile?.tokenBudget === null || profile?.tokenBudget === undefined ? null : Number(profile.tokenBudget),
      grouping: String(profile?.grouping || 'document'),
      recencyBoost: Boolean(profile?.recencyBoost),
      metadata: this.metadataSanitizer.plainObject(profile?.metadata),
    };
  }

  private normalizeMemoryEntry(entry: any): WorkspaceImportMemoryEntry {
    return {
      id: String(entry?.id || ''),
      entryType: String(entry?.entryType || 'fact') as any,
      title: typeof entry?.title === 'string' ? entry.title : undefined,
      body: String(entry?.body || ''),
      summary: typeof entry?.summary === 'string' ? entry.summary : undefined,
      tags: Array.isArray(entry?.tags)
        ? entry.tags.filter((item: unknown): item is string => typeof item === 'string')
        : [],
      authoredBy: typeof entry?.authoredBy === 'string' ? entry.authoredBy : undefined,
      sessionId: typeof entry?.sessionId === 'string' ? entry.sessionId : undefined,
      sourceRefs: Array.isArray(entry?.sourceRefs)
        ? entry.sourceRefs.filter((item: unknown): item is string => typeof item === 'string')
        : [],
      occurredAt: typeof entry?.occurredAt === 'string' ? entry.occurredAt : undefined,
      metadata: this.metadataSanitizer.plainObject(entry?.metadata),
    };
  }

  private withRestoreMetadata(
    metadata: Record<string, unknown>,
    key: string,
    originalId: string,
  ): Prisma.InputJsonValue {
    return {
      ...this.metadataSanitizer.removeRedacted(metadata),
      restore: {
        importedAt: new Date().toISOString(),
        [key]: originalId,
      },
    } as Prisma.InputJsonValue;
  }

  private normalizeWorkspaceKind(value: string): any {
    const allowed = [
      'general',
      'codebase',
      'docs',
      'agent_memory',
      'ops_context',
      'personal_work_history',
      'benchmarks',
      'contracts',
      'datasets',
      'custom',
    ];
    return allowed.includes(value) ? value : 'general';
  }

  private isSupportedRestoreSourceType(value: string): value is SourceType {
    return ['local_folder', 'git_repo', 'upload', 'url'].includes(value);
  }
}

type WorkspaceImportManifest = {
  formatVersion: string;
  workspace: {
    slug: string;
    name: string;
    description?: string;
    kind: string;
    defaultIndexProfile: string;
    defaultRetrievalProfile: string;
  };
  sources: WorkspaceImportSource[];
  retrievalProfiles: WorkspaceImportRetrievalProfile[];
  memoryEntries: WorkspaceImportMemoryEntry[];
  indexVersions: unknown[];
};

type WorkspaceImportSource = {
  id: string;
  type: string;
  uri: string;
  includeRules: string[];
  excludeRules: string[];
  metadata: Record<string, unknown>;
};

type WorkspaceImportRetrievalProfile = {
  id: string;
  key: string;
  name: string;
  intent: string;
  denseTopK: number;
  scoreThreshold?: number | null;
  neighborBefore: number;
  neighborAfter: number;
  tokenBudget?: number | null;
  grouping: string;
  recencyBoost: boolean;
  metadata: Record<string, unknown>;
};

type WorkspaceImportMemoryEntry = {
  id: string;
  entryType: any;
  title?: string;
  body: string;
  summary?: string;
  tags: string[];
  authoredBy?: string;
  sessionId?: string;
  sourceRefs: string[];
  occurredAt?: string;
  metadata: Record<string, unknown>;
};
