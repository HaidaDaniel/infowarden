CREATE TYPE "VectorMaterializationOperationKind" AS ENUM ('full_rebuild', 'backend_move');

CREATE TYPE "VectorMaterializationOperationState" AS ENUM (
  'planned', 'building', 'validating', 'ready_for_cutover', 'cutover_complete',
  'rollback_complete', 'cleanup_pending', 'cleanup_complete', 'failed', 'cancelled'
);

CREATE TABLE "VectorMaterializationOperation" (
  "id" TEXT NOT NULL,
  "knowledgeBaseId" TEXT NOT NULL,
  "kind" "VectorMaterializationOperationKind" NOT NULL,
  "state" "VectorMaterializationOperationState" NOT NULL DEFAULT 'planned',
  "idempotencyKey" TEXT NOT NULL,
  "sourceVectorBackendId" TEXT,
  "targetVectorBackendId" TEXT NOT NULL,
  "sourceCollectionName" TEXT,
  "targetCollectionName" TEXT NOT NULL,
  "servingRevisionId" TEXT,
  "sourceIndexBuildId" TEXT,
  "targetIndexBuildId" TEXT,
  "validationSummary" JSONB NOT NULL DEFAULT '{}',
  "errorSummary" JSONB NOT NULL DEFAULT '{}',
  "rollbackUntil" TIMESTAMP(3),
  "cleanupAfter" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VectorMaterializationOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VectorMaterializationOperation_knowledgeBaseId_idempotencyKey_key"
  ON "VectorMaterializationOperation"("knowledgeBaseId", "idempotencyKey");
CREATE INDEX "VectorMaterializationOperation_knowledgeBaseId_state_createdAt_idx"
  ON "VectorMaterializationOperation"("knowledgeBaseId", "state", "createdAt");
CREATE INDEX "VectorMaterializationOperation_targetVectorBackendId_state_idx"
  ON "VectorMaterializationOperation"("targetVectorBackendId", "state");

ALTER TABLE "VectorMaterializationOperation"
  ADD CONSTRAINT "VectorMaterializationOperation_knowledgeBaseId_fkey"
  FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
