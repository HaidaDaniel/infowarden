import { BackendApiClient, MemoryEntry } from '../backend-client';

export const MEMORY_WRITE_KINDS = ['fact', 'session_summary', 'decision'] as const;

export type MemoryWriteKind = (typeof MEMORY_WRITE_KINDS)[number];

export function isMemoryWriteKind(value: unknown): value is MemoryWriteKind {
  return (MEMORY_WRITE_KINDS as readonly string[]).includes(String(value));
}

export interface WriteMemoryInput {
  workspaceId: string;
  kind: MemoryWriteKind;
  body: string;
  title?: string;
  summary?: string;
  sessionId?: string;
  authoredBy?: string;
  tags?: string[];
  sourceRefs?: string[];
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export class WriteMemoryTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(input: WriteMemoryInput): Promise<MemoryEntry> {
    if (input.kind === 'session_summary' && !input.sessionId) {
      throw new Error('sessionId is required when kind is session_summary');
    }
    return this.client.createMemoryEntry(input.workspaceId, {
      entryType: input.kind,
      body: input.body,
      title: input.title,
      summary: input.summary,
      sessionId: input.sessionId,
      authoredBy: input.authoredBy,
      tags: input.tags,
      sourceRefs: input.sourceRefs,
      occurredAt: input.occurredAt,
      metadata: input.metadata,
    });
  }
}

export interface UpdateMemoryInput {
  entryType?: string;
  body?: string;
  title?: string;
  summary?: string;
  tags?: string[];
  authoredBy?: string;
  sessionId?: string;
  sourceRefs?: string[];
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export class UpdateMemoryTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string, entryId: string, input: UpdateMemoryInput): Promise<MemoryEntry> {
    return this.client.updateMemoryEntry(workspaceId, entryId, input);
  }
}

export class ArchiveMemoryTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string, entryId: string, reason?: string): Promise<MemoryEntry> {
    return this.client.archiveMemoryEntry(workspaceId, entryId, reason);
  }
}

export class DeleteMemoryTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string, entryId: string) {
    return this.client.deleteMemoryEntry(workspaceId, entryId);
  }
}
