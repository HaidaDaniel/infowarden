export const MCP_PROFILES = ['read', 'agent', 'operator', 'all'] as const;

export type McpProfile = (typeof MCP_PROFILES)[number];

export const LEGACY_TOOL_NAMES = [
  'ask_workspace',
  'get_answer_chunks',
  'rag_answer',
  'list_knowledge_bases',
  'list_workspaces',
  'get_index_status',
  'get_workspace_status',
  'get_resource_status',
  'get_workspace_resource_status',
  'load_workspace',
  'unload_workspace',
  'get_vector_backends',
  'get_workspace_vector_placement',
  'pin_workspace_vector_backend',
  'request_workspace_vector_move',
  'rollback_vector_operation',
  'cleanup_vector_operation',
  'search_kb',
  'search_codebase',
  'search_code',
  'search_docs',
  'search_memory',
  'get_context_package',
  'get_recent_decisions',
  'save_session_summary',
  'remember_fact',
  'update_memory_entry',
  'archive_memory_entry',
  'delete_memory_entry',
  'get_document_context',
  'get_chunk_neighbors',
] as const;

const READ_TOOLS = ['list_workspaces', 'retrieve_context', 'read_document', 'search_memory'] as const;

const AGENT_TOOLS = [...READ_TOOLS, 'get_recent_decisions', 'write_memory', 'update_memory', 'archive_memory'] as const;

const OPERATOR_TOOLS = [
  ...READ_TOOLS,
  'get_workspace_status',
  'get_index_status',
  'get_resource_status',
  'get_workspace_resource_status',
  'load_workspace',
  'unload_workspace',
  'get_vector_backends',
  'get_workspace_vector_placement',
  'pin_workspace_vector_backend',
  'request_workspace_vector_move',
  'rollback_vector_operation',
  'cleanup_vector_operation',
  'delete_memory',
] as const;

const ALL_TOOLS = [
  ...LEGACY_TOOL_NAMES,
  'retrieve_context',
  'read_document',
  'answer_workspace',
  'write_memory',
  'update_memory',
  'archive_memory',
  'delete_memory',
];

const PROFILE_TOOLS: Record<McpProfile, readonly string[]> = {
  read: READ_TOOLS,
  agent: AGENT_TOOLS,
  operator: OPERATOR_TOOLS,
  all: ALL_TOOLS,
};

export function resolveMcpProfile(value?: string | null): McpProfile {
  if (value === undefined || value === null || value.trim().length === 0) {
    return 'read';
  }
  const normalized = value.trim().toLowerCase();
  if ((MCP_PROFILES as readonly string[]).includes(normalized)) {
    return normalized as McpProfile;
  }
  throw new Error(`Invalid MCP profile '${value}'. Expected one of: ${MCP_PROFILES.join(', ')}`);
}

export function toolsForProfile(profile: McpProfile): string[] {
  return [...PROFILE_TOOLS[profile]];
}

export function profileAllowsTool(profile: McpProfile, toolName: string): boolean {
  return PROFILE_TOOLS[profile].includes(toolName);
}
