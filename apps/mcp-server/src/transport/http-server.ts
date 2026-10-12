import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { MCPServerConfig } from '../config';

type ServerFactory = (config: MCPServerConfig) => Server;

export function createHttpServer(config: MCPServerConfig, createServerFactory: ServerFactory): HttpServer {
  return createServer((request, response) => {
    void (async () => {
      try {
        await handleHttpRequest(request, response, config, createServerFactory);
      } catch (error) {
        console.error('MCP HTTP Server error:', error);
        if (!response.headersSent) {
          writeJsonRpcError(response, 500, 'Internal server error');
        } else {
          response.end();
        }
      }
    })();
  });
}

export async function startHttpServer(
  config: MCPServerConfig,
  createServerFactory: ServerFactory,
): Promise<HttpServer> {
  const server = createHttpServer(config, createServerFactory);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.httpPort, config.httpHost, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: MCPServerConfig,
  createServerFactory: ServerFactory,
) {
  const pathname = getPathname(request.url);
  if (pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (pathname !== config.httpPath) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (request.method !== 'POST') {
    writeJsonRpcError(response, 405, 'Method not allowed');
    return;
  }

  if (config.mcpAuthEnabled && !requestHasValidApiKey(request, config.adminApiKey)) {
    writeUnauthorized(response, request.url || config.httpPath);
    return;
  }

  const body = await readJsonBody(request);
  const server = createServerFactory(config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    response.once('close', () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(request, response, body);
  } catch (error) {
    await transport.close();
    await server.close();
    throw error;
  }
}

function getPathname(rawUrl?: string): string {
  return new URL(rawUrl || '/', 'http://localhost').pathname;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function writeJsonRpcError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message,
      },
      id: null,
    }),
  );
}

function writeUnauthorized(response: ServerResponse, path: string) {
  response.writeHead(401, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({
      error: {
        code: 'unauthorized',
        message: 'Valid API key required',
      },
      path,
      timestamp: new Date().toISOString(),
    }),
  );
}

function requestHasValidApiKey(request: IncomingMessage, expectedApiKey?: string): boolean {
  return extractApiKey(request.headers) === expectedApiKey;
}

function extractApiKey(headers: IncomingMessage['headers']): string | undefined {
  const headerKey = firstHeader(headers['x-api-key']);
  if (headerKey) {
    return headerKey;
  }

  const authorization = firstHeader(headers.authorization);
  if (!authorization) {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const trimmed = item.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return undefined;
}
