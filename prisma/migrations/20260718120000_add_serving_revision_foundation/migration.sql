CREATE TYPE "SourceRevisionStatus" AS ENUM (
  'building',
  'ready',
  'failed',
  'superseded'
);

CREATE TYPE "WorkspaceServingRevisionStatus" AS ENUM (
  'building',
  'ready',
  'active',
  'failed',
  'archived',
  'reconciliation_required'
);

CREATE TYPE "WorkspaceServingState" AS ENUM (
  'uninitialized',
  'active',
  'reconciliation_required',
  'failed'
);

CREATE TYPE "IndexBuildStatus" AS ENUM (
  'building',
  'validating',
  'ready',
  'active',
  'failed',
  'archived'
);

ALTER TABLE "KnowledgeBase"
  ADD COLUMN "activeServingRevisionId" TEXT,
  ADD COLUMN "servingRevisionState" "WorkspaceServingState" NOT NULL DEFAULT 'uninitialized';

CREATE TABLE "SourceRevision" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "knowledgeBaseId" TEXT NOT NULL,
  "sourceSnapshotId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "documentCount" INTEGER NOT NULL DEFAULT 0,
  "status" "SourceRevisionStatus" NOT NULL DEFAULT 'building',
  "validationSummary" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SourceRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceServingRevision" (
  "id" TEXT NOT NULL,
  "knowledgeBaseId" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "embeddingProfileSnapshot" JSONB NOT NULL,
  "chunkingProfileSnapshot" JSONB NOT NULL,
  "payloadSchemaVersion" TEXT NOT NULL,
  "status" "WorkspaceServingRevisionStatus" NOT NULL DEFAULT 'building',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceServingRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceServingManifestEntry" (
  "id" TEXT NOT NULL,
  "workspaceServingRevisionId" TEXT NOT NULL,
  "sourceRevisionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkspaceServingManifestEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IndexBuild" (
  "id" TEXT NOT NULL,
  "knowledgeBaseId" TEXT NOT NULL,
  "workspaceServingRevisionId" TEXT NOT NULL,
  "sourceRevisionId" TEXT,
  "indexVersionId" TEXT,
  "buildKind" TEXT NOT NULL DEFAULT 'incremental_source',
  "physicalCollectionName" TEXT NOT NULL,
  "storageProfile" TEXT NOT NULL,
  "configSnapshot" JSONB NOT NULL DEFAULT '{}',
  "validationSummary" JSONB NOT NULL DEFAULT '{}',
  "resourceEstimate" JSONB NOT NULL DEFAULT '{}',
  "resourceObserved" JSONB NOT NULL DEFAULT '{}',
  "status" "IndexBuildStatus" NOT NULL DEFAULT 'building',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IndexBuild_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeBase_activeServingRevisionId_key"
  ON "KnowledgeBase"("activeServingRevisionId");
CREATE UNIQUE INDEX "SourceRevision_sourceSnapshotId_key"
  ON "SourceRevision"("sourceSnapshotId");
CREATE INDEX "SourceRevision_sourceId_status_createdAt_idx"
  ON "SourceRevision"("sourceId", "status", "createdAt");
CREATE INDEX "SourceRevision_knowledgeBaseId_status_idx"
  ON "SourceRevision"("knowledgeBaseId", "status");
CREATE UNIQUE INDEX "WorkspaceServingRevision_knowledgeBaseId_manifestHash_key"
  ON "WorkspaceServingRevision"("knowledgeBaseId", "manifestHash");
CREATE INDEX "WorkspaceServingRevision_knowledgeBaseId_status_createdAt_idx"
  ON "WorkspaceServingRevision"("knowledgeBaseId", "status", "createdAt");
CREATE UNIQUE INDEX "WorkspaceServingManifestEntry_workspaceServingRevisionId_sourceRevisionId_key"
  ON "WorkspaceServingManifestEntry"("workspaceServingRevisionId", "sourceRevisionId");
CREATE UNIQUE INDEX "WorkspaceServingManifestEntry_workspaceServingRevisionId_position_key"
  ON "WorkspaceServingManifestEntry"("workspaceServingRevisionId", "position");
CREATE INDEX "WorkspaceServingManifestEntry_sourceRevisionId_idx"
  ON "WorkspaceServingManifestEntry"("sourceRevisionId");
CREATE UNIQUE INDEX "IndexBuild_indexVersionId_key"
  ON "IndexBuild"("indexVersionId");
CREATE INDEX "IndexBuild_knowledgeBaseId_status_createdAt_idx"
  ON "IndexBuild"("knowledgeBaseId", "status", "createdAt");
CREATE INDEX "IndexBuild_workspaceServingRevisionId_status_idx"
  ON "IndexBuild"("workspaceServingRevisionId", "status");
CREATE INDEX "IndexBuild_sourceRevisionId_idx"
  ON "IndexBuild"("sourceRevisionId");

ALTER TABLE "SourceRevision"
  ADD CONSTRAINT "SourceRevision_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceRevision"
  ADD CONSTRAINT "SourceRevision_knowledgeBaseId_fkey"
  FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceRevision"
  ADD CONSTRAINT "SourceRevision_sourceSnapshotId_fkey"
  FOREIGN KEY ("sourceSnapshotId") REFERENCES "SourceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceServingRevision"
  ADD CONSTRAINT "WorkspaceServingRevision_knowledgeBaseId_fkey"
  FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceServingManifestEntry"
  ADD CONSTRAINT "WorkspaceServingManifestEntry_workspaceServingRevisionId_fkey"
  FOREIGN KEY ("workspaceServingRevisionId") REFERENCES "WorkspaceServingRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceServingManifestEntry"
  ADD CONSTRAINT "WorkspaceServingManifestEntry_sourceRevisionId_fkey"
  FOREIGN KEY ("sourceRevisionId") REFERENCES "SourceRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IndexBuild"
  ADD CONSTRAINT "IndexBuild_knowledgeBaseId_fkey"
  FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndexBuild"
  ADD CONSTRAINT "IndexBuild_workspaceServingRevisionId_fkey"
  FOREIGN KEY ("workspaceServingRevisionId") REFERENCES "WorkspaceServingRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndexBuild"
  ADD CONSTRAINT "IndexBuild_sourceRevisionId_fkey"
  FOREIGN KEY ("sourceRevisionId") REFERENCES "SourceRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IndexBuild"
  ADD CONSTRAINT "IndexBuild_indexVersionId_fkey"
  FOREIGN KEY ("indexVersionId") REFERENCES "IndexVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill only a provably single-source active workspace. Multi-source legacy
-- collections remain explicitly reconciliation-required.
CREATE TEMP TABLE "_legacy_serving_backfill" AS
SELECT
  kb."id" AS "knowledgeBaseId",
  source."id" AS "sourceId",
  snapshot."id" AS "sourceSnapshotId",
  dataset."id" AS "datasetVersionId",
  index_version."id" AS "indexVersionId",
  index_version."embeddingModel",
  index_version."embeddingDimension",
  index_version."chunkingConfig",
  index_version."vectorCollectionName",
  index_version."storageProfile",
  index_version."storageConfig",
  index_version."resourceEstimate",
  index_version."resourceActual",
  dataset."contentHash",
  dataset."documentCount"
FROM "KnowledgeBase" kb
JOIN "IndexVersion" index_version
  ON index_version."id" = kb."activeIndexVersionId"
JOIN "DatasetVersion" dataset
  ON dataset."id" = index_version."datasetVersionId"
JOIN "_DatasetVersionToSourceSnapshot" link
  ON link."A" = dataset."id"
JOIN "SourceSnapshot" snapshot
  ON snapshot."id" = link."B"
JOIN "Source" source
  ON source."id" = snapshot."sourceId"
WHERE source."knowledgeBaseId" = kb."id"
  AND source."status" = 'active'
  AND (
    SELECT COUNT(*)
    FROM "Source" active_source
    WHERE active_source."knowledgeBaseId" = kb."id"
      AND active_source."status" = 'active'
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM "_DatasetVersionToSourceSnapshot" dataset_link
    WHERE dataset_link."A" = dataset."id"
  ) = 1;

INSERT INTO "SourceRevision" (
  "id", "sourceId", "knowledgeBaseId", "sourceSnapshotId", "contentHash",
  "parserVersion", "documentCount", "status", "validationSummary", "metadata",
  "createdAt", "updatedAt"
)
SELECT
  'legacy-source-revision-' || "sourceSnapshotId",
  "sourceId",
  "knowledgeBaseId",
  "sourceSnapshotId",
  "contentHash",
  'legacy-unknown',
  "documentCount",
  'ready',
  jsonb_build_object('backfill', true, 'validation', 'legacy_active_index_assumed'),
  jsonb_build_object('backfill', true, 'confidence', 'single_source_active_index'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_legacy_serving_backfill";

INSERT INTO "WorkspaceServingRevision" (
  "id", "knowledgeBaseId", "manifestHash", "embeddingProfileSnapshot",
  "chunkingProfileSnapshot", "payloadSchemaVersion", "status", "metadata",
  "activatedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-serving-revision-' || "knowledgeBaseId",
  "knowledgeBaseId",
  'legacy:' || md5("knowledgeBaseId" || ':' || "sourceSnapshotId" || ':' || "indexVersionId"),
  jsonb_build_object('model', "embeddingModel", 'dimension', "embeddingDimension"),
  "chunkingConfig",
  'qdrant-chunk-payload-v1',
  'active',
  jsonb_build_object('backfill', true, 'confidence', 'single_source_active_index'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_legacy_serving_backfill";

INSERT INTO "WorkspaceServingManifestEntry" (
  "id", "workspaceServingRevisionId", "sourceRevisionId", "position", "createdAt"
)
SELECT
  'legacy-serving-entry-' || "sourceSnapshotId",
  'legacy-serving-revision-' || "knowledgeBaseId",
  'legacy-source-revision-' || "sourceSnapshotId",
  0,
  CURRENT_TIMESTAMP
FROM "_legacy_serving_backfill";

INSERT INTO "IndexBuild" (
  "id", "knowledgeBaseId", "workspaceServingRevisionId", "sourceRevisionId",
  "indexVersionId", "buildKind", "physicalCollectionName", "storageProfile",
  "configSnapshot", "validationSummary", "resourceEstimate", "resourceObserved",
  "status", "startedAt", "finishedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-index-build-' || "indexVersionId",
  "knowledgeBaseId",
  'legacy-serving-revision-' || "knowledgeBaseId",
  'legacy-source-revision-' || "sourceSnapshotId",
  "indexVersionId",
  'legacy_backfill',
  "vectorCollectionName",
  "storageProfile",
  jsonb_build_object(
    'embeddingModel', "embeddingModel",
    'embeddingDimension', "embeddingDimension",
    'chunkingConfig', "chunkingConfig",
    'storageConfig', "storageConfig"
  ),
  jsonb_build_object('backfill', true, 'validation', 'legacy_active_index_assumed'),
  "resourceEstimate",
  "resourceActual",
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_legacy_serving_backfill";

UPDATE "KnowledgeBase" kb
SET
  "activeServingRevisionId" = 'legacy-serving-revision-' || backfill."knowledgeBaseId",
  "servingRevisionState" = 'active'
FROM "_legacy_serving_backfill" backfill
WHERE kb."id" = backfill."knowledgeBaseId";

UPDATE "KnowledgeBase"
SET "servingRevisionState" = 'reconciliation_required'
WHERE "activeIndexVersionId" IS NOT NULL
  AND "activeServingRevisionId" IS NULL;

DROP TABLE "_legacy_serving_backfill";

ALTER TABLE "KnowledgeBase"
  ADD CONSTRAINT "KnowledgeBase_activeServingRevisionId_fkey"
  FOREIGN KEY ("activeServingRevisionId") REFERENCES "WorkspaceServingRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
