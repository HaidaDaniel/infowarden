CREATE TYPE "VectorBackendState" AS ENUM (
  'enabled',
  'draining',
  'disabled',
  'offline'
);

CREATE TABLE "VectorBackend" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "apiKeyRef" TEXT,
  "tlsVerify" BOOLEAN NOT NULL DEFAULT true,
  "networkPolicy" JSONB NOT NULL DEFAULT '{}',
  "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "state" "VectorBackendState" NOT NULL DEFAULT 'enabled',
  "capacityHints" JSONB NOT NULL DEFAULT '{}',
  "observedResources" JSONB NOT NULL DEFAULT '{}',
  "healthMetadata" JSONB NOT NULL DEFAULT '{}',
  "lastHealthAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VectorBackend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VectorBackend_name_key" ON "VectorBackend"("name");
CREATE UNIQUE INDEX "VectorBackend_baseUrl_key" ON "VectorBackend"("baseUrl");
CREATE INDEX "VectorBackend_state_updatedAt_idx" ON "VectorBackend"("state", "updatedAt");
