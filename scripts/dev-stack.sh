#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dev-common.sh
source "$SCRIPT_DIR/dev-common.sh"

require_cmd curl
require_cmd node
require_cmd pnpm
require_docker_compose
ensure_repo_root
load_repo_env

QDRANT_READY_URL="${QDRANT_HTTP_URL:-http://localhost:6333}/collections"
DEV_USE_EXTERNAL_PROVIDER="${DEV_USE_EXTERNAL_PROVIDER:-0}"
if [[ "$DEV_USE_EXTERNAL_PROVIDER" == "1" ]]; then
  DEV_LOCAL_MODEL_DEFAULT=0
else
  DEV_LOCAL_MODEL_DEFAULT=1
fi
DEV_START_LOCAL_EMBEDDINGS="${DEV_START_LOCAL_EMBEDDINGS:-$DEV_LOCAL_MODEL_DEFAULT}"
DEV_START_LOCAL_RERANKER="${DEV_START_LOCAL_RERANKER:-$DEV_LOCAL_MODEL_DEFAULT}"
DEV_REGISTER_LOCAL_PROVIDERS="${DEV_REGISTER_LOCAL_PROVIDERS:-$DEV_LOCAL_MODEL_DEFAULT}"
DEV_REGISTER_EXTERNAL_PROVIDERS="${DEV_REGISTER_EXTERNAL_PROVIDERS:-0}"
DEV_PRUNE_LOCAL_PROVIDER_CONFIGS="${DEV_PRUNE_LOCAL_PROVIDER_CONFIGS:-$([[ "$DEV_LOCAL_MODEL_DEFAULT" == "0" ]] && echo 1 || echo 0)}"
DEV_EMBEDDING_PROVIDER_NAME="${DEV_EMBEDDING_PROVIDER_NAME:-local-dev-embeddings}"
DEV_RERANKER_PROVIDER_NAME="${DEV_RERANKER_PROVIDER_NAME:-local-cpu-reranker}"
SMOKE_EMBEDDING_PORT="${SMOKE_EMBEDDING_PORT:-8080}"
SMOKE_EMBEDDING_MODEL="${SMOKE_EMBEDDING_MODEL:-BAAI/bge-small-en-v1.5}"
SMOKE_EMBEDDING_API_KEY="${SMOKE_EMBEDDING_API_KEY:-local-smoke-key}"
SMOKE_RERANKER_PORT="${SMOKE_RERANKER_PORT:-8081}"
SMOKE_RERANKER_MODEL="${SMOKE_RERANKER_MODEL:-cross-encoder/ms-marco-MiniLM-L6-v2}"
SMOKE_EMBEDDING_HEALTH_URL="${SMOKE_EMBEDDING_HEALTH_URL:-http://localhost:${SMOKE_EMBEDDING_PORT}/health}"
SMOKE_RERANKER_HEALTH_URL="${SMOKE_RERANKER_HEALTH_URL:-http://localhost:${SMOKE_RERANKER_PORT}/health}"
DEV_START_WEB="${DEV_START_WEB:-1}"
DEV_STUDIO_DIRECT_API="${DEV_STUDIO_DIRECT_API:-0}"
WEB_HOST="${WEB_HOST:-127.0.0.1}"
WEB_PORT="${WEB_PORT:-5173}"

COMPOSE_ARGS=(-f docker-compose.yml -f docker-compose.smoke.yml --profile reranker)
DEV_COMPOSE_SERVICES=(postgres redis qdrant)
if [[ "$DEV_START_LOCAL_EMBEDDINGS" == "1" ]]; then
  DEV_COMPOSE_SERVICES+=(smoke-embeddings)
fi
if [[ "$DEV_START_LOCAL_RERANKER" == "1" ]]; then
  DEV_COMPOSE_SERVICES+=(smoke-reranker)
fi

if [[ "$DEV_USE_EXTERNAL_PROVIDER" != "1" && "$DEV_START_LOCAL_EMBEDDINGS" == "1" ]]; then
  EMBEDDING_BASE_URL="http://localhost:${SMOKE_EMBEDDING_PORT}/v1"
  EMBEDDING_MODEL="$SMOKE_EMBEDDING_MODEL"
  EMBEDDING_DIMENSION=384
  EMBEDDING_TIMEOUT_MS="${EMBEDDING_TIMEOUT_MS:-60000}"
  EMBEDDING_API_KEY="$SMOKE_EMBEDDING_API_KEY"
