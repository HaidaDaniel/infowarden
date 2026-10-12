import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';
import { WorkspaceKindValue, WORKSPACE_KIND_VALUES } from './dto/workspace-kind.enum';
import {
  UNINDEXED_WORKSPACE_AVAILABILITY,
  WorkspaceAvailability,
  WorkspaceAvailabilityInput,
  WorkspaceAvailabilityService,
} from './workspace-availability.service';

const DEFAULT_WORKSPACE_KIND: WorkspaceKindValue = 'general';
const DEFAULT_PROFILE_KEY = 'default';
const DEFAULT_PROFILE_BY_WORKSPACE_KIND: Record<WorkspaceKindValue, { index: string; retrieval: string }> = {
  general: { index: 'default', retrieval: 'default' },
  codebase: { index: 'code-default', retrieval: 'code-debug' },
  docs: { index: 'docs-default', retrieval: 'docs-qa' },
  agent_memory: { index: 'memory-default', retrieval: 'memory-recall' },
  ops_context: { index: 'ops-default', retrieval: 'ops-recall' },
  personal_work_history: { index: 'memory-default', retrieval: 'work-history' },
  benchmarks: { index: 'benchmark-default', retrieval: 'benchmark-recall' },
  contracts: { index: 'contracts-default', retrieval: 'contract-qa' },
  datasets: { index: 'dataset-default', retrieval: 'dataset-search' },
  custom: { index: 'default', retrieval: 'default' },
};

type KnowledgeBaseWithDeletionDependents = Prisma.KnowledgeBaseGetPayload<{
  include: {
    sources: true;
    indexVersions: true;
    validationReports: true;
    indexingJobs: true;
  };
}>;

