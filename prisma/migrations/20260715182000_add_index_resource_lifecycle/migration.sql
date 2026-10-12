ALTER TABLE "IndexVersion"
  ADD COLUMN "storageProfile" TEXT NOT NULL DEFAULT 'balanced',
  ADD COLUMN "storageConfig" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "lifecycleStatus" TEXT NOT NULL DEFAULT 'loaded',
  ADD COLUMN "resourceEstimate" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "resourceActual" JSONB NOT NULL DEFAULT '{}';
