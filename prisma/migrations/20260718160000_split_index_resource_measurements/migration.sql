ALTER TABLE "IndexVersion"
  ADD COLUMN "resourceRequested" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "resourceAllocated" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "resourceObserved" JSONB NOT NULL DEFAULT '{}';

UPDATE "IndexVersion"
SET
  "resourceObserved" = "resourceActual",
  "resourceRequested" = jsonb_build_object(
    'storageProfile',
    "storageProfile",
    'storageConfig',
    "storageConfig",
    'recordedAt',
    COALESCE("createdAt", now())
  )
WHERE "resourceActual" <> '{}'::jsonb
   OR "storageProfile" IS NOT NULL;
