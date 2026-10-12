import { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createContextForgeHttpServer } from './index';

describe('ContextForge HTTP MCP server', () => {
  const nativeFetch = global.fetch;

  afterEach(() => {
    global.fetch = nativeFetch;
  });

  it('serves a lightweight health endpoint', async () => {
    const server = createContextForgeHttpServer({
      backendUrl: 'http://backend.test',
      apiKey: undefined,
      adminApiKey: undefined,
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: false,
      profile: 'read',
    });
    await listen(server);

    try {
      const response = await nativeFetch(`http://127.0.0.1:${portOf(server)}/health`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
    } finally {
      await close(server);
    }
  });

  it('stops accepting HTTP work after close', async () => {
    const server = createContextForgeHttpServer({
      backendUrl: 'http://backend.test',
      apiKey: undefined,
      adminApiKey: undefined,
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: false,
      profile: 'read',
    });
    await listen(server);
    const url = `http://127.0.0.1:${portOf(server)}/health`;

    await close(server);

    await expect(nativeFetch(url)).rejects.toThrow();
  });

  it('lists tools over streamable HTTP', async () => {
    global.fetch = jest.fn((input: any, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://backend.test')) {
        return Promise.resolve(
          okResponse([
            {
              id: 'kb-1',
              name: 'Docs',
              activeIndexVersionId: 'index-1',
            },
          ]),
        ) as unknown as Promise<Response>;
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const server = createContextForgeHttpServer({
      backendUrl: 'http://backend.test',
      apiKey: undefined,
      adminApiKey: undefined,
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: false,
      profile: 'read',
    });
    await listen(server);

    const client = new Client({ name: 'http-test-client', version: '0.1.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${portOf(server)}/mcp`));

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'list_workspaces',
        'read_document',
        'retrieve_context',
        'search_memory',
      ]);
    } finally {
      await client.close();
      await close(server);
    }
  });

  it('lists the full compatibility surface over streamable HTTP with the all profile', async () => {
    const server = createContextForgeHttpServer({
      backendUrl: 'http://backend.test',
      apiKey: undefined,
      adminApiKey: undefined,
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: false,
      profile: 'all',
    });
    await listen(server);

    const client = new Client({ name: 'http-test-client', version: '0.1.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${portOf(server)}/mcp`));

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'answer_workspace',
        'archive_memory',
        'archive_memory_entry',
        'ask_workspace',
        'cleanup_vector_operation',
        'delete_memory',
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
        'read_document',
        'remember_fact',
        'request_workspace_vector_move',
        'retrieve_context',
        'rollback_vector_operation',
        'save_session_summary',
        'search_code',
        'search_codebase',
        'search_docs',
        'search_kb',
        'search_memory',
        'unload_workspace',
        'update_memory',
        'update_memory_entry',
        'write_memory',
      ]);
    } finally {
      await client.close();
      await close(server);
    }
  });

  it('denies out-of-profile tool calls over streamable HTTP', async () => {
    const server = createContextForgeHttpServer({
      backendUrl: 'http://backend.test',
      apiKey: undefined,
      adminApiKey: undefined,
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: false,
      profile: 'read',
    });
    await listen(server);

    const client = new Client({ name: 'http-test-client', version: '0.1.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${portOf(server)}/mcp`));

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'delete_memory_entry',
        arguments: { kbId: 'kb-1', entryId: 'mem-1' },
      });
      const text = ((result.content as any[] | undefined)?.[0]?.text as string | undefined) || '{}';

      expect(JSON.parse(text)).toEqual({
        error: "Tool 'delete_memory_entry' is not available in MCP profile 'read'",
      });
    } finally {
      await client.close();
      await close(server);
    }
  });

  it('handles list_knowledge_bases over streamable HTTP', async () => {
    global.fetch = jest.fn((input: any, init?: RequestInit) => {
      const url = String(input);
      if (url === 'http://backend.test/knowledge-bases') {
        return Promise.resolve(
          okResponse([
            {
              id: 'kb-1',
              name: 'Docs',
              activeIndexVersionId: 'index-1',
            },
          ]),
        ) as unknown as Promise<Response>;
      }
      if (url.startsWith('http://backend.test')) {
        return Promise.resolve(okResponse({})) as unknown as Promise<Response>;
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const server = createContextForgeHttpServer({
      backendUrl: 'http://backend.test',
      apiKey: undefined,
      adminApiKey: undefined,
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: false,
      profile: 'all',
    });
    await listen(server);

    const client = new Client({ name: 'http-test-client', version: '0.1.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${portOf(server)}/mcp`));

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'list_knowledge_bases',
        arguments: {},
      });
      const text = ((result.content as any[] | undefined)?.[0]?.text as string | undefined) || '{}';

      expect(JSON.parse(text)).toEqual({
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
    } finally {
      await client.close();
      await close(server);
    }
  });

  it('rejects HTTP MCP requests without a valid key when auth is enabled', async () => {
    const server = createContextForgeHttpServer({
      backendUrl: 'http://backend.test',
      apiKey: 'secret',
      adminApiKey: 'secret',
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: true,
      profile: 'read',
    });
    await listen(server);

    try {
      const response = await nativeFetch(`http://127.0.0.1:${portOf(server)}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'unauthorized',
          }),
        }),
      );
    } finally {
      await close(server);
    }
  });

  it('accepts a valid key for HTTP MCP requests when auth is enabled', async () => {
    global.fetch = jest.fn((input: any, init?: RequestInit) => {
      const url = String(input);
      if (url === 'http://backend.test/knowledge-bases') {
        return Promise.resolve(
          okResponse([
            {
              id: 'kb-1',
              name: 'Docs',
              activeIndexVersionId: 'index-1',
            },
          ]),
        ) as unknown as Promise<Response>;
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const server = createContextForgeHttpServer({
      backendUrl: 'http://backend.test',
      apiKey: 'secret',
      adminApiKey: 'secret',
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpPath: '/mcp',
      mcpAuthEnabled: true,
      profile: 'all',
    });
    await listen(server);

    const client = new Client({ name: 'http-auth-client', version: '0.1.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${portOf(server)}/mcp`), {
      requestInit: {
        headers: {
          'X-API-Key': 'secret',
        },
      },
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'list_knowledge_bases',
        arguments: {},
      });
      const text = ((result.content as any[] | undefined)?.[0]?.text as string | undefined) || '{}';

      expect(JSON.parse(text)).toMatchObject({
        count: 1,
      });
    } finally {
      await client.close();
      await close(server);
    }
  });

  function okResponse(body: unknown) {
    return {
      ok: true,
      json: jest.fn().mockResolvedValue(body),
    };
  }

  function listen(server: ReturnType<typeof createContextForgeHttpServer>) {
    return new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  }

  function close(server: ReturnType<typeof createContextForgeHttpServer>) {
    return new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  function portOf(server: ReturnType<typeof createContextForgeHttpServer>) {
    return (server.address() as AddressInfo).port;
  }
});
