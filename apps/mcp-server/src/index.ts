import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getConfig, type MCPServerConfig } from './config';
import { BackendApiClient } from './backend-client';
import { consumerToolDefinitionOverrideMap, mcpToolDefinitionMap } from './registry/tool-definitions';
import { toolsForProfile } from './profile';
import { createToolHandlers, handleToolCall } from './dispatch/tool-dispatcher';
import { createHttpServer, startHttpServer } from './transport/http-server';

export type { MCPServerConfig } from './config';
export { getConfig } from './config';
export {
  consumerToolDefinitionOverrides,
  mcpToolDefinitions,
  profileToolDefinitions,
  toolDefinitions,
} from './registry/tool-definitions';
export { createToolHandlers, handleToolCall } from './dispatch/tool-dispatcher';

export function createContextForgeServer(config: MCPServerConfig = getConfig()): Server {
  const handlers = createToolHandlers(new BackendApiClient(config.backendUrl, config.apiKey));
  const server = new Server(
    {
      name: 'infowarden-mcp-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const profile = config.profile;
  const profileTools = toolsForProfile(profile)
    .map((name) =>
      profile === 'all'
        ? mcpToolDefinitionMap.get(name)
        : (consumerToolDefinitionOverrideMap.get(name) ?? mcpToolDefinitionMap.get(name)),
    )
    .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: profileTools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, args, handlers, profile);
  });

  return server;
}

export const createInfoWardenServer = createContextForgeServer;

export function createContextForgeHttpServer(config: MCPServerConfig = getConfig()) {
  return createHttpServer(config, createContextForgeServer);
}

export async function startContextForgeHttpServer(config: MCPServerConfig = getConfig()) {
  return startHttpServer(config, createContextForgeServer);
}

async function main(argv: string[] = process.argv.slice(2)) {
  if (argv.includes('--http')) {
    const config = getConfig();
    await startContextForgeHttpServer(config);
    console.error(`InfoWarden MCP Server running on http://${config.httpHost}:${config.httpPort}${config.httpPath}`);
    return;
  }

  const transport = new StdioServerTransport();
  await createContextForgeServer().connect(transport);
  console.error('InfoWarden MCP Server running on stdio');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('MCP Server error:', error);
    process.exit(1);
  });
}
