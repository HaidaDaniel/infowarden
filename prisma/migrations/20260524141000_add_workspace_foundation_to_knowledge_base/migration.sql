CREATE TYPE "WorkspaceKind" AS ENUM (
  'general',
  'codebase',
  'docs',
  'agent_memory',
  'ops_context',
  'personal_work_history',
  'benchmarks',
  'contracts',
  'datasets',
  'custom'
);

ALTER TABLE "KnowledgeBase"
ADD COLUMN "workspaceKind" "WorkspaceKind" NOT NULL DEFAULT 'general',
ADD COLUMN "defaultIndexProfile" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN "defaultRetrievalProfile" TEXT NOT NULL DEFAULT 'default';
