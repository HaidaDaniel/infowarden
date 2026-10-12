import { BackendApiClient } from '../backend-client';
import {
  AskWorkspaceTool,
  ArchiveMemoryEntryTool,
  DeleteMemoryEntryTool,
  GetContextPackageTool,
  GetAnswerChunksTool,
  GetRecentDecisionsTool,
  RememberFactTool,
  RagAnswerTool,
  SaveSessionSummaryTool,
  SearchCodeTool,
  SearchDocsTool,
  SearchMemoryTool,
  UpdateMemoryEntryTool,
} from '../tools/agent-tools';
import { GetChunkNeighborsTool, GetDocumentContextTool } from '../tools/context-tools';
import {
  GetIndexStatusTool,
  GetResourceStatusTool,
  GetVectorBackendsTool,
  GetWorkspaceVectorPlacementTool,
  GetWorkspaceResourceStatusTool,
  GetWorkspaceStatusTool,
  LoadWorkspaceTool,
  ListKnowledgeBasesTool,
  ListWorkspacesTool,
  PinWorkspaceVectorBackendTool,
  RequestWorkspaceVectorMoveTool,
  RollbackVectorOperationTool,
  CleanupVectorOperationTool,
  UnloadWorkspaceTool,
} from '../tools/list-status-tools';
import { SearchCodebaseTool, SearchKbTool } from '../tools/search-tools';
import {
  GetConsumerDecisionsTool,
  ListConsumerWorkspacesTool,
  ReadDocumentTool,
  RetrieveContextTool,
  SearchConsumerMemoryTool,
} from '../tools/consumer-tools';
import {
  ArchiveMemoryTool,
  DeleteMemoryTool,
  isMemoryWriteKind,
  UpdateMemoryTool,
  WriteMemoryTool,
} from '../tools/memory-tools';
import { McpProfile, profileAllowsTool } from '../profile';

export function createToolHandlers(client: BackendApiClient) {
  return {
    askWorkspace: new AskWorkspaceTool(client),
    getAnswerChunks: new GetAnswerChunksTool(client),
    ragAnswer: new RagAnswerTool(client),
    answerWorkspace: new RagAnswerTool(client),
    listKnowledgeBases: new ListKnowledgeBasesTool(client),
    listWorkspaces: new ListWorkspacesTool(client),
    listConsumerWorkspaces: new ListConsumerWorkspacesTool(client),
    getIndexStatus: new GetIndexStatusTool(client),
    getWorkspaceStatus: new GetWorkspaceStatusTool(client),
    getResourceStatus: new GetResourceStatusTool(client),
    getWorkspaceResourceStatus: new GetWorkspaceResourceStatusTool(client),
    loadWorkspace: new LoadWorkspaceTool(client),
    unloadWorkspace: new UnloadWorkspaceTool(client),
    getVectorBackends: new GetVectorBackendsTool(client),
    getWorkspaceVectorPlacement: new GetWorkspaceVectorPlacementTool(client),
    pinWorkspaceVectorBackend: new PinWorkspaceVectorBackendTool(client),
    requestWorkspaceVectorMove: new RequestWorkspaceVectorMoveTool(client),
    rollbackVectorOperation: new RollbackVectorOperationTool(client),
    cleanupVectorOperation: new CleanupVectorOperationTool(client),
    searchKb: new SearchKbTool(client),
    searchCodebase: new SearchCodebaseTool(client),
    searchCode: new SearchCodeTool(client),
    searchDocs: new SearchDocsTool(client),
    searchMemory: new SearchMemoryTool(client),
    searchConsumerMemory: new SearchConsumerMemoryTool(client),
    getContextPackage: new GetContextPackageTool(client),
    getRecentDecisions: new GetRecentDecisionsTool(client),
    getConsumerDecisions: new GetConsumerDecisionsTool(client),
    saveSessionSummary: new SaveSessionSummaryTool(client),
    rememberFact: new RememberFactTool(client),
    updateMemoryEntry: new UpdateMemoryEntryTool(client),
    archiveMemoryEntry: new ArchiveMemoryEntryTool(client),
    deleteMemoryEntry: new DeleteMemoryEntryTool(client),
    getDocumentContext: new GetDocumentContextTool(client),
    getChunkNeighbors: new GetChunkNeighborsTool(client),
    retrieveContext: new RetrieveContextTool(client),
    readDocument: new ReadDocumentTool(client),
    writeMemory: new WriteMemoryTool(client),
    updateMemory: new UpdateMemoryTool(client),
    archiveMemory: new ArchiveMemoryTool(client),
    deleteMemory: new DeleteMemoryTool(client),
  };
}

