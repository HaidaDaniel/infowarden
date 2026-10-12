import { McpProfile, resolveMcpProfile } from './profile';

export interface MCPServerConfig {
  backendUrl: string;
  apiKey?: string;
  adminApiKey?: string;
  httpHost: string;
  httpPort: number;
  httpPath: string;
  mcpAuthEnabled: boolean;
  profile: McpProfile;
}

export function getConfig(): MCPServerConfig {
  const adminApiKey = normalizeSecret(process.env.ADMIN_API_KEY);
  const mcpAuthEnabled = parseBoolean(process.env.MCP_AUTH_ENABLED, false);
  const backendAuthEnabled = parseBoolean(process.env.API_KEY_AUTH_ENABLED, false);

  if ((mcpAuthEnabled || backendAuthEnabled) && !adminApiKey) {
    throw new Error('ADMIN_API_KEY is required when MCP or backend API key auth is enabled');
  }

  return {
    backendUrl: process.env.CONTEXTFORGE_BACKEND_URL || 'http://localhost:3000',
    apiKey: normalizeSecret(process.env.CONTEXTFORGE_API_KEY) || adminApiKey,
    adminApiKey,
    httpHost: process.env.MCP_HTTP_HOST || '0.0.0.0',
    httpPort: parseInteger(process.env.MCP_HTTP_PORT, 3003, 'MCP_HTTP_PORT'),
    httpPath: normalizeHttpPath(process.env.MCP_HTTP_PATH || '/mcp'),
    mcpAuthEnabled,
    profile: resolveMcpProfile(process.env.MCP_PROFILE),
  };
}

function parseInteger(rawValue: string | undefined, fallback: number, name: string): number {
  if (!rawValue || rawValue.trim().length === 0) {
    return fallback;
  }
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function normalizeHttpPath(rawValue: string): string {
  const trimmed = rawValue.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parseBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (!rawValue || rawValue.trim().length === 0) {
    return fallback;
  }
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  throw new Error(`Expected "true" or "false" but received "${rawValue}"`);
}

function normalizeSecret(rawValue: string | undefined): string | undefined {
  if (!rawValue) {
    return undefined;
  }
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
