import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { ArchiveMemoryEntryDto } from './dto/archive-memory-entry.dto';
import { CreateDecisionNoteDto } from './dto/create-decision-note.dto';
import { CreateMemoryEntryDto } from './dto/create-memory-entry.dto';
import { CreateSessionSummaryDto } from './dto/create-session-summary.dto';
import { ListMemoryEntriesDto } from './dto/list-memory-entries.dto';
import { UpdateMemoryEntryDto } from './dto/update-memory-entry.dto';

const ACTIVE_MEMORY_STATUS = 'active';
const ARCHIVED_MEMORY_STATUS = 'archived';
const MEMORY_VECTOR_REFRESH_NOT_CONFIGURED = {
  status: 'not_configured',
  reason: 'memory_search_is_not_vectorized_yet',
};

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
  ) {}

  async createMemoryEntry(identifier: string, dto: CreateMemoryEntryDto) {
    const workspace = await this.knowledgeBasesService.resolveIdentifier(identifier);

    return this.prisma.memoryEntry.create({
      data: {
        knowledgeBaseId: workspace.id,
        entryType: dto.entryType as any,
        title: dto.title?.trim(),
        body: dto.body,
        summary: dto.summary?.trim(),
        tags: dto.tags || [],
        authoredBy: dto.authoredBy?.trim(),
        sessionId: dto.sessionId?.trim(),
        sourceRefs: dto.sourceRefs || [],
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
        metadata: this.withLifecycleMetadata(dto.metadata || {}, ACTIVE_MEMORY_STATUS) as Prisma.InputJsonValue,
      },
    });
  }

  async createSessionSummary(identifier: string, dto: CreateSessionSummaryDto) {
    return this.createMemoryEntry(identifier, {
      entryType: 'session_summary',
      title: dto.title,
      body: dto.body,
      summary: dto.summary,
      tags: dto.tags,
      authoredBy: dto.authoredBy,
      sessionId: dto.sessionId,
      sourceRefs: dto.sourceRefs,
      metadata: dto.metadata,
    });
  }

  async createDecisionNote(identifier: string, dto: CreateDecisionNoteDto) {
    return this.createMemoryEntry(identifier, {
      entryType: 'decision',
      title: dto.title,
      body: dto.body,
      summary: dto.summary,
      tags: dto.tags,
      authoredBy: dto.authoredBy,
      sessionId: dto.sessionId,
      sourceRefs: dto.sourceRefs,
      metadata: dto.metadata,
    });
  }

  async listMemoryEntries(identifier: string, filters: ListMemoryEntriesDto) {
    const workspace = await this.knowledgeBasesService.resolveIdentifier(identifier);

    const entries = await this.prisma.memoryEntry.findMany({
      where: {
        knowledgeBaseId: workspace.id,
        ...(filters.entryType ? { entryType: filters.entryType as any } : {}),
        ...(filters.sessionId ? { sessionId: filters.sessionId } : {}),
        ...(filters.tag ? { tags: { has: filters.tag } } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });

    return this.includeArchived(filters)
      ? entries
      : entries.filter((entry) => this.isActiveMemoryMetadata(entry.metadata));
  }

  async getMemoryEntry(identifier: string, entryId: string) {
    const workspace = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const entry = await this.prisma.memoryEntry.findFirst({
      where: {
        id: entryId,
        knowledgeBaseId: workspace.id,
      },
    });

    if (!entry) {
      throw new NotFoundException(`Memory entry ${entryId} not found in workspace ${identifier}`);
    }

    return entry;
  }

  async updateMemoryEntry(identifier: string, entryId: string, dto: UpdateMemoryEntryDto) {
    const entry = await this.getMemoryEntry(identifier, entryId);
    const existingMetadata = this.normalizeMetadata(entry.metadata);
    const nextMetadata = dto.metadata
      ? { ...existingMetadata, ...dto.metadata }
      : existingMetadata;

    return this.prisma.memoryEntry.update({
      where: { id: entry.id },
      data: {
        ...(dto.entryType ? { entryType: dto.entryType as any } : {}),
        ...(dto.title !== undefined ? { title: dto.title?.trim() } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.summary !== undefined ? { summary: dto.summary?.trim() } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.authoredBy !== undefined ? { authoredBy: dto.authoredBy?.trim() } : {}),
        ...(dto.sessionId !== undefined ? { sessionId: dto.sessionId?.trim() } : {}),
        ...(dto.sourceRefs !== undefined ? { sourceRefs: dto.sourceRefs } : {}),
        ...(dto.occurredAt !== undefined ? { occurredAt: new Date(dto.occurredAt) } : {}),
        metadata: this.withLifecycleMetadata(
          nextMetadata,
          this.memoryLifecycleStatus(existingMetadata),
        ) as Prisma.InputJsonValue,
      },
    });
  }

  async archiveMemoryEntry(
    identifier: string,
    entryId: string,
    dto: ArchiveMemoryEntryDto = {},
  ) {
    const entry = await this.getMemoryEntry(identifier, entryId);
    const metadata = {
      ...this.normalizeMetadata(entry.metadata),
      archivedAt: new Date().toISOString(),
      ...(dto.reason?.trim() ? { archiveReason: dto.reason.trim() } : {}),
    };

    return this.prisma.memoryEntry.update({
      where: { id: entry.id },
      data: {
        metadata: this.withLifecycleMetadata(metadata, ARCHIVED_MEMORY_STATUS) as Prisma.InputJsonValue,
      },
    });
  }

  async deleteMemoryEntry(identifier: string, entryId: string) {
    const entry = await this.getMemoryEntry(identifier, entryId);
    await this.prisma.memoryEntry.delete({
      where: { id: entry.id },
    });

    return {
      id: entry.id,
      knowledgeBaseId: entry.knowledgeBaseId,
      deleted: true,
    };
  }

  isActiveMemoryMetadata(metadata: unknown): boolean {
    return this.memoryLifecycleStatus(this.normalizeMetadata(metadata)) !== ARCHIVED_MEMORY_STATUS;
  }

  private includeArchived(filters: ListMemoryEntriesDto): boolean {
    return filters.includeArchived === 'true';
  }

  private withLifecycleMetadata(
    metadata: Record<string, unknown>,
    status: string,
  ): Record<string, unknown> {
    return {
      ...metadata,
      lifecycleStatus: status,
      vectorRefresh: MEMORY_VECTOR_REFRESH_NOT_CONFIGURED,
    };
  }

  private memoryLifecycleStatus(metadata: Record<string, unknown>): string {
    return typeof metadata.lifecycleStatus === 'string'
      ? metadata.lifecycleStatus
      : ACTIVE_MEMORY_STATUS;
  }

  private normalizeMetadata(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return metadata as Record<string, unknown>;
  }
}