export async function handleToolCall(
  name: string,
  args: unknown,
  handlers: ReturnType<typeof createToolHandlers>,
  profile?: McpProfile,
) {
  try {
    if (profile !== undefined && !profileAllowsTool(profile, name)) {
      throw new Error(`Tool '${name}' is not available in MCP profile '${profile}'`);
    }

    if (name === 'ask_workspace') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.askWorkspace.execute(
          requireString(input.workspaceId, 'workspaceId'),
          toAskInput(input, optionalAskMode(input.mode) || 'chunks'),
        ),
      );
    }

    if (name === 'get_answer_chunks') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.getAnswerChunks.execute(requireString(input.workspaceId, 'workspaceId'), toAskInput(input)),
      );
    }

    if (name === 'rag_answer') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.ragAnswer.execute(requireString(input.workspaceId, 'workspaceId'), toAskInput(input)),
      );
    }

    if (name === 'answer_workspace') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.answerWorkspace.execute(requireString(input.workspaceId, 'workspaceId'), toAskInput(input)),
      );
    }

    if (name === 'list_knowledge_bases') {
      return toMcpText(await handlers.listKnowledgeBases.execute());
    }

    if (name === 'list_workspaces') {
      return toMcpText(
        profile !== undefined && profile !== 'all'
          ? await handlers.listConsumerWorkspaces.execute()
          : await handlers.listWorkspaces.execute(),
      );
    }

    if (name === 'get_index_status') {
      const input = requireObject(args);
      return toMcpText(await handlers.getIndexStatus.execute(requireString(input.kbId, 'kbId')));
    }

    if (name === 'get_workspace_status') {
      const input = requireObject(args);
      return toMcpText(await handlers.getWorkspaceStatus.execute(requireString(input.workspaceId, 'workspaceId')));
    }

    if (name === 'get_resource_status') {
      return toMcpText(await handlers.getResourceStatus.execute());
    }

    if (name === 'get_workspace_resource_status') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.getWorkspaceResourceStatus.execute(requireString(input.workspaceId, 'workspaceId')),
      );
    }

    if (name === 'load_workspace') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.loadWorkspace.execute(requireString(input.workspaceId, 'workspaceId'), {
          storageProfile: optionalString(input.storageProfile),
        }),
      );
    }

    if (name === 'unload_workspace') {
      const input = requireObject(args);
      return toMcpText(await handlers.unloadWorkspace.execute(requireString(input.workspaceId, 'workspaceId')));
    }

    if (name === 'get_vector_backends') {
      return toMcpText(await handlers.getVectorBackends.execute());
    }

    if (name === 'get_workspace_vector_placement') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.getWorkspaceVectorPlacement.execute(requireString(input.workspaceId, 'workspaceId')),
      );
    }

    if (name === 'pin_workspace_vector_backend') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.pinWorkspaceVectorBackend.execute(
          requireString(input.workspaceId, 'workspaceId'),
          requireString(input.vectorBackendId, 'vectorBackendId'),
        ),
      );
    }

    if (name === 'request_workspace_vector_move') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.requestWorkspaceVectorMove.execute(
          requireString(input.workspaceId, 'workspaceId'),
          requireString(input.targetVectorBackendId, 'targetVectorBackendId'),
        ),
      );
    }

    if (name === 'rollback_vector_operation') {
      const input = requireObject(args);
      return toMcpText(await handlers.rollbackVectorOperation.execute(requireString(input.operationId, 'operationId')));
    }

    if (name === 'cleanup_vector_operation') {
      const input = requireObject(args);
      return toMcpText(await handlers.cleanupVectorOperation.execute(requireString(input.operationId, 'operationId')));
    }

    if (name === 'search_kb') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.searchKb.execute(
          requireString(input.kbId, 'kbId'),
          requireString(input.query, 'query'),
          optionalNumber(input.topK, 10),
        ),
      );
    }

    if (name === 'search_codebase') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.searchCodebase.execute(requireString(input.kbId, 'kbId'), requireString(input.query, 'query'), {
          topK: optionalNumber(input.topK, 10),
          pathPrefix: optionalString(input.pathPrefix),
          language: optionalString(input.language),
          branch: optionalString(input.branch),
        }),
      );
    }

    if (name === 'search_code') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.searchCode.execute(requireString(input.kbId, 'kbId'), requireString(input.query, 'query'), {
          topK: optionalNumber(input.topK, 10),
          pathPrefix: optionalString(input.pathPrefix),
          language: optionalString(input.language),
          branch: optionalString(input.branch),
        }),
      );
    }

    if (name === 'search_docs') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.searchDocs.execute(
          requireString(input.kbId, 'kbId'),
          requireString(input.query, 'query'),
          optionalNumber(input.topK, 10),
        ),
      );
    }

    if (name === 'search_memory') {
      const input = requireObject(args);
      if (profile !== undefined && profile !== 'all') {
        return toMcpText(
          await handlers.searchConsumerMemory.execute(
            requireString(input.workspaceId, 'workspaceId'),
            requireString(input.query, 'query'),
            optionalNumber(input.topK, 10),
          ),
        );
      }
      return toMcpText(
        await handlers.searchMemory.execute(
          requireString(input.kbId, 'kbId'),
          requireString(input.query, 'query'),
          optionalNumber(input.topK, 10),
        ),
      );
    }

    if (name === 'get_context_package') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.getContextPackage.execute(
          requireString(input.kbId, 'kbId'),
          requireString(input.query, 'query'),
          {
            topK: optionalNumber(input.topK, 10),
            profileKey: optionalString(input.profileKey),
            tokenBudget: optionalNumberNamed(input.tokenBudget, 'tokenBudget'),
            pathPrefix: optionalString(input.pathPrefix),
            language: optionalString(input.language),
            branch: optionalString(input.branch),
          },
        ),
      );
    }

    if (name === 'get_recent_decisions') {
      const input = requireObject(args);
      if (profile !== undefined && profile !== 'all') {
        return toMcpText(
          await handlers.getConsumerDecisions.execute(
            requireString(input.workspaceId, 'workspaceId'),
            optionalNumber(input.limit, 5),
          ),
        );
      }
      return toMcpText(
        await handlers.getRecentDecisions.execute(requireString(input.kbId, 'kbId'), optionalNumber(input.limit, 5)),
      );
    }

    if (name === 'save_session_summary') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.saveSessionSummary.execute(requireString(input.kbId, 'kbId'), {
          sessionId: requireString(input.sessionId, 'sessionId'),
          body: requireString(input.body, 'body'),
          title: optionalString(input.title),
          summary: optionalString(input.summary),
          authoredBy: optionalString(input.authoredBy),
        }),
      );
    }

    if (name === 'remember_fact') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.rememberFact.execute(requireString(input.kbId, 'kbId'), {
          body: requireString(input.body, 'body'),
          title: optionalString(input.title),
          summary: optionalString(input.summary),
          authoredBy: optionalString(input.authoredBy),
          sessionId: optionalString(input.sessionId),
        }),
      );
    }

    if (name === 'update_memory_entry') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.updateMemoryEntry.execute(
          requireString(input.kbId, 'kbId'),
          requireString(input.entryId, 'entryId'),
          {
            entryType: optionalString(input.entryType),
            body: optionalString(input.body),
            title: optionalString(input.title),
            summary: optionalString(input.summary),
            authoredBy: optionalString(input.authoredBy),
            sessionId: optionalString(input.sessionId),
            tags: optionalStringArray(input.tags, 'tags'),
            sourceRefs: optionalStringArray(input.sourceRefs, 'sourceRefs'),
            occurredAt: optionalString(input.occurredAt),
            metadata: optionalObject(input.metadata, 'metadata'),
          },
        ),
      );
    }

    if (name === 'archive_memory_entry') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.archiveMemoryEntry.execute(
          requireString(input.kbId, 'kbId'),
          requireString(input.entryId, 'entryId'),
          optionalString(input.reason),
        ),
      );
    }

    if (name === 'delete_memory_entry') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.deleteMemoryEntry.execute(
          requireString(input.kbId, 'kbId'),
          requireString(input.entryId, 'entryId'),
        ),
      );
    }

    if (name === 'get_document_context') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.getDocumentContext.execute({
          documentId: requireString(input.documentId, 'documentId'),
          chunkId: optionalString(input.chunkId),
          startLine: optionalNumberNamed(input.startLine, 'startLine'),
          endLine: optionalNumberNamed(input.endLine, 'endLine'),
          maxChars: optionalNumberNamed(input.maxChars, 'maxChars'),
        }),
      );
    }

    if (name === 'get_chunk_neighbors') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.getChunkNeighbors.execute(requireString(input.chunkId, 'chunkId'), {
          before: optionalNumberNamed(input.before, 'before'),
          after: optionalNumberNamed(input.after, 'after'),
        }),
      );
    }

    if (name === 'retrieve_context') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.retrieveContext.execute({
          workspaceId: requireString(input.workspaceId, 'workspaceId'),
          query: requireString(input.query, 'query'),
          topK: optionalNumber(input.topK, 10),
          pathPrefix: optionalString(input.pathPrefix),
          language: optionalString(input.language),
          branch: optionalString(input.branch),
          scoreThreshold: optionalNumberNamed(input.scoreThreshold, 'scoreThreshold'),
          tokenBudget: optionalNumberNamed(input.tokenBudget, 'tokenBudget'),
        }),
      );
    }

    if (name === 'read_document') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.readDocument.execute({
          documentId: requireString(input.documentId, 'documentId'),
          chunkId: optionalString(input.chunkId),
          startLine: optionalNumberNamed(input.startLine, 'startLine'),
          endLine: optionalNumberNamed(input.endLine, 'endLine'),
          maxChars: optionalNumberNamed(input.maxChars, 'maxChars'),
        }),
      );
    }

    if (name === 'write_memory') {
      const input = requireObject(args);
      const kind = input.kind;
      if (!isMemoryWriteKind(kind)) {
        throw new Error('kind must be fact, session_summary, or decision');
      }
      return toMcpText(
        await handlers.writeMemory.execute({
          workspaceId: requireString(input.workspaceId, 'workspaceId'),
          kind,
          body: requireString(input.body, 'body'),
          title: optionalString(input.title),
          summary: optionalString(input.summary),
          sessionId: optionalString(input.sessionId),
          authoredBy: optionalString(input.authoredBy),
          tags: optionalStringArray(input.tags, 'tags'),
          sourceRefs: optionalStringArray(input.sourceRefs, 'sourceRefs'),
          occurredAt: optionalString(input.occurredAt),
          metadata: optionalObject(input.metadata, 'metadata'),
        }),
      );
    }

    if (name === 'update_memory') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.updateMemory.execute(
          requireString(input.workspaceId, 'workspaceId'),
          requireString(input.entryId, 'entryId'),
          {
            entryType: optionalString(input.entryType),
            body: optionalString(input.body),
            title: optionalString(input.title),
            summary: optionalString(input.summary),
            tags: optionalStringArray(input.tags, 'tags'),
            authoredBy: optionalString(input.authoredBy),
            sessionId: optionalString(input.sessionId),
            sourceRefs: optionalStringArray(input.sourceRefs, 'sourceRefs'),
            occurredAt: optionalString(input.occurredAt),
            metadata: optionalObject(input.metadata, 'metadata'),
          },
        ),
      );
    }

    if (name === 'archive_memory') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.archiveMemory.execute(
          requireString(input.workspaceId, 'workspaceId'),
          requireString(input.entryId, 'entryId'),
          optionalString(input.reason),
        ),
      );
    }

    if (name === 'delete_memory') {
      const input = requireObject(args);
      return toMcpText(
        await handlers.deleteMemory.execute(
          requireString(input.workspaceId, 'workspaceId'),
          requireString(input.entryId, 'entryId'),
        ),
      );
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: unknown) {
    const normalized = normalizeMcpError(error);
    return toMcpText(normalized);
  }
}