@Injectable()
export class KnowledgeBasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceAvailabilityService: WorkspaceAvailabilityService,
  ) {}

  async create(dto: CreateKnowledgeBaseDto) {
    const slug = await this.generateUniqueSlug(dto.slug || dto.name);
    const workspaceKind = this.normalizeWorkspaceKind(dto.workspaceKind);

    const knowledgeBase = await this.prisma.knowledgeBase.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        workspaceKind,
        defaultIndexProfile: this.normalizeProfileKey(dto.defaultIndexProfile, workspaceKind, 'index'),
        defaultRetrievalProfile: this.normalizeProfileKey(dto.defaultRetrievalProfile, workspaceKind, 'retrieval'),
      },
    });

    return this.toWorkspaceCompatibleRecord(knowledgeBase, UNINDEXED_WORKSPACE_AVAILABILITY);
  }

  async findAll() {
    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const availability = await this.evaluateAvailability(knowledgeBases);
    return knowledgeBases.map((knowledgeBase) =>
      this.toWorkspaceCompatibleRecord(knowledgeBase, availability.get(knowledgeBase.id)),
    );
  }

  async findOne(identifier: string) {
    const knowledgeBase = await this.findByIdentifier(identifier, {
      sources: true,
      indexVersions: true,
      activeServingRevision: {
        include: {
          manifestEntries: {
            include: {
              sourceRevision: {
                select: {
                  id: true,
                  sourceId: true,
                  sourceSnapshotId: true,
                  contentHash: true,
                  parserVersion: true,
                  documentCount: true,
                  status: true,
                  validationSummary: true,
                  createdAt: true,
                },
              },
            },
            orderBy: { position: 'asc' },
          },
          indexBuilds: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    });

    if (!knowledgeBase) {
      throw new NotFoundException(`Knowledge base with ID or slug ${identifier} not found`);
    }

    const availability = await this.evaluateAvailability([knowledgeBase]);
    return this.toWorkspaceCompatibleRecord(knowledgeBase, availability.get(knowledgeBase.id));
  }

  async update(identifier: string, dto: UpdateKnowledgeBaseDto) {
    const knowledgeBase = await this.findByIdentifier(identifier);

    if (!knowledgeBase) {
      throw new NotFoundException(`Knowledge base with ID or slug ${identifier} not found`);
    }

    const updatedKnowledgeBase = await this.prisma.knowledgeBase.update({
      where: { id: knowledgeBase.id },
      data: {
        name: dto.name,
        description: dto.description,
        slug: dto.slug !== undefined ? await this.generateUniqueSlug(dto.slug, knowledgeBase.id) : undefined,
        workspaceKind: dto.workspaceKind !== undefined ? this.normalizeWorkspaceKind(dto.workspaceKind) : undefined,
        defaultIndexProfile:
          dto.defaultIndexProfile !== undefined
            ? this.normalizeProfileKey(
                dto.defaultIndexProfile,
                this.resolveWorkspaceKindForUpdate(knowledgeBase.workspaceKind, dto.workspaceKind),
                'index',
              )
            : undefined,
        defaultRetrievalProfile:
          dto.defaultRetrievalProfile !== undefined
            ? this.normalizeProfileKey(
                dto.defaultRetrievalProfile,
                this.resolveWorkspaceKindForUpdate(knowledgeBase.workspaceKind, dto.workspaceKind),
                'retrieval',
              )
            : undefined,
      },
    });

    const availability = await this.evaluateAvailability([updatedKnowledgeBase]);
    return this.toWorkspaceCompatibleRecord(updatedKnowledgeBase, availability.get(updatedKnowledgeBase.id));
  }

  evaluateAvailability(workspaces: WorkspaceAvailabilityInput[]) {
    return this.workspaceAvailabilityService.evaluate(workspaces);
  }

  async remove(identifier: string): Promise<void> {
    const knowledgeBase = (await this.findByIdentifier(identifier, {
      sources: true,
      indexVersions: true,
      validationReports: true,
      indexingJobs: true,
    })) as KnowledgeBaseWithDeletionDependents | null;

    if (!knowledgeBase) {
      throw new NotFoundException(`Knowledge base with ID or slug ${identifier} not found`);
    }

    const hasDependents =
      knowledgeBase.sources.length > 0 ||
      knowledgeBase.indexVersions.length > 0 ||
      knowledgeBase.validationReports.length > 0 ||
      knowledgeBase.indexingJobs.length > 0;

    if (hasDependents) {
      throw new BadRequestException(
        'Cannot delete knowledge base with existing sources, index versions, reports, or jobs',
      );
    }

    await this.prisma.knowledgeBase.delete({
      where: { id: knowledgeBase.id },
    });
  }

  async resolveIdentifier(identifier: string) {
    const knowledgeBase = await this.findByIdentifier(identifier);

    if (!knowledgeBase) {
      throw new NotFoundException(`Knowledge base with ID or slug ${identifier} not found`);
    }

    return knowledgeBase;
  }

  async resolveReference(knowledgeBaseId?: string, knowledgeBaseSlug?: string) {
    if (!knowledgeBaseId && !knowledgeBaseSlug) {
      throw new BadRequestException('knowledgeBaseId or knowledgeBaseSlug is required');
    }

    if (knowledgeBaseId && knowledgeBaseSlug) {
      const byId = await this.resolveIdentifier(knowledgeBaseId);
      if (byId.slug !== knowledgeBaseSlug) {
        throw new BadRequestException('knowledgeBaseId and knowledgeBaseSlug refer to different knowledge bases');
      }

      return byId;
    }

    return this.resolveIdentifier(knowledgeBaseId || knowledgeBaseSlug || '');
  }

  async ensureForBootstrap(input: { id?: string; slug?: string; name?: string; description?: string }) {
    const name = input.name?.trim();
    const slug = input.slug?.trim();
    const description = input.description?.trim();

    if (input.id) {
      return {
        knowledgeBase: await this.resolveReference(input.id, slug),
        created: false,
      };
    }

    if (slug) {
      const existing = await this.findByIdentifier(slug);
      if (existing) {
        return {
          knowledgeBase: existing,
          created: false,
        };
      }
    }

    if (!name && !slug) {
      throw new BadRequestException('knowledgeBase.name or knowledgeBase.slug is required for bootstrap flows');
    }

    return {
      knowledgeBase: await this.create({
        name: name || slug || 'knowledge-base',
        slug,
        description,
      }),
      created: true,
    };
  }

  private async findByIdentifier(identifier: string, include?: Prisma.KnowledgeBaseInclude) {
    const byId = await this.prisma.knowledgeBase.findUnique({
      where: { id: identifier },
      include,
    });

    if (byId) {
      return byId;
    }

    return this.prisma.knowledgeBase.findUnique({
      where: { slug: identifier },
      include,
    });
  }

  private async generateUniqueSlug(input: string, excludeId?: string): Promise<string> {
    const baseSlug = this.normalizeSlug(input);
    let slug = baseSlug;
    let suffix = 2;

    while (await this.slugExists(slug, excludeId)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }

  private async slugExists(slug: string, excludeId?: string): Promise<boolean> {
    const existing = await this.prisma.knowledgeBase.findFirst({
      where: {
        slug,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    return Boolean(existing);
  }

  private normalizeSlug(input: string): string {
    const normalized = input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return normalized || 'knowledge-base';
  }

  private normalizeWorkspaceKind(input?: string): WorkspaceKindValue {
    if (!input) {
      return DEFAULT_WORKSPACE_KIND;
    }

    if ((WORKSPACE_KIND_VALUES as readonly string[]).includes(input)) {
      return input as WorkspaceKindValue;
    }

    return DEFAULT_WORKSPACE_KIND;
  }

  private normalizeProfileKey(
    input: string | undefined,
    workspaceKind: WorkspaceKindValue = DEFAULT_WORKSPACE_KIND,
    profileType: 'index' | 'retrieval' = 'retrieval',
  ): string {
    const normalized = input?.trim();
    if (normalized) {
      return normalized;
    }

    return DEFAULT_PROFILE_BY_WORKSPACE_KIND[workspaceKind][profileType] || DEFAULT_PROFILE_KEY;
  }

  private resolveWorkspaceKindForUpdate(
    currentWorkspaceKind?: string,
    requestedWorkspaceKind?: string,
  ): WorkspaceKindValue {
    return this.normalizeWorkspaceKind(requestedWorkspaceKind || currentWorkspaceKind);
  }

  private toWorkspaceCompatibleRecord<T extends Record<string, any>>(
    knowledgeBase: T,
    availability?: WorkspaceAvailability,
  ) {
    const workspaceKind = this.normalizeWorkspaceKind(knowledgeBase.workspaceKind);
    const defaultIndexProfile = this.normalizeProfileKey(knowledgeBase.defaultIndexProfile);
    const defaultRetrievalProfile = this.normalizeProfileKey(knowledgeBase.defaultRetrievalProfile);
    const activeServingRevision = knowledgeBase.activeServingRevision
      ? {
          id: knowledgeBase.activeServingRevision.id,
          manifestHash: knowledgeBase.activeServingRevision.manifestHash,
          status: knowledgeBase.activeServingRevision.status,
          payloadSchemaVersion: knowledgeBase.activeServingRevision.payloadSchemaVersion,
          activatedAt: knowledgeBase.activeServingRevision.activatedAt,
          sourceRevisions: (knowledgeBase.activeServingRevision.manifestEntries || []).map(
            (entry: Record<string, any>) => ({
              position: entry.position,
              ...entry.sourceRevision,
            }),
          ),
          indexBuild: knowledgeBase.activeServingRevision.indexBuilds?.[0] || null,
        }
      : null;

    return {
      ...knowledgeBase,
      workspaceKind,
      defaultIndexProfile,
      defaultRetrievalProfile,
      ...(availability ? { availability } : {}),
      workspace: {
        id: knowledgeBase.id,
        slug: knowledgeBase.slug,
        name: knowledgeBase.name,
        description: knowledgeBase.description,
        kind: workspaceKind,
        defaultIndexProfile,
        defaultRetrievalProfile,
        activeServingRevisionId: knowledgeBase.activeServingRevisionId || null,
        servingRevisionState: knowledgeBase.servingRevisionState || 'uninitialized',
        activeServingRevision,
        ...(availability ? { availability } : {}),
        compatibility: {
          topLevelResource: 'knowledge_base',
          workspaceApiVersion: 'v1',
        },
      },
    };
  }
}
