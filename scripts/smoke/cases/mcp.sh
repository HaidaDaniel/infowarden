#!/usr/bin/env bash

smoke_case_mcp() {
  if [[ -z "$SMOKE_KB_ID" ]]; then
    smoke_fail "mcp case requires indexing case to set SMOKE_KB_ID"
  fi

  smoke_section "Running MCP local handler smoke"
  CONTEXTFORGE_BACKEND_URL="$API_URL" KB_ID="$SMOKE_KB_ID" node <<'NODE'
const { createToolHandlers, handleToolCall } = require('./apps/mcp-server/dist/index.js');
const { BackendApiClient } = require('./apps/mcp-server/dist/backend-client.js');

function parse(result) {
  return JSON.parse(result.content[0].text);
}

async function main() {
  const client = new BackendApiClient(process.env.CONTEXTFORGE_BACKEND_URL);
  const handlers = createToolHandlers(client);
  const list = parse(await handleToolCall('list_workspaces', {}, handlers));
  if (!list.workspaces?.some((kb) => kb.id === process.env.KB_ID)) {
    throw new Error('MCP list_workspaces did not include smoke workspace');
  }

  const status = parse(await handleToolCall('get_workspace_status', { workspaceId: process.env.KB_ID }, handlers));
  if (!status.activeIndexVersionId) {
    throw new Error('MCP get_workspace_status did not return active index');
  }

  const search = parse(await handleToolCall('search_kb', {
    kbId: process.env.KB_ID,
    query: 'search functionality',
    topK: 3,
  }, handlers));
  if (!search.results?.length) {
    throw new Error('MCP search_kb returned no results');
  }

  const docs = parse(await handleToolCall('search_docs', {
    kbId: process.env.KB_ID,
    query: 'document parsing and search',
    topK: 3,
  }, handlers));
  if (!docs.results?.length) {
    throw new Error('MCP search_docs returned no results');
  }

  const code = parse(await handleToolCall('search_code', {
    kbId: process.env.KB_ID,
    query: 'searchDocuments function',
    topK: 3,
    language: 'typescript',
  }, handlers));
  if (!code.results?.length) {
    throw new Error('MCP search_code returned no results');
  }

  const context = parse(await handleToolCall('get_context_package', {
    kbId: process.env.KB_ID,
    query: 'document parsing and search',
    topK: 3,
    tokenBudget: 1000,
  }, handlers));
  if (!context.groups?.length) {
    throw new Error('MCP get_context_package returned no groups');
  }

  const contextSource = docs.results[0];
  const documentContext = parse(await handleToolCall('get_document_context', {
    documentId: contextSource.documentId,
    chunkId: contextSource.chunkId,
    maxChars: 1000,
  }, handlers));
  if (!documentContext.text || !documentContext.path) {
    throw new Error('MCP get_document_context returned no document text');
  }

  const neighbors = parse(await handleToolCall('get_chunk_neighbors', {
    chunkId: contextSource.chunkId,
    before: 1,
    after: 1,
  }, handlers));
  if (!Array.isArray(neighbors.neighbors)) {
    throw new Error('MCP get_chunk_neighbors returned an invalid response');
  }

  const memory = parse(await handleToolCall('search_memory', {
    kbId: process.env.KB_ID,
    query: 'smoke decision',
    topK: 3,
  }, handlers));
  if (!memory.results?.length) {
    throw new Error('MCP search_memory returned no results');
  }

  const fact = parse(await handleToolCall('remember_fact', {
    kbId: process.env.KB_ID,
    title: 'MCP smoke fact',
    body: 'MCP smoke writes a fact for agent memory verification.',
    summary: 'MCP write smoke',
    authoredBy: 'mcp-smoke',
    sessionId: 'mcp-smoke-session',
  }, handlers));
  if (!fact.id) {
    throw new Error('MCP remember_fact did not return an entry id');
  }

  const session = parse(await handleToolCall('save_session_summary', {
    kbId: process.env.KB_ID,
    sessionId: 'mcp-smoke-session',
    title: 'MCP smoke session',
    body: 'MCP smoke writes a session summary for agent context.',
    summary: 'MCP session smoke',
    authoredBy: 'mcp-smoke',
  }, handlers));
  if (!session.id) {
    throw new Error('MCP save_session_summary did not return an entry id');
  }

  const updated = parse(await handleToolCall('update_memory_entry', {
    kbId: process.env.KB_ID,
    entryId: fact.id,
    title: 'MCP smoke fact updated',
    tags: ['smoke', 'mcp'],
    metadata: { mcpSmoke: true },
  }, handlers));
  if (updated.title !== 'MCP smoke fact updated' || updated.metadata?.mcpSmoke !== true) {
    throw new Error('MCP update_memory_entry did not persist metadata');
  }

  const archived = parse(await handleToolCall('archive_memory_entry', {
    kbId: process.env.KB_ID,
    entryId: session.id,
    reason: 'mcp smoke lifecycle',
  }, handlers));
  if (archived.metadata?.lifecycleStatus !== 'archived') {
    throw new Error('MCP archive_memory_entry did not archive the session');
  }

  const deleted = parse(await handleToolCall('delete_memory_entry', {
    kbId: process.env.KB_ID,
    entryId: fact.id,
  }, handlers));
  if (!deleted.deleted) {
    throw new Error('MCP delete_memory_entry did not delete the fact');
  }

  const recent = parse(await handleToolCall('get_recent_decisions', {
    kbId: process.env.KB_ID,
    limit: 5,
  }, handlers));
  if (!recent.results?.some((entry) => entry.title === 'Smoke decision')) {
    throw new Error('MCP get_recent_decisions did not include the smoke decision');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

  smoke_section "Running MCP HTTP runtime smoke without auth"
  MCP_PROFILE=all MCP_HTTP_PORT=3003 MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PATH=/mcp CONTEXTFORGE_BACKEND_URL="$API_URL" \
    node apps/mcp-server/dist/index.js --http >"$MCP_HTTP_LOG" 2>&1 &
  SMOKE_MCP_HTTP_PID=$!
  wait_for_mcp_http "http://127.0.0.1:3003/mcp" "$MCP_HTTP_LOG"
  KB_ID="$SMOKE_KB_ID" node <<'NODE'
const { Client } = require('./apps/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js');
const { StreamableHTTPClientTransport } = require('./apps/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/streamableHttp.js');

async function main() {
  const client = new Client({ name: 'smoke-http-client', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3003/mcp'));

  await client.connect(transport);
  const tools = await client.listTools();
  if (!tools.tools?.some((tool) => tool.name === 'search_kb')) {
    throw new Error('HTTP MCP tools/list is missing search_kb');
  }

  const list = await client.callTool({ name: 'list_workspaces', arguments: {} });
  const parsedList = JSON.parse(list.content[0].text);
  if (!parsedList.workspaces?.some((kb) => kb.id === process.env.KB_ID)) {
    throw new Error('HTTP MCP list_workspaces did not include smoke workspace');
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
  stop_pid "$SMOKE_MCP_HTTP_PID"
  SMOKE_MCP_HTTP_PID=""

  smoke_section "Running MCP HTTP runtime smoke with auth enabled"
  MCP_PROFILE=all MCP_HTTP_PORT=3003 MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PATH=/mcp MCP_AUTH_ENABLED=true ADMIN_API_KEY=smoke-key \
    CONTEXTFORGE_BACKEND_URL="$API_URL" node apps/mcp-server/dist/index.js --http >"$MCP_HTTP_LOG" 2>&1 &
  SMOKE_MCP_HTTP_PID=$!
  wait_for_mcp_http "http://127.0.0.1:3003/mcp" "$MCP_HTTP_LOG"
  local auth_status
  auth_status="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3003/mcp -H "Content-Type: application/json" --data-binary '{}')"
  if [[ "$auth_status" != "401" ]]; then
    smoke_fail "expected unauthenticated MCP HTTP request to return 401, got $auth_status"
  fi
  KB_ID="$SMOKE_KB_ID" node <<'NODE'
const { Client } = require('./apps/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js');
const { StreamableHTTPClientTransport } = require('./apps/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/streamableHttp.js');

async function main() {
  const client = new Client({ name: 'smoke-http-auth-client', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3003/mcp'), {
    requestInit: {
      headers: {
        'X-API-Key': 'smoke-key',
      },
    },
  });

  await client.connect(transport);
  const list = await client.callTool({ name: 'list_workspaces', arguments: {} });
  const parsedList = JSON.parse(list.content[0].text);
  if (!parsedList.workspaces?.some((kb) => kb.id === process.env.KB_ID)) {
    throw new Error('Authenticated HTTP MCP list_workspaces did not include smoke workspace');
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
  stop_pid "$SMOKE_MCP_HTTP_PID"
  SMOKE_MCP_HTTP_PID=""

  if [[ "${SMOKE_RUN_BACKEND_AUTH_MCP:-1}" == "1" ]]; then
    smoke_section "Running MCP HTTP smoke with backend auth forwarding"
    local auth_api_url="http://localhost:3098"
    local auth_api_log=".smoke-api-auth.log"
    PORT=3098 API_KEY_AUTH_ENABLED=true ADMIN_API_KEY=smoke-key CONTEXTFORGE_API_KEY=smoke-key \
      pnpm --filter api start >"$auth_api_log" 2>&1 &
    SMOKE_AUTH_API_PID=$!
    wait_for_api "$auth_api_url" "$auth_api_log"

    MCP_PROFILE=all MCP_HTTP_PORT=3004 MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PATH=/mcp MCP_AUTH_ENABLED=true ADMIN_API_KEY=smoke-key \
      CONTEXTFORGE_BACKEND_URL="$auth_api_url" CONTEXTFORGE_API_KEY=smoke-key \
      node apps/mcp-server/dist/index.js --http >"$MCP_HTTP_LOG" 2>&1 &
    SMOKE_MCP_HTTP_PID=$!
    wait_for_mcp_http "http://127.0.0.1:3004/mcp" "$MCP_HTTP_LOG"
    KB_ID="$SMOKE_KB_ID" node <<'NODE'
const { Client } = require('./apps/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js');
const { StreamableHTTPClientTransport } = require('./apps/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/streamableHttp.js');

async function main() {
  const client = new Client({ name: 'smoke-http-backend-auth-client', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3004/mcp'), {
    requestInit: {
      headers: {
        Authorization: 'Bearer smoke-key',
      },
    },
  });

  await client.connect(transport);
  const list = await client.callTool({ name: 'list_workspaces', arguments: {} });
  const parsedList = JSON.parse(list.content[0].text);
  if (!parsedList.workspaces?.some((kb) => kb.id === process.env.KB_ID)) {
    throw new Error('Backend-auth HTTP MCP list_workspaces did not include smoke workspace');
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
    stop_pid "$SMOKE_MCP_HTTP_PID"
    SMOKE_MCP_HTTP_PID=""
    stop_pid "$SMOKE_AUTH_API_PID"
    SMOKE_AUTH_API_PID=""
  fi
}
