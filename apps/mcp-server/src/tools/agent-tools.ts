import {
  AskRequest,
  AskResponse,
  BackendApiClient,
  ContextPackageResponse,
  MemoryEntry,
  MemorySearchResponse,
  SearchResponse,
  SearchResult,
} from '../backend-client';

const MAX_TOP_K = 50;

export class AskWorkspaceTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    workspaceId: string,
    input: AskRequest,
  ): Promise<AskResponse> {
    return this.client.ask(workspaceId, input);
  }
}

export class GetAnswerChunksTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    workspaceId: string,
    input: Omit<AskRequest, 'mode'>,
  ): Promise<AskResponse> {
    return this.client.ask(workspaceId, { ...input, mode: 'chunks' });
  }
}

export class RagAnswerTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    workspaceId: string,
    input: Omit<AskRequest, 'mode'>,
  ): Promise<AskResponse> {
    return this.client.ask(workspaceId, { ...input, mode: 'rag_answer' });
  }
}

export class SearchCodeTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    kbId: string,
    query: string,
    options: { topK?: number; pathPrefix?: string; language?: string; branch?: string } = {},
  ) {
    const topK = Math.min(Math.max(options.topK || 10, 1), MAX_TOP_K);
    const response = await this.client.searchCode(kbId, query, {
      ...options,
      topK,
      profileKey: 'code-debug',
    });

    return toSearchResponse(kbId, response);
  }
}

export class SearchDocsTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(kbId: string, query: string, topK = 10) {
    const clampedTopK = Math.min(Math.max(topK, 1), MAX_TOP_K);
    const response = await this.client.search(kbId, query, clampedTopK, undefined, {
      profileKey: 'docs-qa',
    });

    return toSearchResponse(kbId, response);
  }
}

export class SearchMemoryTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(kbId: string, query: string, topK = 10): Promise<MemorySearchResponse> {
    const clampedTopK = Math.min(Math.max(topK, 1), MAX_TOP_K);
    return this.client.searchMemory(kbId, query, {
      topK: clampedTopK,
      profileKey: 'memory-recall',
    });
  }
}

export class GetContextPackageTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    kbId: string,
    query: string,
    options: {
      topK?: number;
      profileKey?: string;
      tokenBudget?: number;
      pathPrefix?: string;
      language?: string;
      branch?: string;
    } = {},
  ): Promise<ContextPackageResponse> {
    return this.client.getContextPackage(kbId, query, options);
  }
}

export class GetRecentDecisionsTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(kbId: string, limit = 5): Promise<{ knowledgeBaseId: string; results: MemoryEntry[]; count: number }> {
    return this.client.getRecentDecisions(kbId, limit);
  }
}

export class SaveSessionSummaryTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    kbId: string,
    input: {
      sessionId: string;
      body: string;
      title?: string;
      summary?: string;
      authoredBy?: string;
      tags?: string[];
      sourceRefs?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<MemoryEntry> {
    return this.client.saveSessionSummary(kbId, input);
  }
}

export class RememberFactTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    kbId: string,
    input: {
      body: string;
      title?: string;
      summary?: string;
      authoredBy?: string;
      sessionId?: string;
      tags?: string[];
      sourceRefs?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<MemoryEntry> {
    return this.client.rememberFact(kbId, input);
  }
}

export class UpdateMemoryEntryTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    kbId: string,
    entryId: string,
    input: {
      entryType?: string;
      body?: string;
      title?: string;
      summary?: string;
      authoredBy?: string;
      sessionId?: string;
      tags?: string[];
      sourceRefs?: string[];
      occurredAt?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<MemoryEntry> {
    return this.client.updateMemoryEntry(kbId, entryId, input);
  }
}

export class ArchiveMemoryEntryTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(kbId: string, entryId: string, reason?: string): Promise<MemoryEntry> {
    return this.client.archiveMemoryEntry(kbId, entryId, reason);
  }
}

export class DeleteMemoryEntryTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    kbId: string,
    entryId: string,
  ): Promise<{ id: string; knowledgeBaseId: string; deleted: boolean }> {
    return this.client.deleteMemoryEntry(kbId, entryId);
  }
}

function toSearchResponse(kbId: string, response: SearchResponse) {
  return {
    kbId,
    indexVersionId: response.indexVersionId,
    retrievalProfile: response.retrievalProfile,
    results: response.results.map((result: SearchResult) => ({
      chunkId: result.chunkId,
      text: result.text,
      score: result.score,
      documentId: result.documentId,
      path: result.path,
      language: result.language,
      branch: result.branch,
      commit: result.commit,
      startLine: result.startLine,
      endLine: result.endLine,
      metadata: result.metadata,
    })),
    count: response.results.length,
  };
}
