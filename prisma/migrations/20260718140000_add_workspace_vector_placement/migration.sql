CREATE TYPE "WorkspaceVectorPlacementMode" AS ENUM (
  'pinned',
  'capacity_assisted'
);

CREATE TYPE "WorkspaceVectorPlacementState" AS ENUM (
  'unloaded',
  'loading',
  'loaded',
  'partially_loaded',
  'degraded',
  'failed',
  'migrating'
);

CREATE TABLE "WorkspaceVectorPlacement" (
  "id" TEXT NOT NULL,
  "knowledgeBaseId" TEXT NOT NULL,
  "vectorBackendId" TEXT NOT NULL,
  "servingRevisionId" TEXT,
  "activeIndexBuildId" TEXT,
  "collectionAlias" TEXT NOT NULL,
  "physicalCollectionName" TEXT,
  "mode" "WorkspaceVectorPlacementMode" NOT NULL DEFAULT 'capacity_assisted',
  "state" "WorkspaceVectorPlacementState" NOT NULL DEFAULT 'unloaded',
  "reasonSnapshot" JSONB NOT NULL DEFAULT '{}',
  "capacitySnapshot" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceVectorPlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceVectorPlacement_knowledgeBaseId_key"
  ON "WorkspaceVectorPlacement"("knowledgeBaseId");
CREATE UNIQUE INDEX "WorkspaceVectorPlacement_activeIndexBuildId_key"
  ON "WorkspaceVectorPlacement"("activeIndexBuildId");
CREATE INDEX "WorkspaceVectorPlacement_vectorBackendId_state_idx"
  ON "WorkspaceVectorPlacement"("vectorBackendId", "state");
CREATE INDEX "WorkspaceVectorPlacement_servingRevisionId_idx"
  ON "WorkspaceVectorPlacement"("servingRevisionId");

ALTER TABLE "WorkspaceVectorPlacement"
  ADD CONSTRAINT "WorkspaceVectorPlacement_knowledgeBaseId_fkey"
  FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceVectorPlacement"
  ADD CONSTRAINT "WorkspaceVectorPlacement_vectorBackendId_fkey"
  FOREIGN KEY ("vectorBackendId") REFERENCES "VectorBackend"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceVectorPlacement"
  ADD CONSTRAINT "WorkspaceVectorPlacement_servingRevisionId_fkey"
  FOREIGN KEY ("servingRevisionId") REFERENCES "WorkspaceServingRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceVectorPlacement"
  ADD CONSTRAINT "WorkspaceVectorPlacement_activeIndexBuildId_fkey"
  FOREIGN KEY ("activeIndexBuildId") REFERENCES "IndexBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;