function toMcpText(value: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error('topK must be a number');
  }
  return value;
}

function optionalNumberNamed(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

function optionalObject(value: unknown, name: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalAskMode(value: unknown): 'chunks' | 'rag_answer' | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value !== 'chunks' && value !== 'rag_answer') {
    throw new Error('mode must be chunks or rag_answer');
  }
  return value;
}

function toAskInput(input: Record<string, unknown>, mode?: 'chunks' | 'rag_answer') {
  const llmProviderId = optionalString(input.llmProviderId);
  const maxOutputTokens = optionalNumberNamed(input.maxOutputTokens, 'maxOutputTokens');
  const temperature = optionalNumberNamed(input.temperature, 'temperature');
  return {
    ...(mode ? { mode } : {}),
    query: requireString(input.query, 'query'),
    topK: optionalNumberNamed(input.topK, 'topK'),
    profileKey: optionalString(input.profileKey),
    tokenBudget: optionalNumberNamed(input.tokenBudget, 'tokenBudget'),
    ...(llmProviderId !== undefined || maxOutputTokens !== undefined || temperature !== undefined
      ? {
          llm: {
            providerId: llmProviderId,
            maxOutputTokens,
            temperature,
          },
        }
      : {}),
  };
}

function normalizeMcpError(error: unknown): {
  error: string;
  status?: unknown;
  body?: unknown;
} {
  if (!error || typeof error !== 'object') {
    return { error: 'Tool call failed' };
  }

  const record = error as Record<string, unknown>;
  return {
    error: typeof record.message === 'string' && record.message.length > 0 ? record.message : 'Tool call failed',
    status: record.status,
    body: record.body,
  };
}
