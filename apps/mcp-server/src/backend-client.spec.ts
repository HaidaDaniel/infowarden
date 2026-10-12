import { BackendApiClient } from './backend-client';

describe('BackendApiClient', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('calls the documented general search endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      okResponse({
        knowledgeBaseId: 'kb-1',
        indexVersionId: 'index-1',
        results: [],
        count: 0,
      }),
    );
    const client = new BackendApiClient('http://api.test/');

    await client.search('kb-1', 'hello', 7, undefined, { profileKey: 'docs-qa', tokenBudget: 900 });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.test/knowledge-bases/kb-1/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: 'hello',
          topK: 7,
          filters: undefined,
          profileKey: 'docs-qa',
          tokenBudget: 900,
        }),
      }),
    );
  });

  it('passes the simple lexical preset through the unchanged retrieval request shape', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      okResponse({ knowledgeBaseId: 'kb-1', indexVersionId: 'index-1', results: [], count: 0 }),
    );
    const client = new BackendApiClient('http://api.test/');

    await client.search('kb-1', 'hello', 5, undefined, { profileKey: 'lexical' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.test/knowledge-bases/kb-1/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: 'hello',
          topK: 5,
          filters: undefined,
          profileKey: 'lexical',
          tokenBudget: undefined,
          scoreThreshold: undefined,
        }),
      }),
    );
  });

  it('calls the documented code search endpoint with filters', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      okResponse({
        knowledgeBaseId: 'kb-1',
        indexVersionId: 'index-1',
        results: [],
        count: 0,
      }),
    );
    const client = new BackendApiClient('http://api.test');

    await client.searchCode('kb-1', 'queue', {
      topK: 5,
      pathPrefix: 'src/',
      language: 'typescript',
      branch: 'main',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.test/knowledge-bases/kb-1/search-code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: 'queue',
          topK: 5,
          pathPrefix: 'src/',
          language: 'typescript',
          branch: 'main',
        }),
      }),
    );
  });

  it('normalizes backend errors with status and message', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({ message: 'No active index' }),
    });
    const client = new BackendApiClient('http://api.test');

    await expect(client.search('kb-1', 'hello')).rejects.toMatchObject({
      status: 400,
      message: 'Backend API 400: No active index',
    });
  });

  it('sends the configured API key as a bearer token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(okResponse([]));
    const client = new BackendApiClient('http://api.test', 'shared-key');

    await client.listKnowledgeBases();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.test/knowledge-bases',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer shared-key',
          traceparent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
        }),
      }),
    );
  });

  it('calls the workspace list and detail endpoints', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(okResponse([]))
      .mockResolvedValueOnce(okResponse({ id: 'kb-1', slug: 'career-rag' }));
    const client = new BackendApiClient('http://api.test');

    await client.listWorkspaces();
    await client.getWorkspace('career-rag');

    expect(global.fetch).toHaveBeenNthCalledWith(1, 'http://api.test/workspaces', expect.any(Object));
    expect(global.fetch).toHaveBeenNthCalledWith(2, 'http://api.test/workspaces/career-rag', expect.any(Object));
  });

  it('calls resource inventory and workspace lifecycle endpoints', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        okResponse({ target: {}, host: {}, disks: [], qdrant: { collections: 0, items: [] }, warnings: [] }),
      )
      .mockResolvedValueOnce(
        okResponse({
          workspace: { id: 'kb-1', slug: 'career-rag', name: 'Career RAG', kind: 'docs' },
          lifecycle: { status: 'loaded', collectionAvailable: true },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          workspace: { id: 'kb-1', slug: 'career-rag', name: 'Career RAG', kind: 'docs' },
          lifecycle: { status: 'unloaded', collectionAvailable: false },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          workspace: { id: 'kb-1', slug: 'career-rag', name: 'Career RAG', kind: 'docs' },
          lifecycle: { status: 'loading', collectionAvailable: false },
          job: { id: 'job-1' },
        }),
      );
    const client = new BackendApiClient('http://api.test');

    await client.getResourceStatus();
    await client.getWorkspaceResourceStatus('career-rag');
    await client.unloadWorkspace('career-rag');
    await client.loadWorkspace('career-rag', { storageProfile: 'low_memory' });

    expect(global.fetch).toHaveBeenNthCalledWith(1, 'http://api.test/resources/system', expect.any(Object));
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'http://api.test/workspaces/career-rag/resources',
      expect.any(Object),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      'http://api.test/workspaces/career-rag/unload',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      'http://api.test/workspaces/career-rag/load',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ storageProfile: 'low_memory' }),
      }),
    );
  });

  it('calls vector backend operation endpoints without exposing secrets', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(okResponse({ policy: {}, backends: [] }))
      .mockResolvedValueOnce(okResponse({ id: 'placement-1', vectorBackendId: 'backend-1' }))
      .mockResolvedValueOnce(okResponse({ id: 'placement-1', vectorBackendId: 'backend-2' }))
      .mockResolvedValueOnce(okResponse({ id: 'op-1', kind: 'backend_move', state: 'planned' }))
      .mockResolvedValueOnce(okResponse({ id: 'op-1', state: 'rollback_complete' }))
      .mockResolvedValueOnce(okResponse({ id: 'op-1', state: 'cleanup_pending' }));
    const client = new BackendApiClient('http://api.test');

    await client.getVectorBackends();
    await client.getWorkspaceVectorPlacement('career-rag');
    await client.pinWorkspaceVectorBackend('career-rag', 'backend-2');
    await client.createVectorOperation('career-rag', {
      kind: 'backend_move',
      targetVectorBackendId: 'backend-2',
    });
    await client.rollbackVectorOperation('op-1');
    await client.cleanupVectorOperation('op-1');

    expect(global.fetch).toHaveBeenNthCalledWith(1, 'http://api.test/vector-backends/read-model', expect.any(Object));
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'http://api.test/workspaces/career-rag/vector-placement',
      expect.any(Object),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      'http://api.test/workspaces/career-rag/vector-placement/pin',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ vectorBackendId: 'backend-2' }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      'http://api.test/workspaces/career-rag/vector-operations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ kind: 'backend_move', targetVectorBackendId: 'backend-2' }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      5,
      'http://api.test/vector-operations/op-1/rollback',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      6,
      'http://api.test/vector-operations/op-1/cleanup',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('calls the context-package endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      okResponse({
        knowledgeBaseId: 'kb-1',
        indexVersionId: 'index-1',
        retrievalProfile: { key: 'code-debug' },
        query: 'run',
        count: 0,
        budget: { estimatedTokens: 0 },
        groups: [],
        diagnostics: {
          denseCandidates: 0,
          reranked: false,
          expandedNeighbors: 0,
          droppedDuplicates: 0,
        },
      }),
    );
    const client = new BackendApiClient('http://api.test');

    await client.getContextPackage('kb-1', 'run', { profileKey: 'code-debug', tokenBudget: 600 });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.test/knowledge-bases/kb-1/context-package',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: 'run',
          topK: undefined,
          profileKey: 'code-debug',
          tokenBudget: 600,
          pathPrefix: undefined,
          language: undefined,
          branch: undefined,
          filters: undefined,
        }),
      }),
    );
  });

  it('calls the workspace ask endpoint with answer provider controls', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      okResponse({
        mode: 'rag_answer',
        knowledgeBaseId: 'kb-1',
        indexVersionId: 'index-1',
        query: 'Where is truth?',
        retrievalTraceId: 'trace-1',
        retrievalTrace: {},
        contextPackage: {},
        answer: 'PostgreSQL [C1].',
        citations: [],
        sourceIds: [],
        diagnostics: {},
      }),
    );
    const client = new BackendApiClient('http://api.test');

    await client.ask('career-rag', {
      mode: 'rag_answer',
      query: 'Where is truth?',
      tokenBudget: 900,
      llm: {
        providerId: 'llm-1',
        maxOutputTokens: 400,
        temperature: 0,
      },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.test/workspaces/career-rag/ask',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          mode: 'rag_answer',
          query: 'Where is truth?',
          tokenBudget: 900,
          llm: {
            providerId: 'llm-1',
            maxOutputTokens: 400,
            temperature: 0,
          },
        }),
      }),
    );
  });

  it('calls the session summary write endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(okResponse({ id: 'mem-1', entryType: 'session_summary' }));
    const client = new BackendApiClient('http://api.test');

    await client.saveSessionSummary('kb-1', {
      sessionId: 'session-1',
      body: 'summary body',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.test/knowledge-bases/kb-1/memory/session-summaries',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('calls memory entry mutation endpoints', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(okResponse({ id: 'mem-1', body: 'updated' }))
      .mockResolvedValueOnce(okResponse({ id: 'mem-1', metadata: { lifecycleStatus: 'archived' } }))
      .mockResolvedValueOnce(okResponse({ id: 'mem-1', knowledgeBaseId: 'kb-1', deleted: true }));
    const client = new BackendApiClient('http://api.test');

    await client.updateMemoryEntry('kb-1', 'mem-1', {
      body: 'updated',
      tags: ['infra'],
    });
    await client.archiveMemoryEntry('kb-1', 'mem-1', 'stale');
    await client.deleteMemoryEntry('kb-1', 'mem-1');

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'http://api.test/knowledge-bases/kb-1/memory/mem-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          body: 'updated',
          tags: ['infra'],
        }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'http://api.test/knowledge-bases/kb-1/memory/mem-1/archive',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'stale' }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      'http://api.test/knowledge-bases/kb-1/memory/mem-1',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
  });

  function okResponse(body: unknown) {
    return {
      ok: true,
      json: jest.fn().mockResolvedValue(body),
    };
  }
});
