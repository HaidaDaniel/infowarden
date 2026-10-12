import { NotFoundException } from '@nestjs/common';
import { MemoryService } from './memory.service';

describe('MemoryService', () => {
  const prisma = {
    memoryEntry: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const knowledgeBasesService = {
    resolveIdentifier: jest.fn(),
  };

  let service: MemoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MemoryService(prisma as any, knowledgeBasesService as any);
    knowledgeBasesService.resolveIdentifier.mockResolvedValue({
      id: 'kb-1',
      slug: 'agent-memory',
      workspaceKind: 'agent_memory',
    });
  });

  it('creates a generic memory entry without using source scans', async () => {
    prisma.memoryEntry.create.mockResolvedValue({ id: 'mem-1', entryType: 'fact' });

    await service.createMemoryEntry('agent-memory', {
      entryType: 'fact',
      body: 'Redis queue is shared with indexing jobs.',
      tags: ['infra'],
    });

    expect(prisma.memoryEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        entryType: 'fact',
        body: 'Redis queue is shared with indexing jobs.',
        tags: ['infra'],
      }),
    });
  });

  it('creates a session summary with a first-class entry type', async () => {
    prisma.memoryEntry.create.mockResolvedValue({ id: 'mem-2', entryType: 'session_summary' });

    await service.createSessionSummary('agent-memory', {
      sessionId: 'session-1',
      body: 'We migrated MCP to network HTTP.',
      summary: 'MCP HTTP migration summary',
    });

    expect(prisma.memoryEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        entryType: 'session_summary',
        sessionId: 'session-1',
      }),
    });
  });

  it('creates a decision note with a first-class entry type', async () => {
    prisma.memoryEntry.create.mockResolvedValue({ id: 'mem-3', entryType: 'decision' });

    await service.createDecisionNote('agent-memory', {
      title: 'Use streamable HTTP for remote MCP',
      body: 'Hermes needs a network transport.',
    });

    expect(prisma.memoryEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        entryType: 'decision',
        title: 'Use streamable HTTP for remote MCP',
      }),
    });
  });

  it('lists memory entries with filters', async () => {
    prisma.memoryEntry.findMany.mockResolvedValue([{ id: 'mem-1' }]);

    const results = await service.listMemoryEntries('agent-memory', {
      entryType: 'decision',
      sessionId: 'session-1',
      tag: 'infra',
    });

    expect(prisma.memoryEntry.findMany).toHaveBeenCalledWith({
      where: {
        knowledgeBaseId: 'kb-1',
        entryType: 'decision',
        sessionId: 'session-1',
        tags: { has: 'infra' },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
    expect(results).toEqual([{ id: 'mem-1' }]);
  });

  it('excludes archived memory entries from list results by default', async () => {
    prisma.memoryEntry.findMany.mockResolvedValue([
      { id: 'mem-active', metadata: { lifecycleStatus: 'active' } },
      { id: 'mem-legacy', metadata: {} },
      { id: 'mem-archived', metadata: { lifecycleStatus: 'archived' } },
    ]);

    await expect(service.listMemoryEntries('agent-memory', {})).resolves.toEqual([
      { id: 'mem-active', metadata: { lifecycleStatus: 'active' } },
      { id: 'mem-legacy', metadata: {} },
    ]);
  });

  it('can include archived memory entries for direct inspection', async () => {
    prisma.memoryEntry.findMany.mockResolvedValue([
      { id: 'mem-archived', metadata: { lifecycleStatus: 'archived' } },
    ]);

    await expect(
      service.listMemoryEntries('agent-memory', { includeArchived: 'true' }),
    ).resolves.toEqual([
      { id: 'mem-archived', metadata: { lifecycleStatus: 'archived' } },
    ]);
  });

  it('updates a memory entry and marks vector refresh as not configured', async () => {
    prisma.memoryEntry.findFirst.mockResolvedValue({
      id: 'mem-1',
      knowledgeBaseId: 'kb-1',
      metadata: { lifecycleStatus: 'active', source: 'agent' },
    });
    prisma.memoryEntry.update.mockResolvedValue({ id: 'mem-1', body: 'updated' });

    await service.updateMemoryEntry('agent-memory', 'mem-1', {
      body: 'updated',
      tags: ['infra', 'queue'],
      metadata: { confidence: 0.9 },
    });

    expect(prisma.memoryEntry.update).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
      data: expect.objectContaining({
        body: 'updated',
        tags: ['infra', 'queue'],
        metadata: expect.objectContaining({
          lifecycleStatus: 'active',
          source: 'agent',
          confidence: 0.9,
          vectorRefresh: {
            status: 'not_configured',
            reason: 'memory_search_is_not_vectorized_yet',
          },
        }),
      }),
    });
  });

  it('archives a memory entry with lifecycle metadata', async () => {
    prisma.memoryEntry.findFirst.mockResolvedValue({
      id: 'mem-1',
      knowledgeBaseId: 'kb-1',
      metadata: { source: 'agent' },
    });
    prisma.memoryEntry.update.mockResolvedValue({
      id: 'mem-1',
      metadata: { lifecycleStatus: 'archived' },
    });

    await service.archiveMemoryEntry('agent-memory', 'mem-1', {
      reason: 'stale fact',
    });

    expect(prisma.memoryEntry.update).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
      data: {
        metadata: expect.objectContaining({
          lifecycleStatus: 'archived',
          archiveReason: 'stale fact',
          archivedAt: expect.any(String),
          vectorRefresh: {
            status: 'not_configured',
            reason: 'memory_search_is_not_vectorized_yet',
          },
        }),
      },
    });
  });

  it('hard deletes a memory entry after workspace ownership validation', async () => {
    prisma.memoryEntry.findFirst.mockResolvedValue({
      id: 'mem-1',
      knowledgeBaseId: 'kb-1',
      metadata: {},
    });
    prisma.memoryEntry.delete.mockResolvedValue({ id: 'mem-1' });

    await expect(service.deleteMemoryEntry('agent-memory', 'mem-1')).resolves.toEqual({
      id: 'mem-1',
      knowledgeBaseId: 'kb-1',
      deleted: true,
    });
    expect(prisma.memoryEntry.delete).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
    });
  });

  it('throws when a memory entry does not belong to the workspace', async () => {
    prisma.memoryEntry.findFirst.mockResolvedValue(null);

    await expect(service.getMemoryEntry('agent-memory', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