fi

if [[ "$DEV_START_LOCAL_RERANKER" == "1" ]]; then
  RERANKER_BASE_URL="${RERANKER_BASE_URL:-http://localhost:${SMOKE_RERANKER_PORT}}"
  RERANKER_MODEL="${RERANKER_MODEL:-$SMOKE_RERANKER_MODEL}"
  RERANKER_TOP_N="${RERANKER_TOP_N:-3}"
  RERANKER_TIMEOUT_MS="${RERANKER_TIMEOUT_MS:-60000}"
  RERANKER_FALLBACK_ALLOWED="${RERANKER_FALLBACK_ALLOWED:-true}"
else
  RERANKER_BASE_URL="${RERANKER_BASE_URL:-}"
  RERANKER_MODEL="${RERANKER_MODEL:-}"
  RERANKER_TOP_N="${RERANKER_TOP_N:-3}"
  RERANKER_TIMEOUT_MS="${RERANKER_TIMEOUT_MS:-60000}"
  RERANKER_FALLBACK_ALLOWED="${RERANKER_FALLBACK_ALLOWED:-true}"
fi

export DEV_USE_EXTERNAL_PROVIDER
export DEV_START_LOCAL_EMBEDDINGS
export DEV_START_LOCAL_RERANKER
export DEV_REGISTER_LOCAL_PROVIDERS
export DEV_REGISTER_EXTERNAL_PROVIDERS
export DEV_PRUNE_LOCAL_PROVIDER_CONFIGS
export DEV_EMBEDDING_PROVIDER_NAME
export DEV_RERANKER_PROVIDER_NAME
export SMOKE_EMBEDDING_PORT
export SMOKE_EMBEDDING_MODEL
export SMOKE_EMBEDDING_API_KEY
export SMOKE_RERANKER_PORT
export SMOKE_RERANKER_MODEL
export EMBEDDING_BASE_URL
export EMBEDDING_MODEL
export EMBEDDING_DIMENSION
export EMBEDDING_TIMEOUT_MS
export EMBEDDING_API_KEY
export RERANKER_BASE_URL
export RERANKER_MODEL
export RERANKER_TOP_N
export RERANKER_TIMEOUT_MS
export RERANKER_FALLBACK_ALLOWED
export DEV_START_WEB
export DEV_STUDIO_DIRECT_API
export WEB_HOST
export WEB_PORT

declare -a DEV_REQUIRED_PORTS=()
add_dev_port() {
  local port="$1"
  if [[ -n "$port" && "$port" =~ ^[0-9]+$ ]]; then
    DEV_REQUIRED_PORTS+=("$port")
  fi
}

if is_local_host "$(url_hostname "${DATABASE_URL:-}")"; then
  add_dev_port "$(url_port "${DATABASE_URL:-}" 5432)"
fi
if is_local_host "${REDIS_HOST:-localhost}"; then
  add_dev_port "${REDIS_PORT:-6379}"
fi
if is_local_host "${QDRANT_HOST:-localhost}"; then
  add_dev_port "${QDRANT_PORT:-6333}"
  add_dev_port "${QDRANT_GRPC_PORT:-6334}"
fi
if [[ "$DEV_START_LOCAL_EMBEDDINGS" == "1" ]]; then
  add_dev_port "$SMOKE_EMBEDDING_PORT"
fi
if [[ "$DEV_START_LOCAL_RERANKER" == "1" ]]; then
  add_dev_port "$SMOKE_RERANKER_PORT"
fi
add_dev_port "${PORT:-3000}"
if [[ "$DEV_START_WEB" != "0" ]]; then
  add_dev_port "$WEB_PORT"
fi

echo "== Stopping stale ContextForge dev containers"
docker compose "${COMPOSE_ARGS[@]}" down --remove-orphans >/dev/null 2>&1 || true

free_dev_ports "${DEV_REQUIRED_PORTS[@]}"

