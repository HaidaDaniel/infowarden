export const toolDefinitions = [
  {
    name: 'ask_workspace',
    description: 'Retrieve chunks or generate one citation-preserving answer through the backend',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        query: { type: 'string', description: 'Question or retrieval query' },
        mode: {
          type: 'string',
          enum: ['chunks', 'rag_answer'],
          description: 'Output mode',
          default: 'chunks',
        },
        topK: { type: 'number', description: 'Number of base retrieval hits' },
        profileKey: { type: 'string', description: 'Optional retrieval profile key' },
        tokenBudget: { type: 'number', description: 'Optional retrieval context budget' },
        llmProviderId: { type: 'string', description: 'Optional LLM ProviderConfig ID' },
        maxOutputTokens: { type: 'number', description: 'Optional bounded answer token limit' },
        temperature: { type: 'number', description: 'Optional answer temperature from 0 to 2' },
      },
      required: ['workspaceId', 'query'],
    },
  },
  {
    name: 'get_answer_chunks',
    description: 'Return answer-ready retrieval chunks without making an LLM call',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        query: { type: 'string', description: 'Retrieval query' },
        topK: { type: 'number', description: 'Number of base retrieval hits' },
        profileKey: { type: 'string', description: 'Optional retrieval profile key' },
        tokenBudget: { type: 'number', description: 'Optional retrieval context budget' },
      },
      required: ['workspaceId', 'query'],
    },
  },
  {
    name: 'rag_answer',
    description: 'Generate one provider-backed answer with citations and retrieval trace',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        query: { type: 'string', description: 'Question to answer' },
        topK: { type: 'number', description: 'Number of base retrieval hits' },
        profileKey: { type: 'string', description: 'Optional retrieval profile key' },
        tokenBudget: { type: 'number', description: 'Optional retrieval context budget' },
        llmProviderId: { type: 'string', description: 'Optional LLM ProviderConfig ID' },
        maxOutputTokens: { type: 'number', description: 'Optional bounded answer token limit' },
        temperature: { type: 'number', description: 'Optional answer temperature from 0 to 2' },
      },
      required: ['workspaceId', 'query'],
    },
  },
  {
    name: 'list_knowledge_bases',
    description: 'List all available knowledge bases',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_workspaces',
    description: 'List all available workspaces using the workspace compatibility surface',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_index_status',
    description: 'Get active index status for a knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base ID' },
      },
      required: ['kbId'],
    },
  },
  {
    name: 'get_workspace_status',
    description: 'Get workspace status through the workspace compatibility surface',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_resource_status',
    description: 'Inspect host, disk, Qdrant, and dev-target resource status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_workspace_resource_status',
    description: 'Inspect workspace lifecycle, active index, storage profile, and resource estimate',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'load_workspace',
    description: 'Load or rebuild a workspace vector collection before retrieval',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        storageProfile: {
          type: 'string',
          description: 'Optional storage profile: fast, balanced, low_memory, benchmark_remote',
        },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'unload_workspace',
    description: 'Unload a workspace vector collection to release Qdrant resources',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_vector_backends',
    description: 'Inspect vector backend health, capacity, assigned workspaces, and operations',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_workspace_vector_placement',
    description: 'Inspect the selected vector backend placement for a workspace',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'pin_workspace_vector_backend',
    description: 'Pin an unloaded or eligible workspace to a vector backend through backend policy',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        vectorBackendId: { type: 'string', description: 'Registered vector backend ID' },
      },
      required: ['workspaceId', 'vectorBackendId'],
    },
  },
  {
    name: 'request_workspace_vector_move',
    description: 'Create an explicit backend move operation; does not silently rebalance or fail over',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        targetVectorBackendId: {
          type: 'string',
          description: 'Target registered vector backend ID',
        },
      },
      required: ['workspaceId', 'targetVectorBackendId'],
    },
  },
  {
    name: 'rollback_vector_operation',
    description: 'Request rollback of a completed vector operation within its retention window',
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', description: 'Vector materialization operation ID' },
      },
      required: ['operationId'],
    },
  },
  {
    name: 'cleanup_vector_operation',
    description: 'Schedule safe cleanup after vector operation rollback retention',
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', description: 'Vector materialization operation ID' },
      },
      required: ['operationId'],
    },
  },
  {
    name: 'search_kb',
    description: 'Search a knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base ID' },
        query: { type: 'string', description: 'Search query' },
        topK: { type: 'number', description: 'Number of results to return', default: 10 },
      },
      required: ['kbId', 'query'],
    },
  },
  {
    name: 'search_codebase',
    description: 'Search a codebase knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base ID' },
        query: { type: 'string', description: 'Search query' },
        topK: { type: 'number', description: 'Number of results to return', default: 10 },
        pathPrefix: { type: 'string', description: 'Optional path prefix filter' },
        language: { type: 'string', description: 'Optional language filter' },
        branch: { type: 'string', description: 'Optional branch filter' },
      },
      required: ['kbId', 'query'],
    },
  },
  {
    name: 'search_code',
    description: 'Search code using a code-oriented retrieval profile',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base or workspace ID' },
        query: { type: 'string', description: 'Code search query' },
        topK: { type: 'number', description: 'Number of results to return', default: 10 },
        pathPrefix: { type: 'string', description: 'Optional path prefix filter' },
        language: { type: 'string', description: 'Optional language filter' },
        branch: { type: 'string', description: 'Optional branch filter' },
      },
      required: ['kbId', 'query'],
    },
  },
  {
    name: 'search_docs',
    description: 'Search documentation using a docs-oriented retrieval profile',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base or workspace ID' },
        query: { type: 'string', description: 'Documentation search query' },
        topK: { type: 'number', description: 'Number of results to return', default: 10 },
      },
      required: ['kbId', 'query'],
    },
  },
  {
    name: 'search_memory',
    description: 'Search memory entries using a memory-oriented retrieval profile',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base or workspace ID' },
        query: { type: 'string', description: 'Memory search query' },
        topK: { type: 'number', description: 'Number of results to return', default: 10 },
      },
      required: ['kbId', 'query'],
    },
  },
  {
    name: 'get_context_package',
    description: 'Build a grouped context package for an agent query',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base or workspace ID' },
        query: { type: 'string', description: 'Context query' },
        topK: { type: 'number', description: 'Number of base retrieval hits', default: 10 },
        profileKey: { type: 'string', description: 'Optional retrieval profile key' },
        tokenBudget: { type: 'number', description: 'Optional token budget' },
        pathPrefix: { type: 'string', description: 'Optional path prefix filter' },
        language: { type: 'string', description: 'Optional language filter' },
        branch: { type: 'string', description: 'Optional branch filter' },
      },
      required: ['kbId', 'query'],
    },
  },
  {
    name: 'get_recent_decisions',
    description: 'List recent decision notes from memory entries',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base or workspace ID' },
        limit: { type: 'number', description: 'Maximum number of decisions to return', default: 5 },
      },
      required: ['kbId'],
    },
  },
  {
    name: 'save_session_summary',
    description: 'Save a session summary into memory',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base or workspace ID' },
        sessionId: { type: 'string', description: 'Session identifier' },
        body: { type: 'string', description: 'Full summary body' },
        title: { type: 'string', description: 'Optional title' },
        summary: { type: 'string', description: 'Optional short summary' },
        authoredBy: { type: 'string', description: 'Optional actor or agent name' },
      },
      required: ['kbId', 'sessionId', 'body'],
    },
  },
  {
    name: 'remember_fact',
    description: 'Save a durable fact into memory',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base or workspace ID' },
        body: { type: 'string', description: 'Fact body' },
        title: { type: 'string', description: 'Optional title' },
        summary: { type: 'string', description: 'Optional short summary' },
        authoredBy: { type: 'string', description: 'Optional actor or agent name' },
        sessionId: { type: 'string', description: 'Optional session identifier' },
      },
      required: ['kbId', 'body'],
    },
  },
  {
    name: 'update_memory_entry',
    description: 'Update an existing memory entry without creating a duplicate',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base or workspace ID' },
        entryId: { type: 'string', description: 'Memory entry ID' },
        entryType: { type: 'string', description: 'Optional replacement memory entry type' },
        body: { type: 'string', description: 'Optional replacement body' },
        title: { type: 'string', description: 'Optional replacement title' },
        summary: { type: 'string', description: 'Optional replacement summary' },
        authoredBy: { type: 'string', description: 'Optional actor or agent name' },
        sessionId: { type: 'string', description: 'Optional session identifier' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional replacement tags',
        },
        sourceRefs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional replacement source refs',
        },
        occurredAt: { type: 'string', description: 'Optional ISO timestamp' },
        metadata: { type: 'object', description: 'Optional metadata merge' },
      },
      required: ['kbId', 'entryId'],
    },
  },
  {
    name: 'archive_memory_entry',
    description: 'Archive a stale memory entry so it no longer appears in memory retrieval',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base or workspace ID' },
        entryId: { type: 'string', description: 'Memory entry ID' },
        reason: { type: 'string', description: 'Optional archive reason' },
      },
      required: ['kbId', 'entryId'],
    },
  },
  {
    name: 'delete_memory_entry',
    description: 'Hard delete a memory entry after workspace ownership validation',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: 'Knowledge base or workspace ID' },
        entryId: { type: 'string', description: 'Memory entry ID' },
      },
      required: ['kbId', 'entryId'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'get_document_context',
    description: 'Fetch text context for a document or chunk',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        chunkId: { type: 'string', description: 'Optional chunk ID within the document' },
        startLine: { type: 'number', description: 'Optional start line' },
        endLine: { type: 'number', description: 'Optional end line' },
        maxChars: { type: 'number', description: 'Optional max characters to return' },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'get_chunk_neighbors',
    description: 'Fetch chunks before and after a known chunk',
    inputSchema: {
      type: 'object',
      properties: {
        chunkId: { type: 'string', description: 'Chunk ID' },
        before: { type: 'number', description: 'Chunks before the target chunk', default: 1 },
        after: { type: 'number', description: 'Chunks after the target chunk', default: 1 },
      },
      required: ['chunkId'],
    },
  },
];

