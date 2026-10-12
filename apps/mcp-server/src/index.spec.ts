jest.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  const mockInstances: Array<{ setRequestHandler: jest.Mock; connect: jest.Mock }> = [];
  const Server = jest.fn().mockImplementation(() => {
    const instance = {
      setRequestHandler: jest.fn(),
      connect: jest.fn().mockImplementation(() => null),
    };
    mockInstances.push(instance);
    return instance;
  });
  (Server as unknown as { mockInstances: typeof mockInstances }).mockInstances = mockInstances;
  return { Server };
});

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: {},
  ListToolsRequestSchema: {},
}));

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  consumerToolDefinitionOverrides,
  createContextForgeServer,
  createToolHandlers,
  getConfig,
  handleToolCall,
  mcpToolDefinitions,
  profileToolDefinitions,
  toolDefinitions,
} from './index';
import { BackendApiClient } from './backend-client';
import { resolveMcpProfile, toolsForProfile } from './profile';

const serverMockInstances = (
  Server as unknown as {
    mockInstances: Array<{ setRequestHandler: jest.Mock; connect: jest.Mock }>;
  }
).mockInstances;

describe('MCP tool handling', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('registers MVP tools', () => {
    expect(toolDefinitions.map((tool) => tool.name).sort()).toEqual([
      'archive_memory_entry',
      'ask_workspace',
      'cleanup_vector_operation',
      'delete_memory_entry',
      'get_answer_chunks',
      'get_chunk_neighbors',
      'get_context_package',
      'get_document_context',
      'get_index_status',
      'get_recent_decisions',
      'get_resource_status',
      'get_vector_backends',
      'get_workspace_resource_status',
      'get_workspace_status',
      'get_workspace_vector_placement',
      'list_knowledge_bases',
      'list_workspaces',
      'load_workspace',
      'pin_workspace_vector_backend',
      'rag_answer',
      'remember_fact',
      'request_workspace_vector_move',
      'rollback_vector_operation',
      'save_session_summary',
      'search_code',
      'search_codebase',
      'search_docs',
      'search_kb',
      'search_memory',
      'unload_workspace',
      'update_memory_entry',
    ]);
  });

  it('keeps ask tools as thin backend wrappers with fixed mode helpers', async () => {
    const client = {
      ask: jest.fn().mockResolvedValue({
        mode: 'rag_answer',
        knowledgeBaseId: 'kb-1',
        retrievalTraceId: 'trace-1',
        citations: [{ id: 'C1', chunkId: 'chunk-1' }],
      }),
    } as unknown as BackendApiClient;
    const handlers = createToolHandlers(client);

    await handleToolCall(
      'ask_workspace',
      {
        workspaceId: 'docs',
        query: 'Where is truth?',
        mode: 'rag_answer',
        llmProviderId: 'llm-1',
        maxOutputTokens: 400,
        temperature: 0,
      },
      handlers,
    );
    await handleToolCall('get_answer_chunks', { workspaceId: 'docs', query: 'Where is truth?' }, handlers);
    const response = await handleToolCall('rag_answer', { workspaceId: 'docs', query: 'Where is truth?' }, handlers);

    expect(client.ask).toHaveBeenNthCalledWith(1, 'docs', {
      mode: 'rag_answer',
      query: 'Where is truth?',
      topK: undefined,
      profileKey: undefined,
      tokenBudget: undefined,
      llm: {
        providerId: 'llm-1',
        maxOutputTokens: 400,
        temperature: 0,
      },
    });
    expect(client.ask).toHaveBeenNthCalledWith(2, 'docs', {
      mode: 'chunks',
      query: 'Where is truth?',
      topK: undefined,
      profileKey: undefined,
      tokenBudget: undefined,
    });
    expect(client.ask).toHaveBeenNthCalledWith(3, 'docs', {
      mode: 'rag_answer',
      query: 'Where is truth?',
      topK: undefined,
      profileKey: undefined,
      tokenBudget: undefined,
    });
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      retrievalTraceId: 'trace-1',
      citations: [{ id: 'C1' }],
    });
  });

  it('smoke tests list_workspaces', async () => {
    const client = {
      listWorkspaces: jest.fn().mockResolvedValue([
        {
          id: 'kb-1',
          slug: 'docs',
          name: 'Docs',
          workspaceKind: 'docs',
          activeIndexVersionId: 'index-1',
        },
      ]),
    } as unknown as BackendApiClient;
    const response = await handleToolCall('list_workspaces', {}, createToolHandlers(client));

    expect(JSON.parse(response.content[0].text)).toEqual({
      workspaces: [
        {
          id: 'kb-1',
          slug: 'docs',
          name: 'Docs',
          kind: 'docs',
          activeIndexVersionId: 'index-1',
          status: 'ready',
          compatibility: {
            legacyKnowledgeBaseId: 'kb-1',
            legacyToolFamily: 'knowledge_base',
          },
        },
      ],
      count: 1,
    });
  });

  it('reports indexed workspaces as unavailable when their embedding provider is down', async () => {
    const client = {
      listWorkspaces: jest.fn().mockResolvedValue([
        {
          id: 'kb-1',
          slug: 'external-docs',
          name: 'External docs',
          workspaceKind: 'docs',
          activeIndexVersionId: 'index-1',
          availability: {
            status: 'unavailable',
            reason: 'embedding_connection_refused',
            retryable: true,
          },
        },
      ]),
    } as unknown as BackendApiClient;

    const response = await handleToolCall('list_workspaces', {}, createToolHandlers(client));

    expect(JSON.parse(response.content[0].text)).toMatchObject({
      workspaces: [
        {
          id: 'kb-1',
          activeIndexVersionId: 'index-1',
          status: 'unavailable',
          unavailableReason: 'embedding_connection_refused',
        },
      ],
    });
  });

  it('smoke tests get_workspace_status', async () => {
    const client = {
      getWorkspace: jest.fn().mockResolvedValue({
        id: 'kb-1',
        slug: 'career-rag',
        name: 'Career RAG',
        workspaceKind: 'codebase',
        activeIndexVersionId: 'index-1',
        defaultIndexProfile: 'code-default',
        defaultRetrievalProfile: 'code-debug',
      }),
    } as unknown as BackendApiClient;
    const response = await handleToolCall(
      'get_workspace_status',
      { workspaceId: 'career-rag' },
      createToolHandlers(client),
    );

    expect(client.getWorkspace).toHaveBeenCalledWith('career-rag');
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      workspaceId: 'kb-1',
      slug: 'career-rag',
      kind: 'codebase',
      status: 'ready',
      compatibility: {
        legacyKnowledgeBaseId: 'kb-1',
        legacyToolsRemainAvailable: true,
      },
    });
  });

  it('smoke tests get_resource_status', async () => {
    const client = {
      getResourceStatus: jest.fn().mockResolvedValue({
        target: { cpuCores: 4, ramBytes: 8589934592 },
        host: { cpuCores: 4 },
        disks: [],
        qdrant: { collections: 2, items: [] },
        warnings: [],
      }),
    } as unknown as BackendApiClient;
    const response = await handleToolCall('get_resource_status', {}, createToolHandlers(client));

    expect(client.getResourceStatus).toHaveBeenCalledWith();
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      target: { cpuCores: 4 },
      qdrant: { collections: 2 },
    });
  });

  it('smoke tests get_workspace_resource_status', async () => {
    const client = {
      getWorkspaceResourceStatus: jest.fn().mockResolvedValue({
        workspace: { id: 'kb-1', slug: 'career-rag', name: 'Career RAG', kind: 'docs' },
        lifecycle: {
          status: 'loaded',
          activeIndexVersionId: 'index-1',
          vectorCollectionName: 'cf_career_active',
          collectionAvailable: true,
        },
        activeIndexVersion: {
          id: 'index-1',
          status: 'active',
          lifecycleStatus: 'loaded',
          embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
          embeddingDimension: 384,
          storageProfile: 'balanced',
          createdAt: '2026-07-15T00:00:00.000Z',
        },
      }),
    } as unknown as BackendApiClient;
    const response = await handleToolCall(
      'get_workspace_resource_status',
      { workspaceId: 'career-rag' },
      createToolHandlers(client),
    );

    expect(client.getWorkspaceResourceStatus).toHaveBeenCalledWith('career-rag');
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      workspace: { slug: 'career-rag' },
      lifecycle: { status: 'loaded', collectionAvailable: true },
    });
  });

  it('smoke tests workspace lifecycle tools', async () => {
    const client = {
      loadWorkspace: jest.fn().mockResolvedValue({
        workspace: { id: 'kb-1', slug: 'career-rag', name: 'Career RAG', kind: 'docs' },
        lifecycle: { status: 'loading', collectionAvailable: false },
        job: { id: 'job-1' },
      }),
      unloadWorkspace: jest.fn().mockResolvedValue({
        workspace: { id: 'kb-1', slug: 'career-rag', name: 'Career RAG', kind: 'docs' },
        lifecycle: { status: 'unloaded', collectionAvailable: false },
      }),
    } as unknown as BackendApiClient;

    const loadResponse = await handleToolCall(
      'load_workspace',
      { workspaceId: 'career-rag', storageProfile: 'low_memory' },
      createToolHandlers(client),
    );
    const unloadResponse = await handleToolCall(
      'unload_workspace',
      { workspaceId: 'career-rag' },
      createToolHandlers(client),
    );

    expect(client.loadWorkspace).toHaveBeenCalledWith('career-rag', {
      storageProfile: 'low_memory',
    });
    expect(client.unloadWorkspace).toHaveBeenCalledWith('career-rag');
    expect(JSON.parse(loadResponse.content[0].text)).toMatchObject({
      lifecycle: { status: 'loading' },
      job: { id: 'job-1' },
    });
    expect(JSON.parse(unloadResponse.content[0].text)).toMatchObject({
      lifecycle: { status: 'unloaded' },
    });
  });

  it('smoke tests vector backend operations tools', async () => {
    const client = {
      getVectorBackends: jest.fn().mockResolvedValue({
        policy: { transparentSharding: false, replicas: false },
        backends: [{ id: 'backend-1', apiKeyRef: '[configured]' }],
      }),
      getWorkspaceVectorPlacement: jest.fn().mockResolvedValue({
        id: 'placement-1',
        vectorBackendId: 'backend-1',
        state: 'loaded',
      }),
      pinWorkspaceVectorBackend: jest.fn().mockResolvedValue({
        id: 'placement-1',
        vectorBackendId: 'backend-2',
        mode: 'pinned',
      }),
      createVectorOperation: jest.fn().mockResolvedValue({
        id: 'op-1',
        kind: 'backend_move',
        state: 'planned',
      }),
      rollbackVectorOperation: jest.fn().mockResolvedValue({
        id: 'op-1',
        state: 'rollback_complete',
      }),
      cleanupVectorOperation: jest.fn().mockResolvedValue({
        id: 'op-1',
        state: 'cleanup_pending',
      }),
    } as unknown as BackendApiClient;
    const handlers = createToolHandlers(client);

    await handleToolCall('get_vector_backends', {}, handlers);
    await handleToolCall('get_workspace_vector_placement', { workspaceId: 'career-rag' }, handlers);
    await handleToolCall(
      'pin_workspace_vector_backend',
      { workspaceId: 'career-rag', vectorBackendId: 'backend-2' },
      handlers,
    );
    await handleToolCall(
      'request_workspace_vector_move',
      { workspaceId: 'career-rag', targetVectorBackendId: 'backend-2' },
      handlers,
    );
    await handleToolCall('rollback_vector_operation', { operationId: 'op-1' }, handlers);
    const cleanup = await handleToolCall('cleanup_vector_operation', { operationId: 'op-1' }, handlers);

    expect(client.getVectorBackends).toHaveBeenCalledWith();
    expect(client.getWorkspaceVectorPlacement).toHaveBeenCalledWith('career-rag');
    expect(client.pinWorkspaceVectorBackend).toHaveBeenCalledWith('career-rag', 'backend-2');
    expect(client.createVectorOperation).toHaveBeenCalledWith('career-rag', {
      kind: 'backend_move',
      targetVectorBackendId: 'backend-2',
    });
    expect(client.rollbackVectorOperation).toHaveBeenCalledWith('op-1');
    expect(JSON.parse(cleanup.content[0].text)).toMatchObject({ state: 'cleanup_pending' });
  });

  it('smoke tests list_knowledge_bases', async () => {
    const client = {
      listKnowledgeBases: jest.fn().mockResolvedValue([{ id: 'kb-1', name: 'Docs', activeIndexVersionId: 'index-1' }]),
    } as unknown as BackendApiClient;
    const response = await handleToolCall('list_knowledge_bases', {}, createToolHandlers(client));

    expect(JSON.parse(response.content[0].text)).toEqual({
      knowledgeBases: [
        {
          id: 'kb-1',
          name: 'Docs',
          activeIndexVersionId: 'index-1',
          status: 'ready',
        },
      ],
      count: 1,
    });
  });

  it('smoke tests search_kb', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({
        knowledgeBaseId: 'kb-1',
        indexVersionId: 'index-1',
        results: [
          {
            chunkId: 'chunk-1',
            documentId: 'doc-1',
            text: 'Answer text',
            score: 0.8,
            path: 'docs/a.md',
            startLine: 1,
            endLine: 2,
          },
        ],
        count: 1,
      }),
    } as unknown as BackendApiClient;
    const response = await handleToolCall(
      'search_kb',
      { kbId: 'kb-1', query: 'answer', topK: 100 },
      createToolHandlers(client),
    );

    expect(client.search).toHaveBeenCalledWith('kb-1', 'answer', 50);
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      kbId: 'kb-1',
      indexVersionId: 'index-1',
      results: [
        {
          chunkId: 'chunk-1',
          text: 'Answer text',
          score: 0.8,
          documentId: 'doc-1',
          path: 'docs/a.md',
        },
      ],
      count: 1,
    });
  });

  it('returns understandable tool errors', async () => {
    const response = await handleToolCall('search_kb', { kbId: 'kb-1' }, createToolHandlers({} as BackendApiClient));

    expect(JSON.parse(response.content[0].text)).toEqual({
      error: 'query must be a non-empty string',
    });
  });

  it('smoke tests get_document_context', async () => {
    const client = {
      getDocumentContext: jest.fn().mockResolvedValue({
        documentId: 'doc-1',
        path: 'docs/a.md',
        text: 'Context',
        metadata: { chunkId: 'chunk-1' },
      }),
    } as unknown as BackendApiClient;
    const response = await handleToolCall(
      'get_document_context',
      { documentId: 'doc-1', chunkId: 'chunk-1', maxChars: 2000 },
      createToolHandlers(client),
    );

    expect(client.getDocumentContext).toHaveBeenCalledWith({
      documentId: 'doc-1',
      chunkId: 'chunk-1',
      startLine: undefined,
      endLine: undefined,
      maxChars: 2000,
    });
    expect(JSON.parse(response.content[0].text)).toEqual({
      documentId: 'doc-1',
      path: 'docs/a.md',
      text: 'Context',
      metadata: { chunkId: 'chunk-1' },
    });
  });

  it('smoke tests get_chunk_neighbors', async () => {
    const client = {
      getChunkNeighbors: jest.fn().mockResolvedValue({
        chunkId: 'chunk-2',
        neighbors: [
          {
            chunkId: 'chunk-1',
            chunkIndex: 1,
            text: 'before',
            metadata: { path: 'src/a.ts' },
          },
        ],
      }),
    } as unknown as BackendApiClient;
    const response = await handleToolCall(
      'get_chunk_neighbors',
      { chunkId: 'chunk-2', before: 1, after: 2 },
      createToolHandlers(client),
    );

    expect(client.getChunkNeighbors).toHaveBeenCalledWith('chunk-2', {
      before: 1,
      after: 2,
    });
    expect(JSON.parse(response.content[0].text)).toEqual({
      chunkId: 'chunk-2',
      neighbors: [
        {
          chunkId: 'chunk-1',
          chunkIndex: 1,
          text: 'before',
          metadata: { path: 'src/a.ts' },
        },
      ],
    });
  });

  it('smoke tests search_memory', async () => {
    const client = {
      searchMemory: jest.fn().mockResolvedValue({
        knowledgeBaseId: 'kb-1',
        retrievalProfile: { key: 'memory-recall' },
        results: [
          {
            id: 'mem-1',
            entryType: 'decision',
            title: 'Use HTTP MCP',
            body: 'Hermes needs remote MCP',
            tags: ['mcp'],
            createdAt: '2026-05-24T00:00:00.000Z',
            metadata: {},
            score: 4,
          },
        ],
        count: 1,
      }),
    } as unknown as BackendApiClient;

    const response = await handleToolCall(
      'search_memory',
      { kbId: 'kb-1', query: 'Hermes', topK: 5 },
      createToolHandlers(client),
    );

    expect(client.searchMemory).toHaveBeenCalledWith('kb-1', 'Hermes', {
      topK: 5,
      profileKey: 'memory-recall',
    });
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      knowledgeBaseId: 'kb-1',
      count: 1,
    });
  });

  it('smoke tests get_context_package', async () => {
    const client = {
      getContextPackage: jest.fn().mockResolvedValue({
        knowledgeBaseId: 'kb-1',
        indexVersionId: 'index-1',
        retrievalProfile: { key: 'code-debug' },
        query: 'run',
        count: 1,
        budget: { estimatedTokens: 50 },
        groups: [
          {
            title: 'src/run.ts',
            kind: 'code',
            items: [],
          },
        ],
        diagnostics: {
          denseCandidates: 1,
          reranked: false,
          expandedNeighbors: 0,
          droppedDuplicates: 0,
        },
      }),
    } as unknown as BackendApiClient;

    const response = await handleToolCall(
      'get_context_package',
      { kbId: 'kb-1', query: 'run', profileKey: 'code-debug', tokenBudget: 500 },
      createToolHandlers(client),
    );

    expect(client.getContextPackage).toHaveBeenCalledWith('kb-1', 'run', {
      topK: 10,
      profileKey: 'code-debug',
      tokenBudget: 500,
      pathPrefix: undefined,
      language: undefined,
      branch: undefined,
    });
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      knowledgeBaseId: 'kb-1',
      count: 1,
    });
  });

  it('smoke tests save_session_summary', async () => {
    const client = {
      saveSessionSummary: jest.fn().mockResolvedValue({
        id: 'mem-1',
        entryType: 'session_summary',
      }),
    } as unknown as BackendApiClient;

    const response = await handleToolCall(
      'save_session_summary',
      { kbId: 'kb-1', sessionId: 'session-1', body: 'summary body' },
      createToolHandlers(client),
    );

    expect(client.saveSessionSummary).toHaveBeenCalledWith('kb-1', {
      sessionId: 'session-1',
      body: 'summary body',
      title: undefined,
      summary: undefined,
      authoredBy: undefined,
    });
    expect(JSON.parse(response.content[0].text)).toEqual({
      id: 'mem-1',
      entryType: 'session_summary',
    });
  });

  it('smoke tests update_memory_entry', async () => {
    const client = {
      updateMemoryEntry: jest.fn().mockResolvedValue({
        id: 'mem-1',
        entryType: 'fact',
        body: 'updated',
      }),
    } as unknown as BackendApiClient;

    const response = await handleToolCall(
      'update_memory_entry',
      {
        kbId: 'kb-1',
        entryId: 'mem-1',
        body: 'updated',
        tags: ['infra'],
        metadata: { confidence: 0.8 },
      },
      createToolHandlers(client),
    );

    expect(client.updateMemoryEntry).toHaveBeenCalledWith('kb-1', 'mem-1', {
      entryType: undefined,
      body: 'updated',
      title: undefined,
      summary: undefined,
      authoredBy: undefined,
      sessionId: undefined,
      tags: ['infra'],
      sourceRefs: undefined,
      occurredAt: undefined,
      metadata: { confidence: 0.8 },
    });
    expect(JSON.parse(response.content[0].text)).toEqual({
      id: 'mem-1',
      entryType: 'fact',
      body: 'updated',
    });
  });

  it('smoke tests archive_memory_entry', async () => {
    const client = {
      archiveMemoryEntry: jest.fn().mockResolvedValue({
        id: 'mem-1',
        metadata: { lifecycleStatus: 'archived' },
      }),
    } as unknown as BackendApiClient;

    const response = await handleToolCall(
      'archive_memory_entry',
      { kbId: 'kb-1', entryId: 'mem-1', reason: 'stale' },
      createToolHandlers(client),
    );

    expect(client.archiveMemoryEntry).toHaveBeenCalledWith('kb-1', 'mem-1', 'stale');
    expect(JSON.parse(response.content[0].text)).toEqual({
      id: 'mem-1',
      metadata: { lifecycleStatus: 'archived' },
    });
  });

  it('smoke tests delete_memory_entry', async () => {
    const client = {
      deleteMemoryEntry: jest.fn().mockResolvedValue({
        id: 'mem-1',
        knowledgeBaseId: 'kb-1',
        deleted: true,
      }),
    } as unknown as BackendApiClient;

    const response = await handleToolCall(
      'delete_memory_entry',
      { kbId: 'kb-1', entryId: 'mem-1' },
      createToolHandlers(client),
    );

    expect(client.deleteMemoryEntry).toHaveBeenCalledWith('kb-1', 'mem-1');
    expect(JSON.parse(response.content[0].text)).toEqual({
      id: 'mem-1',
      knowledgeBaseId: 'kb-1',
      deleted: true,
    });
  });

  it('falls back to ADMIN_API_KEY when CONTEXTFORGE_API_KEY is unset', () => {
    process.env = {
      ...originalEnv,
      CONTEXTFORGE_BACKEND_URL: 'http://localhost:3000',
      CONTEXTFORGE_API_KEY: '',
      ADMIN_API_KEY: 'shared-key',
      API_KEY_AUTH_ENABLED: 'true',
      MCP_AUTH_ENABLED: 'false',
    };

    const { getConfig } = require('./index');
    expect(getConfig()).toMatchObject({
      apiKey: 'shared-key',
      adminApiKey: 'shared-key',
    });
  });

  it('rejects enabled auth without ADMIN_API_KEY', () => {
    process.env = {
      ...originalEnv,
      CONTEXTFORGE_BACKEND_URL: 'http://localhost:3000',
      CONTEXTFORGE_API_KEY: '',
      ADMIN_API_KEY: '',
      API_KEY_AUTH_ENABLED: 'false',
      MCP_AUTH_ENABLED: 'true',
    };

    const { getConfig } = require('./index');
    expect(() => getConfig()).toThrow('ADMIN_API_KEY is required when MCP or backend API key auth is enabled');
  });

  it('registers the profile tool surface on top of the legacy surface', () => {
    expect(profileToolDefinitions.map((tool) => tool.name).sort()).toEqual([
      'answer_workspace',
      'archive_memory',
      'delete_memory',
      'read_document',
      'retrieve_context',
      'update_memory',
      'write_memory',
    ]);
    expect(mcpToolDefinitions).toHaveLength(38);
    expect(new Set(mcpToolDefinitions.map((tool) => tool.name)).size).toBe(38);
    expect(consumerToolDefinitionOverrides.map((tool) => tool.name).sort()).toEqual([
      'get_recent_decisions',
      'search_memory',
    ]);
  });

  it('defaults to a small read-only read profile', () => {
    expect(resolveMcpProfile(undefined)).toBe('read');
    expect(resolveMcpProfile('')).toBe('read');
    expect(resolveMcpProfile('READ')).toBe('read');
    expect(toolsForProfile('read').sort()).toEqual([
      'list_workspaces',
      'read_document',
      'retrieve_context',
      'search_memory',
    ]);
  });

  it('gives the agent profile bounded memory writes on top of the read surface', () => {
    expect(toolsForProfile('agent').sort()).toEqual([
      'archive_memory',
      'get_recent_decisions',
      'list_workspaces',
      'read_document',
      'retrieve_context',
      'search_memory',
      'update_memory',
      'write_memory',
    ]);
  });

  it('gives the operator profile read, diagnostics, lifecycle, and memory deletion', () => {
    expect(toolsForProfile('operator').sort()).toEqual([
      'cleanup_vector_operation',
      'delete_memory',
      'get_index_status',
      'get_resource_status',
      'get_vector_backends',
      'get_workspace_resource_status',
      'get_workspace_status',
      'get_workspace_vector_placement',
      'list_workspaces',
      'load_workspace',
      'pin_workspace_vector_backend',
      'read_document',
      'request_workspace_vector_move',
      'retrieve_context',
      'rollback_vector_operation',
      'search_memory',
      'unload_workspace',
    ]);
  });

  it('keeps the full legacy surface on the all profile', () => {
    const allTools = toolsForProfile('all');
    expect(allTools).toHaveLength(38);
    expect(allTools.slice().sort()).toEqual(
      mcpToolDefinitions
        .map((tool) => tool.name)
        .slice()
        .sort(),
    );
    expect(allTools).toContain('answer_workspace');
  });

  it('rejects unknown MCP profile values', () => {
    expect(() => resolveMcpProfile('everything')).toThrow(
      "Invalid MCP profile 'everything'. Expected one of: read, agent, operator, all",
    );
  });

  it('parses MCP_PROFILE from the environment', () => {
    process.env = {
      ...originalEnv,
      CONTEXTFORGE_BACKEND_URL: 'http://localhost:3000',
      MCP_PROFILE: 'operator',
      API_KEY_AUTH_ENABLED: 'false',
      MCP_AUTH_ENABLED: 'false',
    };

    expect(getConfig().profile).toBe('operator');
  });

  it('rejects an invalid MCP_PROFILE value', () => {
    process.env = {
      ...originalEnv,
      CONTEXTFORGE_BACKEND_URL: 'http://localhost:3000',
      MCP_PROFILE: 'bogus',
      API_KEY_AUTH_ENABLED: 'false',
      MCP_AUTH_ENABLED: 'false',
    };

    expect(() => getConfig()).toThrow('Invalid MCP profile');
  });

  it('lists only the active profile tools from the MCP server', async () => {
    createContextForgeServer({
      backendUrl: 'http://backend.test',
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: false,
      profile: 'read',
    });
    const mockServer = serverMockInstances[serverMockInstances.length - 1];
    const listHandler = mockServer.setRequestHandler.mock.calls.find(
      ([schema]: [unknown, unknown]) => schema === ListToolsRequestSchema,
    )?.[1];

    const result = (await listHandler()) as {
      tools: Array<{
        name: string;
        inputSchema: { properties: Record<string, unknown>; required?: string[] };
      }>;
    };
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      'list_workspaces',
      'read_document',
      'retrieve_context',
      'search_memory',
    ]);
    const searchMemory = result.tools.find((tool) => tool.name === 'search_memory');
    expect(searchMemory?.inputSchema.properties).toHaveProperty('workspaceId');
    expect(searchMemory?.inputSchema.properties).not.toHaveProperty('kbId');
    expect(searchMemory?.inputSchema.required).toEqual(['workspaceId', 'query']);
  });

  it('keeps the legacy search_memory schema under all', async () => {
    createContextForgeServer({
      backendUrl: 'http://backend.test',
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: false,
      profile: 'all',
    });
    const mockServer = serverMockInstances[serverMockInstances.length - 1];
    const listHandler = mockServer.setRequestHandler.mock.calls.find(
      ([schema]: [unknown, unknown]) => schema === ListToolsRequestSchema,
    )?.[1];

    const result = (await listHandler()) as {
      tools: Array<{
        name: string;
        inputSchema: { properties: Record<string, unknown>; required?: string[] };
      }>;
    };
    const searchMemory = result.tools.find((tool) => tool.name === 'search_memory');
    expect(searchMemory?.inputSchema.properties).toHaveProperty('kbId');
    expect(searchMemory?.inputSchema.properties).not.toHaveProperty('workspaceId');
    expect(searchMemory?.inputSchema.required).toEqual(['kbId', 'query']);
  });

  it('denies tool calls outside the active profile at the MCP server', async () => {
    createContextForgeServer({
      backendUrl: 'http://backend.test',
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: false,
      profile: 'read',
    });
    const mockServer = serverMockInstances[serverMockInstances.length - 1];
    const callHandler = mockServer.setRequestHandler.mock.calls.find(
      ([schema]: [unknown, unknown]) => schema === CallToolRequestSchema,
    )?.[1];

    const result = await callHandler({
      params: { name: 'delete_memory_entry', arguments: { kbId: 'kb-1', entryId: 'mem-1' } },
    });

    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "Tool 'delete_memory_entry' is not available in MCP profile 'read'",
    });
  });

  it('returns a compact workspace-only list from consumer profiles', async () => {
    const client = {
      listWorkspaces: jest.fn().mockResolvedValue([
        {
          id: 'kb-1',
          slug: 'docs',
          name: 'Docs',
          workspaceKind: 'docs',
          activeIndexVersionId: 'index-1',
        },
      ]),
    } as unknown as BackendApiClient;

    const response = await handleToolCall('list_workspaces', {}, createToolHandlers(client), 'read');

    expect(JSON.parse(response.content[0].text)).toEqual({
      workspaces: [
        {
          workspaceId: 'kb-1',
          slug: 'docs',
          name: 'Docs',
          kind: 'docs',
          activeIndexVersionId: 'index-1',
          status: 'ready',
        },
      ],
      count: 1,
    });
  });

  it('preserves unavailable embedding status in compact consumer workspace lists', async () => {
    const client = {
      listWorkspaces: jest.fn().mockResolvedValue([
        {
          id: 'kb-1',
          slug: 'external-docs',
          name: 'External docs',
          workspaceKind: 'docs',
          activeIndexVersionId: 'index-1',
          availability: {
            status: 'unavailable',
            reason: 'embedding_connection_refused',
          },
        },
      ]),
    } as unknown as BackendApiClient;

    const response = await handleToolCall('list_workspaces', {}, createToolHandlers(client), 'read');

    expect(JSON.parse(response.content[0].text)).toMatchObject({
      workspaces: [
        {
          workspaceId: 'kb-1',
          status: 'unavailable',
          unavailableReason: 'embedding_connection_refused',
        },
      ],
    });
  });

  it('enforces profile membership in handleToolCall', async () => {
    const client = {
      deleteMemoryEntry: jest.fn().mockResolvedValue({
        id: 'mem-1',
        knowledgeBaseId: 'kb-1',
        deleted: true,
      }),
    } as unknown as BackendApiClient;
    const handlers = createToolHandlers(client);

    const denied = await handleToolCall('delete_memory_entry', { kbId: 'kb-1', entryId: 'mem-1' }, handlers, 'read');
    expect(client.deleteMemoryEntry).not.toHaveBeenCalled();
    expect(JSON.parse(denied.content[0].text)).toEqual({
      error: "Tool 'delete_memory_entry' is not available in MCP profile 'read'",
    });

    const allowed = await handleToolCall('delete_memory_entry', { kbId: 'kb-1', entryId: 'mem-1' }, handlers, 'all');
    expect(client.deleteMemoryEntry).toHaveBeenCalledWith('kb-1', 'mem-1');
    expect(JSON.parse(allowed.content[0].text)).toMatchObject({ deleted: true });
  });

  it('keeps answer_workspace out of read and delegates one RAG call from all', async () => {
    const client = {
      ask: jest.fn().mockResolvedValue({
        mode: 'rag_answer',
        knowledgeBaseId: 'kb-1',
        answer: 'Use the canonical docs.',
        citations: [],
      }),
    } as unknown as BackendApiClient;
    const handlers = createToolHandlers(client);

    const denied = await handleToolCall(
      'answer_workspace',
      { workspaceId: 'kb-1', query: 'What is canonical?' },
      handlers,
      'read',
    );
    expect(JSON.parse(denied.content[0].text)).toEqual({
      error: "Tool 'answer_workspace' is not available in MCP profile 'read'",
    });

    const allowed = await handleToolCall(
      'answer_workspace',
      { workspaceId: 'kb-1', query: 'What is canonical?', maxOutputTokens: 300 },
      handlers,
      'all',
    );
    expect(client.ask).toHaveBeenCalledTimes(1);
    expect(client.ask).toHaveBeenCalledWith('kb-1', {
      mode: 'rag_answer',
      query: 'What is canonical?',
      topK: undefined,
      profileKey: undefined,
      tokenBudget: undefined,
      llm: {
        providerId: undefined,
        maxOutputTokens: 300,
        temperature: undefined,
      },
    });
    expect(JSON.parse(allowed.content[0].text)).toMatchObject({
      mode: 'rag_answer',
      answer: 'Use the canonical docs.',
    });
  });

  it('smoke tests retrieve_context with a compact response', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({
        knowledgeBaseId: 'kb-1',
        indexVersionId: 'index-1',
        retrievalProfile: { key: 'docs-qa' },
        results: [
          {
            chunkId: 'chunk-1',
            documentId: 'doc-1',
            text: 'Answer text',
            score: 0.8,
            path: 'docs/a.md',
            sourceId: 'src-1',
            startLine: 1,
            endLine: 2,
            tokenCount: 42,
            metadata: { internal: true },
          },
        ],
        count: 1,
      }),
    } as unknown as BackendApiClient;
    const response = await handleToolCall(
      'retrieve_context',
      {
        workspaceId: 'kb-1',
        query: 'answer',
        topK: 100,
        pathPrefix: 'docs',
        language: 'markdown',
        tokenBudget: 800,
      },
      createToolHandlers(client),
    );

    expect(client.search).toHaveBeenCalledWith(
      'kb-1',
      'answer',
      50,
      { pathPrefix: 'docs', language: 'markdown' },
      { scoreThreshold: undefined, tokenBudget: 800 },
    );
    expect(JSON.parse(response.content[0].text)).toEqual({
      workspaceId: 'kb-1',
      query: 'answer',
      indexVersionId: 'index-1',
      count: 1,
      results: [
        {
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          path: 'docs/a.md',
          sourceId: 'src-1',
          text: 'Answer text',
          score: 0.8,
          startLine: 1,
          endLine: 2,
        },
      ],
      budget: { estimatedTokens: 42 },
    });
  });

  it('omits the budget block when results lack token counts', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({
        knowledgeBaseId: 'kb-1',
        indexVersionId: 'index-1',
        results: [{ chunkId: 'chunk-1', documentId: 'doc-1', text: 'text', score: 0.5 }],
        count: 1,
      }),
    } as unknown as BackendApiClient;
    const response = await handleToolCall(
      'retrieve_context',
      { workspaceId: 'kb-1', query: 'q' },
      createToolHandlers(client),
    );

    expect(client.search).toHaveBeenCalledWith('kb-1', 'q', 10, undefined, {
      scoreThreshold: undefined,
      tokenBudget: undefined,
    });
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).not.toHaveProperty('budget');
    expect(parsed.results[0]).toEqual({
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      text: 'text',
      score: 0.5,
    });
  });

  it('smoke tests read_document', async () => {
    const client = {
      getDocumentContext: jest.fn().mockResolvedValue({
        documentId: 'doc-1',
        path: 'docs/a.md',
        text: 'Context',
        metadata: {
          chunkId: 'chunk-1',
          startLine: 4,
          endLine: 9,
          mimeType: 'text/markdown',
          indexVersionId: 'internal-index',
          internal: true,
        },
      }),
    } as unknown as BackendApiClient;
    const response = await handleToolCall(
      'read_document',
      { documentId: 'doc-1', chunkId: 'chunk-1' },
      createToolHandlers(client),
    );

    expect(client.getDocumentContext).toHaveBeenCalledWith({
      documentId: 'doc-1',
      chunkId: 'chunk-1',
      startLine: undefined,
      endLine: undefined,
      maxChars: undefined,
    });
    expect(JSON.parse(response.content[0].text)).toEqual({
      documentId: 'doc-1',
      path: 'docs/a.md',
      text: 'Context',
      chunkId: 'chunk-1',
      startLine: 4,
      endLine: 9,
      mimeType: 'text/markdown',
    });
  });

  it('smoke tests write_memory with each kind', async () => {
    const client = {
      createMemoryEntry: jest.fn().mockResolvedValue({ id: 'mem-1', entryType: 'fact', body: 'b' }),
    } as unknown as BackendApiClient;
    const handlers = createToolHandlers(client);

    await handleToolCall('write_memory', { workspaceId: 'kb-1', kind: 'fact', body: 'b', tags: ['x'] }, handlers);
    await handleToolCall('write_memory', { workspaceId: 'kb-1', kind: 'decision', body: 'd' }, handlers);
    await handleToolCall(
      'write_memory',
      { workspaceId: 'kb-1', kind: 'session_summary', body: 's', sessionId: 'session-1' },
      handlers,
    );

    expect(client.createMemoryEntry).toHaveBeenNthCalledWith(1, 'kb-1', {
      entryType: 'fact',
      body: 'b',
      title: undefined,
      summary: undefined,
      sessionId: undefined,
      authoredBy: undefined,
      tags: ['x'],
      sourceRefs: undefined,
      occurredAt: undefined,
      metadata: undefined,
    });
    expect(client.createMemoryEntry).toHaveBeenNthCalledWith(2, 'kb-1', {
      entryType: 'decision',
      body: 'd',
      title: undefined,
      summary: undefined,
      sessionId: undefined,
      authoredBy: undefined,
      tags: undefined,
      sourceRefs: undefined,
      occurredAt: undefined,
      metadata: undefined,
    });
    expect(client.createMemoryEntry).toHaveBeenNthCalledWith(3, 'kb-1', {
      entryType: 'session_summary',
      body: 's',
      title: undefined,
      summary: undefined,
      sessionId: 'session-1',
      authoredBy: undefined,
      tags: undefined,
      sourceRefs: undefined,
      occurredAt: undefined,
      metadata: undefined,
    });
  });

  it('requires a session id for session_summary writes', async () => {
    const client = {
      createMemoryEntry: jest.fn(),
    } as unknown as BackendApiClient;
    const response = await handleToolCall(
      'write_memory',
      { workspaceId: 'kb-1', kind: 'session_summary', body: 's' },
      createToolHandlers(client),
    );

    expect(client.createMemoryEntry).not.toHaveBeenCalled();
    expect(JSON.parse(response.content[0].text)).toEqual({
      error: 'sessionId is required when kind is session_summary',
    });
  });

  it('rejects unknown write_memory kinds', async () => {
    const response = await handleToolCall(
      'write_memory',
      { workspaceId: 'kb-1', kind: 'note', body: 'b' },
      createToolHandlers({} as BackendApiClient),
    );

    expect(JSON.parse(response.content[0].text)).toEqual({
      error: 'kind must be fact, session_summary, or decision',
    });
  });

  it('smoke tests update_memory, archive_memory, and delete_memory', async () => {
    const client = {
      updateMemoryEntry: jest.fn().mockResolvedValue({ id: 'mem-1', body: 'updated' }),
      archiveMemoryEntry: jest.fn().mockResolvedValue({
        id: 'mem-1',
        metadata: { lifecycleStatus: 'archived' },
      }),
      deleteMemoryEntry: jest.fn().mockResolvedValue({
        id: 'mem-1',
        knowledgeBaseId: 'kb-1',
        deleted: true,
      }),
    } as unknown as BackendApiClient;
    const handlers = createToolHandlers(client);

    await handleToolCall('update_memory', { workspaceId: 'kb-1', entryId: 'mem-1', body: 'updated' }, handlers);
    await handleToolCall('archive_memory', { workspaceId: 'kb-1', entryId: 'mem-1', reason: 'stale' }, handlers);
    const response = await handleToolCall('delete_memory', { workspaceId: 'kb-1', entryId: 'mem-1' }, handlers);

    expect(client.updateMemoryEntry).toHaveBeenCalledWith('kb-1', 'mem-1', {
      entryType: undefined,
      body: 'updated',
      title: undefined,
      summary: undefined,
      tags: undefined,
      authoredBy: undefined,
      sessionId: undefined,
      sourceRefs: undefined,
      occurredAt: undefined,
      metadata: undefined,
    });
    expect(client.archiveMemoryEntry).toHaveBeenCalledWith('kb-1', 'mem-1', 'stale');
    expect(client.deleteMemoryEntry).toHaveBeenCalledWith('kb-1', 'mem-1');
    expect(JSON.parse(response.content[0].text)).toMatchObject({ deleted: true });
  });

  it('uses compact workspace-only memory reads outside all', async () => {
    const client = {
      searchMemory: jest.fn().mockResolvedValue({
        knowledgeBaseId: 'kb-1',
        retrievalProfile: { key: 'memory-recall', internal: true },
        results: [
          {
            id: 'mem-1',
            entryType: 'decision',
            body: 'Use the read profile.',
            tags: ['mcp'],
            createdAt: '2026-08-17T00:00:00.000Z',
            metadata: { internal: true },
            score: 0.9,
          },
        ],
        count: 1,
      }),
      getRecentDecisions: jest.fn().mockResolvedValue({
        knowledgeBaseId: 'kb-1',
        results: [],
        count: 0,
      }),
    } as unknown as BackendApiClient;
    const handlers = createToolHandlers(client);

    const search = await handleToolCall('search_memory', { workspaceId: 'kb-1', query: 'Hermes' }, handlers, 'read');
    await handleToolCall('get_recent_decisions', { workspaceId: 'kb-1' }, handlers, 'agent');

    expect(client.searchMemory).toHaveBeenCalledWith('kb-1', 'Hermes', {
      topK: 10,
      profileKey: 'memory-recall',
    });
    expect(client.getRecentDecisions).toHaveBeenCalledWith('kb-1', 5);
    expect(JSON.parse(search.content[0].text)).toEqual({
      workspaceId: 'kb-1',
      query: 'Hermes',
      results: [
        {
          id: 'mem-1',
          kind: 'decision',
          body: 'Use the read profile.',
          tags: ['mcp'],
          createdAt: '2026-08-17T00:00:00.000Z',
          score: 0.9,
        },
      ],
      count: 1,
    });
  });

  it('requires a workspace identifier for search_memory', async () => {
    const response = await handleToolCall(
      'search_memory',
      { query: 'Hermes' },
      createToolHandlers({} as BackendApiClient),
      'read',
    );

    expect(JSON.parse(response.content[0].text)).toEqual({
      error: 'workspaceId must be a non-empty string',
    });
  });

  it('rejects the legacy kbId input from the read profile', async () => {
    const response = await handleToolCall(
      'search_memory',
      { kbId: 'kb-1', query: 'Hermes' },
      createToolHandlers({} as BackendApiClient),
      'read',
    );

    expect(JSON.parse(response.content[0].text)).toEqual({
      error: 'workspaceId must be a non-empty string',
    });
  });
});
