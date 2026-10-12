CREATE TABLE "RetrievalProfile" (
  "id" TEXT NOT NULL,
  "knowledgeBaseId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "intent" TEXT NOT NULL DEFAULT 'general_search',
  "denseTopK" INTEGER NOT NULL DEFAULT 10,
  "scoreThreshold" DOUBLE PRECISION,
  "neighborBefore" INTEGER NOT NULL DEFAULT 0,
  "neighborAfter" INTEGER NOT NULL DEFAULT 0,
  "tokenBudget" INTEGER,
  "grouping" TEXT NOT NULL DEFAULT 'document',
  "recencyBoost" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RetrievalProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RetrievalProfile_knowledgeBaseId_key_key" ON "RetrievalProfile"("knowledgeBaseId", "key");

ALTER TABLE "RetrievalProfile"
ADD CONSTRAINT "RetrievalProfile_knowledgeBaseId_fkey"
FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