echo "== Starting local dependencies"
docker compose "${COMPOSE_ARGS[@]}" up -d --force-recreate "${DEV_COMPOSE_SERVICES[@]}"

echo "== Waiting for PostgreSQL"
wait_for_container_health "context-forge-postgres" "PostgreSQL"

echo "== Waiting for Redis"
wait_for_container_health "context-forge-redis" "Redis"

echo "== Waiting for Qdrant"
wait_for_http_ok "$QDRANT_READY_URL" "Qdrant"

if [[ "$DEV_START_LOCAL_EMBEDDINGS" == "1" ]]; then
  echo "== Waiting for local TEI embeddings"
  wait_for_http_ok "$SMOKE_EMBEDDING_HEALTH_URL" "TEI embeddings" 180
fi

if [[ "$DEV_START_LOCAL_RERANKER" == "1" ]]; then
  echo "== Waiting for local TEI reranker"
  wait_for_http_ok "$SMOKE_RERANKER_HEALTH_URL" "TEI reranker" 240
fi

echo "== Applying Prisma client and migrations"
pnpm prisma:generate
pnpm prisma:deploy

if [[ "$DEV_REGISTER_LOCAL_PROVIDERS" != "0" || "$DEV_REGISTER_EXTERNAL_PROVIDERS" == "1" ]]; then
  echo "== Registering dev model provider configs"
  node <<'NODE'
const { PrismaClient, ProviderType } = require('@prisma/client');

