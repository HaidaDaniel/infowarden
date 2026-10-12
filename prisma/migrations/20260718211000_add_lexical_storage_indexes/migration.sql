CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Chunk"
ADD COLUMN "sourceRevisionId" TEXT;

UPDATE "Chunk"
SET "sourceRevisionId" = "metadata"->>'sourceRevisionId'
WHERE "sourceRevisionId" IS NULL
  AND "metadata" ? 'sourceRevisionId';

ALTER TABLE "Chunk"
ADD COLUMN "lexicalSearch" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce("text", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("metadata"->>'path', '')), 'B') ||
  setweight(to_tsvector('simple', coalesce("metadata"->>'title', '')), 'B') ||
  setweight(to_tsvector('simple', coalesce("metadata"->>'headings', '')), 'B') ||
  setweight(to_tsvector('simple', coalesce("metadata"->>'language', '')), 'C') ||
  setweight(to_tsvector('simple', coalesce("metadata"->>'branch', '')), 'C') ||
  setweight(to_tsvector('simple', coalesce("metadata"->>'commit', '')), 'C') ||
  setweight(to_tsvector('simple', coalesce("id", '')), 'D') ||
  setweight(to_tsvector('simple', coalesce("documentId", '')), 'D')
) STORED;

CREATE INDEX "Chunk_lexicalSearch_idx"
ON "Chunk"
USING GIN ("lexicalSearch");

CREATE INDEX "Document_path_trgm_idx"
ON "Document"
USING GIN ("path" gin_trgm_ops);

CREATE INDEX "Chunk_metadata_path_trgm_idx"
ON "Chunk"
USING GIN ((jsonb_extract_path_text("metadata", 'path')) gin_trgm_ops);

CREATE INDEX "Chunk_metadata_language_idx"
ON "Chunk" ((jsonb_extract_path_text("metadata", 'language')));

CREATE INDEX "Chunk_metadata_branch_idx"
ON "Chunk" ((jsonb_extract_path_text("metadata", 'branch')));

CREATE INDEX "Chunk_metadata_sourceRevisionId_idx"
ON "Chunk" ((jsonb_extract_path_text("metadata", 'sourceRevisionId')));

CREATE INDEX "VectorMaterializationOperation_knowledgeBaseId_kind_state_updatedAt_idx"
ON "VectorMaterializationOperation" ("knowledgeBaseId", "kind", "state", "updatedAt");

CREATE INDEX "RetrievalProfile_knowledgeBaseId_intent_idx"
ON "RetrievalProfile" ("knowledgeBaseId", "intent");

CREATE INDEX "Source_knowledgeBaseId_status_type_idx"
ON "Source" ("knowledgeBaseId", "status", "type");

CREATE INDEX "Source_knowledgeBaseId_updatedAt_idx"
ON "Source" ("knowledgeBaseId", "updatedAt");

CREATE INDEX "SourceSnapshot_knowledgeBaseId_snapshotType_createdAt_idx"
ON "SourceSnapshot" ("knowledgeBaseId", "snapshotType", "createdAt");

CREATE INDEX "SourceSnapshot_sourceId_createdAt_idx"
ON "SourceSnapshot" ("sourceId", "createdAt");

CREATE INDEX "Document_sourceId_status_path_idx"
ON "Document" ("sourceId", "status", "path");

CREATE INDEX "Document_status_updatedAt_idx"
ON "Document" ("status", "updatedAt");

CREATE INDEX "DocumentVersion_documentId_createdAt_idx"
ON "DocumentVersion" ("documentId", "createdAt");

CREATE INDEX "DocumentVersion_sourceSnapshotId_createdAt_idx"
ON "DocumentVersion" ("sourceSnapshotId", "createdAt");

CREATE INDEX "Chunk_sourceRevisionId_chunkIndex_idx"
ON "Chunk" ("sourceRevisionId", "chunkIndex");

CREATE INDEX "Chunk_sourceRevisionId_indexVersionId_chunkIndex_idx"
ON "Chunk" ("sourceRevisionId", "indexVersionId", "chunkIndex");

CREATE INDEX "Chunk_documentId_indexVersionId_chunkIndex_idx"
ON "Chunk" ("documentId", "indexVersionId", "chunkIndex");

CREATE INDEX "Chunk_indexVersionId_chunkIndex_idx"
ON "Chunk" ("indexVersionId", "chunkIndex");

CREATE INDEX "Chunk_textHash_idx"
ON "Chunk" ("textHash");

CREATE INDEX "ChunkVersion_chunkId_createdAt_idx"
ON "ChunkVersion" ("chunkId", "createdAt");

CREATE INDEX "ChunkVersion_documentVersionId_indexVersionId_idx"
ON "ChunkVersion" ("documentVersionId", "indexVersionId");

CREATE INDEX "DatasetVersion_knowledgeBaseId_status_createdAt_idx"
ON "DatasetVersion" ("knowledgeBaseId", "status", "createdAt");

CREATE INDEX "IndexVersion_knowledgeBaseId_status_createdAt_idx"
ON "IndexVersion" ("knowledgeBaseId", "status", "createdAt");

CREATE INDEX "IndexVersion_knowledgeBaseId_lifecycleStatus_status_idx"
ON "IndexVersion" ("knowledgeBaseId", "lifecycleStatus", "status");

CREATE INDEX "IndexVersion_datasetVersionId_status_idx"
ON "IndexVersion" ("datasetVersionId", "status");

CREATE INDEX "IndexingJob_knowledgeBaseId_status_createdAt_idx"
ON "IndexingJob" ("knowledgeBaseId", "status", "createdAt");

CREATE INDEX "IndexingJob_sourceId_status_createdAt_idx"
ON "IndexingJob" ("sourceId", "status", "createdAt");

CREATE INDEX "IndexingJob_type_status_createdAt_idx"
ON "IndexingJob" ("type", "status", "createdAt");

CREATE INDEX "ValidationReport_knowledgeBaseId_level_status_createdAt_idx"
ON "ValidationReport" ("knowledgeBaseId", "level", "status", "createdAt");

CREATE INDEX "ValidationReport_indexVersionId_level_status_idx"
ON "ValidationReport" ("indexVersionId", "level", "status");

CREATE INDEX "EvalRun_knowledgeBaseId_status_createdAt_idx"
ON "EvalRun" ("knowledgeBaseId", "status", "createdAt");

CREATE INDEX "EvalRun_indexVersionId_status_createdAt_idx"
ON "EvalRun" ("indexVersionId", "status", "createdAt");

CREATE INDEX "EvalQuestion_knowledgeBaseId_createdAt_idx"
ON "EvalQuestion" ("knowledgeBaseId", "createdAt");
