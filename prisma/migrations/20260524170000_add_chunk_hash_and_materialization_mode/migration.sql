ALTER TABLE "Chunk"
ADD COLUMN "textHash" TEXT NOT NULL DEFAULT '';

ALTER TABLE "IndexVersion"
ADD COLUMN "materializationMode" TEXT NOT NULL DEFAULT 'mutable_collection';
