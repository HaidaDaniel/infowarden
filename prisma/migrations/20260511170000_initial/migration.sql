-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('local_folder', 'git_repo', 'upload', 'url');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('active', 'syncing', 'failed', 'disabled');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('active', 'deleted', 'ignored', 'failed');

-- CreateEnum
CREATE TYPE "IndexVersionStatus" AS ENUM ('building', 'active', 'failed', 'archived');

-- CreateEnum
CREATE TYPE "IndexingJobType" AS ENUM ('scan_source', 'build_dataset', 'build_index', 'validate_dataset', 'evaluate_index');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ValidationLevel" AS ENUM ('deterministic', 'retrieval', 'llm_judge');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('passed', 'warning', 'failed');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('embedding', 'reranker', 'llm');

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "activeIndexVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "uri" TEXT NOT NULL,
    "includeRules" TEXT[],
    "excludeRules" TEXT[],
    "status" "SourceStatus" NOT NULL DEFAULT 'active',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSnapshot" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "snapshotType" TEXT NOT NULL,
    "ref" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "contentBytes" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT,
    "contentHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "DocumentStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "normalizedText" TEXT,
    "normalizedTextRef" TEXT,
    "textLength" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "indexVersionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "chunkIndex" INTEGER NOT NULL,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChunkVersion" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "indexVersionId" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChunkVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetVersion" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "sourceSnapshotIds" TEXT[],
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'building',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexVersion" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingDimension" INTEGER NOT NULL,
    "chunkingConfig" JSONB NOT NULL,
    "vectorCollectionName" TEXT NOT NULL,
    "status" "IndexVersionStatus" NOT NULL DEFAULT 'building',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexingJob" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "sourceId" TEXT,
    "type" "IndexingJobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "logs" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationReport" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "datasetVersionId" TEXT,
    "indexVersionId" TEXT,
    "level" "ValidationLevel" NOT NULL,
    "status" "ValidationStatus" NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "issues" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "indexVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalQuestion" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "expectedDocumentIds" TEXT[],
    "expectedChunkIds" TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL,
    "evalRunId" TEXT NOT NULL,
    "evalQuestionId" TEXT NOT NULL,
    "retrievedChunkIds" TEXT[],
    "scores" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConfig" (
    "id" TEXT NOT NULL,
    "type" "ProviderType" NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyRef" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DatasetVersionToSourceSnapshot" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_DatasetVersionToSourceSnapshot_AB_unique" ON "_DatasetVersionToSourceSnapshot"("A", "B");

-- CreateIndex
CREATE INDEX "_DatasetVersionToSourceSnapshot_B_index" ON "_DatasetVersionToSourceSnapshot"("B");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "SourceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_indexVersionId_fkey" FOREIGN KEY ("indexVersionId") REFERENCES "IndexVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkVersion" ADD CONSTRAINT "ChunkVersion_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkVersion" ADD CONSTRAINT "ChunkVersion_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkVersion" ADD CONSTRAINT "ChunkVersion_indexVersionId_fkey" FOREIGN KEY ("indexVersionId") REFERENCES "IndexVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexVersion" ADD CONSTRAINT "IndexVersion_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexVersion" ADD CONSTRAINT "IndexVersion_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexingJob" ADD CONSTRAINT "IndexingJob_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexingJob" ADD CONSTRAINT "IndexingJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationReport" ADD CONSTRAINT "ValidationReport_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationReport" ADD CONSTRAINT "ValidationReport_indexVersionId_fkey" FOREIGN KEY ("indexVersionId") REFERENCES "IndexVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_indexVersionId_fkey" FOREIGN KEY ("indexVersionId") REFERENCES "IndexVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalQuestion" ADD CONSTRAINT "EvalQuestion_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_evalRunId_fkey" FOREIGN KEY ("evalRunId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DatasetVersionToSourceSnapshot" ADD CONSTRAINT "_DatasetVersionToSourceSnapshot_A_fkey" FOREIGN KEY ("A") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DatasetVersionToSourceSnapshot" ADD CONSTRAINT "_DatasetVersionToSourceSnapshot_B_fkey" FOREIGN KEY ("B") REFERENCES "SourceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