export const profileToolDefinitions = [
  {
    name: 'retrieve_context',
    description: 'Retrieve compact workspace context chunks with source, line, and token budget metadata',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        query: { type: 'string', description: 'Retrieval query' },
        topK: { type: 'number', description: 'Number of results to return (max 50)', default: 10 },
        pathPrefix: { type: 'string', description: 'Optional path prefix filter' },
        language: { type: 'string', description: 'Optional language filter' },
        branch: { type: 'string', description: 'Optional branch filter' },
        scoreThreshold: { type: 'number', description: 'Optional minimum score threshold' },
        tokenBudget: { type: 'number', description: 'Optional token budget' },
      },
      required: ['workspaceId', 'query'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_document',
    description: 'Read document or chunk context by ID',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        chunkId: { type: 'string', description: 'Optional chunk ID within the document' },
        startLine: { type: 'number', description: 'Optional start line' },
        endLine: { type: 'number', description: 'Optional end line' },
        maxChars: { type: 'number', description: 'Optional max characters to return' },
      },
      required: ['documentId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'answer_workspace',
    description: 'Generate one optional provider-backed workspace answer with citations; this is not recursive RLM',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        query: { type: 'string', description: 'Question to answer' },
        topK: { type: 'number', description: 'Number of base retrieval hits' },
        profileKey: { type: 'string', description: 'Optional retrieval profile key' },
        tokenBudget: { type: 'number', description: 'Optional retrieval context budget' },
        llmProviderId: { type: 'string', description: 'Optional LLM ProviderConfig ID' },
        maxOutputTokens: { type: 'number', description: 'Optional bounded answer token limit' },
        temperature: { type: 'number', description: 'Optional answer temperature from 0 to 2' },
      },
      required: ['workspaceId', 'query'],
    },
  },
  {
    name: 'write_memory',
    description: 'Write an InfoWarden-owned memory entry (fact, session_summary, or decision)',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        kind: {
          type: 'string',
          enum: ['fact', 'session_summary', 'decision'],
          description: 'Memory entry kind',
        },
        body: { type: 'string', description: 'Memory body' },
        title: { type: 'string', description: 'Optional title' },
        summary: { type: 'string', description: 'Optional short summary' },
        sessionId: { type: 'string', description: 'Session identifier (required for session_summary)' },
        authoredBy: { type: 'string', description: 'Optional actor or agent name' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags',
        },
        sourceRefs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional source refs',
        },
        occurredAt: { type: 'string', description: 'Optional ISO timestamp' },
        metadata: { type: 'object', description: 'Optional metadata' },
      },
      required: ['workspaceId', 'kind', 'body'],
    },
  },
  {
    name: 'update_memory',
    description: 'Update an existing InfoWarden-owned memory entry without creating a duplicate',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        entryId: { type: 'string', description: 'Memory entry ID' },
        entryType: { type: 'string', description: 'Optional replacement memory entry type' },
        body: { type: 'string', description: 'Optional replacement body' },
        title: { type: 'string', description: 'Optional replacement title' },
        summary: { type: 'string', description: 'Optional replacement summary' },
        authoredBy: { type: 'string', description: 'Optional actor or agent name' },
        sessionId: { type: 'string', description: 'Optional session identifier' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional replacement tags',
        },
        sourceRefs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional replacement source refs',
        },
        occurredAt: { type: 'string', description: 'Optional ISO timestamp' },
        metadata: { type: 'object', description: 'Optional metadata merge' },
      },
      required: ['workspaceId', 'entryId'],
    },
  },
  {
    name: 'archive_memory',
    description: 'Archive a stale InfoWarden-owned memory entry so it no longer appears in memory retrieval',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        entryId: { type: 'string', description: 'Memory entry ID' },
        reason: { type: 'string', description: 'Optional archive reason' },
      },
      required: ['workspaceId', 'entryId'],
    },
  },
  {
    name: 'delete_memory',
    description: 'Hard delete an InfoWarden-owned memory entry after workspace ownership validation',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        entryId: { type: 'string', description: 'Memory entry ID' },
      },
      required: ['workspaceId', 'entryId'],
    },
    annotations: { destructiveHint: true },
  },
];

export const mcpToolDefinitions = [...toolDefinitions, ...profileToolDefinitions];

export const consumerToolDefinitionOverrides = [
  {
    name: 'search_memory',
    description: 'Search compact InfoWarden-owned durable memory for a workspace',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        query: { type: 'string', description: 'Memory search query' },
        topK: { type: 'number', description: 'Number of results to return', default: 10 },
      },
      required: ['workspaceId', 'query'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_recent_decisions',
    description: 'List compact recent caller-authored decision memory for a workspace',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID or slug' },
        limit: { type: 'number', description: 'Maximum number of decisions to return', default: 5 },
      },
      required: ['workspaceId'],
    },
    annotations: { readOnlyHint: true },
  },
];

export const mcpToolDefinitionMap = new Map(mcpToolDefinitions.map((tool) => [tool.name, tool]));
export const consumerToolDefinitionOverrideMap = new Map(
  consumerToolDefinitionOverrides.map((tool) => [tool.name, tool]),
);
