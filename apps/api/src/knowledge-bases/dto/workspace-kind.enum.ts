export const WORKSPACE_KIND_VALUES = [
  'general',
  'codebase',
  'docs',
  'agent_memory',
  'ops_context',
  'personal_work_history',
  'benchmarks',
  'contracts',
  'datasets',
  'custom',
] as const;

export type WorkspaceKindValue = (typeof WORKSPACE_KIND_VALUES)[number];