const prisma = new PrismaClient();

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringFromEnv(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

async function upsertProvider(type, name, data) {
  const existing = await prisma.providerConfig.findFirst({ where: { type, name } });
  if (existing) {
    return prisma.providerConfig.update({ where: { id: existing.id }, data });
  }
  return prisma.providerConfig.create({ data: { type, name, ...data } });
}

async function selectOnlyDefaultProvider(type, name) {
  const providers = await prisma.providerConfig.findMany({ where: { type } });
  await Promise.all(
    providers.map((provider) => {
      const metadata =
        provider.metadata && typeof provider.metadata === 'object' && !Array.isArray(provider.metadata)
          ? provider.metadata
          : {};
      const isDefault = provider.name === name;
      if (metadata.default === isDefault) {
        return Promise.resolve();
      }
      return prisma.providerConfig.update({
        where: { id: provider.id },
        data: { metadata: { ...metadata, default: isDefault } },
      });
    }),
  );
}

async function main() {
  const shouldRegisterEmbedding =
    process.env.DEV_USE_EXTERNAL_PROVIDER !== '1' ||
    process.env.DEV_REGISTER_EXTERNAL_PROVIDERS === '1';
  const shouldRegisterReranker =
    process.env.DEV_START_LOCAL_RERANKER === '1' ||
    (process.env.DEV_USE_EXTERNAL_PROVIDER === '1' &&
      Boolean(process.env.RERANKER_BASE_URL) &&
      Boolean(process.env.RERANKER_MODEL));
  const embeddingProviderName = stringFromEnv('DEV_EMBEDDING_PROVIDER_NAME', 'local-dev-embeddings');
  const rerankerProviderName = stringFromEnv('DEV_RERANKER_PROVIDER_NAME', 'local-cpu-reranker');

  if (shouldRegisterEmbedding) {
    await upsertProvider(ProviderType.embedding, embeddingProviderName, {
      baseUrl: process.env.EMBEDDING_BASE_URL || 'http://localhost:8080/v1',
      model: process.env.EMBEDDING_MODEL || 'BAAI/bge-small-en-v1.5',
      apiKeyRef: 'EMBEDDING_API_KEY',
      metadata: {
        protocol: 'openai_compatible',
        default: true,
        defaultIndexProfile: 'default',
        embeddingDimension: numberFromEnv('EMBEDDING_DIMENSION', 384),
        maxInputTokens: numberFromEnv('EMBEDDING_MAX_INPUT_TOKENS', 8192),
        timeoutMs: numberFromEnv('EMBEDDING_TIMEOUT_MS', 60000),
        devExternal: process.env.DEV_USE_EXTERNAL_PROVIDER === '1',
      },
    });
  }

  if (process.env.DEV_SAVED_EMBEDDING_PROVIDER_NAME && process.env.DEV_SAVED_EMBEDDING_MODEL) {
    await upsertProvider(ProviderType.embedding, process.env.DEV_SAVED_EMBEDDING_PROVIDER_NAME, {
      baseUrl: process.env.DEV_SAVED_EMBEDDING_BASE_URL || process.env.EMBEDDING_BASE_URL || 'http://localhost:8080/v1',
      model: process.env.DEV_SAVED_EMBEDDING_MODEL,
      apiKeyRef: 'EMBEDDING_API_KEY',
      metadata: {
        protocol: 'openai_compatible',
        default: false,
        embeddingDimension: numberFromEnv('DEV_SAVED_EMBEDDING_DIMENSION', 384),
        maxInputTokens: numberFromEnv('DEV_SAVED_EMBEDDING_MAX_INPUT_TOKENS', 8192),
        timeoutMs: numberFromEnv('EMBEDDING_TIMEOUT_MS', 60000),
        devExternal: true,
        savedProfile: true,
      },
    });
  }

  if (shouldRegisterEmbedding) {
    await selectOnlyDefaultProvider(ProviderType.embedding, embeddingProviderName);
  }

  if (shouldRegisterReranker) {
    await upsertProvider(ProviderType.reranker, rerankerProviderName, {
      baseUrl: process.env.RERANKER_BASE_URL || 'http://localhost:8081',
      model: process.env.RERANKER_MODEL || 'cross-encoder/ms-marco-MiniLM-L6-v2',
      apiKeyRef: null,
      metadata: {
        default: true,
        maxCandidates: numberFromEnv('RERANKER_TOP_N', 3),
        maxInputTokens: numberFromEnv('RERANKER_MAX_INPUT_TOKENS', 2048),
        timeoutMs: numberFromEnv('RERANKER_TIMEOUT_MS', 60000),
        fallbackAllowed: process.env.RERANKER_FALLBACK_ALLOWED !== 'false',
        devDefault: true,
        devExternal: process.env.DEV_USE_EXTERNAL_PROVIDER === '1',
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
NODE
fi

if [[ "$DEV_PRUNE_LOCAL_PROVIDER_CONFIGS" == "1" ]]; then
  echo "== Removing local dev model provider configs"
  node <<'NODE'
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.providerConfig.deleteMany({
    where: {
      name: {
        in: ['local-dev-embeddings', 'local-cpu-reranker'],
      },
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
NODE
fi

API_PID=""
WEB_PID=""

cleanup_dev_processes() {
  local exit_code=$?
  trap - EXIT INT TERM
  for pid in "$API_PID" "$WEB_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  for pid in "$API_PID" "$WEB_PID"; do
    if [[ -n "$pid" ]]; then
      wait "$pid" >/dev/null 2>&1 || true
    fi
  done
  exit "$exit_code"
}

trap cleanup_dev_processes EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$DEV_START_WEB" != "0" ]]; then
  echo "== Starting Studio"
  STUDIO_API_BASE_URL=""
  if [[ "$DEV_STUDIO_DIRECT_API" == "1" ]]; then
    STUDIO_API_BASE_URL="${VITE_API_BASE_URL:-http://localhost:${PORT:-3000}}"
  fi
  VITE_API_BASE_URL="$STUDIO_API_BASE_URL" \
    VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-http://localhost:${PORT:-3000}}" \
    pnpm --filter web dev --host "$WEB_HOST" --port "$WEB_PORT" &
  WEB_PID=$!
  echo "== Studio: http://${WEB_HOST}:${WEB_PORT}"
fi

echo "== Starting API"
bash "$SCRIPT_DIR/dev-api.sh" "$@" &
API_PID=$!
echo "== API: http://localhost:${PORT:-3000}"

set +e
if [[ -n "$WEB_PID" ]]; then
  wait -n "$API_PID" "$WEB_PID"
  DEV_EXIT_CODE=$?
else
  wait "$API_PID"
  DEV_EXIT_CODE=$?
fi
set -e

exit "$DEV_EXIT_CODE"
