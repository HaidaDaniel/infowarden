CREATE TYPE "MemoryEntryType" AS ENUM (
  'decision',
  'session_summary',
  'runbook',
  'infra_note',
  'deployment_note',
  'benchmark_result',
  'incident_note',
  'fact'
);

CREATE TABLE "MemoryEntry" (
  "id" TEXT NOT NULL,
  "knowledgeBaseId" TEXT NOT NULL,
  "entryType" "MemoryEntryType" NOT NULL,
  "title" TEXT,
  "body" TEXT NOT NULL,
  "summary" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "authoredBy" TEXT,
  "sessionId" TEXT,
  "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "occurredAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MemoryEntry"
ADD CONSTRAINT "MemoryEntry_knowledgeBaseId_fkey"
FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
