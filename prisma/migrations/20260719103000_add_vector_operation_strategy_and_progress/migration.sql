CREATE TYPE "VectorMaterializationStrategy" AS ENUM ('compatible_copy', 'canonical_reembed');

ALTER TABLE "VectorMaterializationOperation"
  ADD COLUMN "strategy" "VectorMaterializationStrategy" NOT NULL DEFAULT 'canonical_reembed',
  ADD COLUMN "buildJobId" TEXT,
  ADD COLUMN "progressCheckpoint" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
