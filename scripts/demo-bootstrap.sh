#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }
}

require_cmd docker
require_cmd node
require_cmd pnpm
require_cmd curl
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is unavailable; start Docker and retry" >&2; exit 1; }

DEMO_RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$"
DEMO_PROJECT="infowarden-demo-$DEMO_RUN_ID"
DEMO_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/infowarden-demo.XXXXXX")"
DEMO_COMPOSE_FILE="$DEMO_ROOT/compose.yml"
DEMO_API_PORT="${DEMO_API_PORT:-3200}"
DEMO_STUDIO_PORT="${DEMO_STUDIO_PORT:-5174}"
DEMO_POSTGRES_PORT="${DEMO_POSTGRES_PORT:-55432}"
DEMO_REDIS_PORT="${DEMO_REDIS_PORT:-56379}"
DEMO_QDRANT_PORT="${DEMO_QDRANT_PORT:-56333}"
DEMO_QDRANT_GRPC_PORT="${DEMO_QDRANT_GRPC_PORT:-56334}"
DEMO_EMBEDDING_PORT="${DEMO_EMBEDDING_PORT:-58080}"
DEMO_MCP_PORT="${DEMO_MCP_PORT:-53003}"
DEMO_POSTGRES_PASSWORD="${DEMO_POSTGRES_PASSWORD:-infowarden_demo_password}"
DEMO_MCP_KEY="${DEMO_MCP_KEY:-infowarden-demo-mcp-key}"
DEMO_API_LOG="$DEMO_ROOT/api.log"
DEMO_MCP_LOG="$DEMO_ROOT/mcp.log"
DEMO_STUDIO_LOG="$DEMO_ROOT/studio.log"
DEMO_KEEP_SERVICES="${DEMO_KEEP_SERVICES:-0}"
DEMO_CLEAN_STATE="${DEMO_CLEAN_STATE:-0}"
DEMO_API_PID=""
DEMO_MCP_PID=""
DEMO_STUDIO_PID=""

port_is_free() {
  node - "$1" <<'NODE'
const net = require('node:net');
const port = Number(process.argv[2]);
const server = net.createServer();
server.once('error', () => process.exit(1));
server.listen(port, '127.0.0.1', () => server.close(() => process.exit(0)));
NODE
}

for port in "$DEMO_API_PORT" "$DEMO_STUDIO_PORT" "$DEMO_POSTGRES_PORT" "$DEMO_REDIS_PORT" "$DEMO_QDRANT_PORT" "$DEMO_QDRANT_GRPC_PORT" "$DEMO_EMBEDDING_PORT" "$DEMO_MCP_PORT"; do
  if ! port_is_free "$port"; then
    echo "demo port is busy: $port; choose another DEMO_*_PORT" >&2
    exit 1
  fi
done

cat >"$DEMO_COMPOSE_FILE" <<EOF
services:
  postgres:
    image: postgres:16.4-alpine
    environment:
      POSTGRES_USER: infowarden_demo
      POSTGRES_PASSWORD: ${DEMO_POSTGRES_PASSWORD}
      POSTGRES_DB: infowarden_demo
    ports:
      - "127.0.0.1:${DEMO_POSTGRES_PORT}:5432"
    volumes:
      - demo_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U infowarden_demo -d infowarden_demo"]
      interval: 2s
      timeout: 5s
      retries: 30
  redis:
    image: redis:7.2-alpine
    ports:
      - "127.0.0.1:${DEMO_REDIS_PORT}:6379"
    volumes:
      - demo_redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 5s
      retries: 30
  qdrant:
    image: qdrant/qdrant:v1.17.0
    ports:
      - "127.0.0.1:${DEMO_QDRANT_PORT}:6333"
      - "127.0.0.1:${DEMO_QDRANT_GRPC_PORT}:6334"
    volumes:
      - demo_qdrant_data:/qdrant/storage
  embeddings:
    image: ghcr.io/huggingface/text-embeddings-inference:cpu-1.9
    command:
      - --model-id
      - BAAI/bge-small-en-v1.5
      - --hostname
      - 0.0.0.0
      - --port
      - "80"
      - --api-key
      - local-demo-key
    ports:
      - "127.0.0.1:${DEMO_EMBEDDING_PORT}:80"
    volumes:
      - demo_embedding_cache:/data
volumes:
  demo_postgres_data:
  demo_redis_data:
  demo_qdrant_data:
  demo_embedding_cache:
EOF

compose() { docker compose --project-name "$DEMO_PROJECT" --file "$DEMO_COMPOSE_FILE" "$@"; }

wait_for() {
  local label="$1" timeout_seconds="$2" deadline
  shift 2
  deadline=$((SECONDS + timeout_seconds))
  until "$@" >/dev/null 2>&1; do
    (( SECONDS >= deadline )) && { echo "$label did not become ready within ${timeout_seconds}s" >&2; return 1; }
    sleep 2
  done
}

cleanup() {
  local status=$?
  set +e
  if [[ "$status" != "0" ]]; then
    echo "demo failed; recent service logs:" >&2
    compose logs --tail=80 >&2
    tail -n 80 "$DEMO_API_LOG" >&2 2>/dev/null || true
    tail -n 40 "$DEMO_MCP_LOG" >&2 2>/dev/null || true
  fi
  for pid in "$DEMO_STUDIO_PID" "$DEMO_MCP_PID" "$DEMO_API_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
  if [[ "$DEMO_KEEP_SERVICES" == "1" && "$status" == "0" && "$DEMO_CLEAN_STATE" != "1" ]]; then
    echo "Demo services retained under Compose project $DEMO_PROJECT"
    echo "Demo data directory retained at $DEMO_ROOT"
  else
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$DEMO_ROOT"
    [[ "$status" == "0" ]] && echo "Demo teardown: removed only project $DEMO_PROJECT and its temporary data"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

echo "== Building API, MCP, and Studio"
pnpm build
echo "== Starting isolated local CPU services"
compose up -d
wait_for PostgreSQL 90 compose exec -T postgres pg_isready -U infowarden_demo -d infowarden_demo
wait_for Redis 90 compose exec -T redis redis-cli ping
wait_for Qdrant 90 curl -fsS "http://127.0.0.1:${DEMO_QDRANT_PORT}/collections"
wait_for "CPU embedding provider" 300 curl -fsS "http://127.0.0.1:${DEMO_EMBEDDING_PORT}/health"

export DATABASE_URL="postgresql://infowarden_demo:${DEMO_POSTGRES_PASSWORD}@127.0.0.1:${DEMO_POSTGRES_PORT}/infowarden_demo?schema=public"
export REDIS_HOST=127.0.0.1 REDIS_PORT="$DEMO_REDIS_PORT"
export QDRANT_HOST=127.0.0.1 QDRANT_PORT="$DEMO_QDRANT_PORT" QDRANT_GRPC_PORT="$DEMO_QDRANT_GRPC_PORT"
export QDRANT_HTTP_URL="http://127.0.0.1:${DEMO_QDRANT_PORT}"
export EMBEDDING_BASE_URL="http://127.0.0.1:${DEMO_EMBEDDING_PORT}/v1" EMBEDDING_MODEL=BAAI/bge-small-en-v1.5 EMBEDDING_DIMENSION=384 EMBEDDING_API_KEY=local-demo-key
export API_KEY_AUTH_ENABLED=false ADMIN_API_KEY='' MANAGED_UPLOAD_STORAGE_DIR="$DEMO_ROOT/uploads" CORS_ORIGIN='*' NODE_ENV=development PORT="$DEMO_API_PORT"
export CONTEXTFORGE_BACKEND_URL="http://127.0.0.1:${DEMO_API_PORT}" CONTEXTFORGE_API_KEY=''
export MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PORT="$DEMO_MCP_PORT" MCP_HTTP_PATH=/mcp MCP_PROFILE=read MCP_AUTH_ENABLED=true
export DEMO_API_URL="http://127.0.0.1:${DEMO_API_PORT}" DEMO_MCP_URL="http://127.0.0.1:${DEMO_MCP_PORT}/mcp" DEMO_MCP_KEY DEMO_FIXTURE_ROOT="$REPO_ROOT/fixtures/demo" DEMO_TIMEOUT_SECONDS="${DEMO_TIMEOUT_SECONDS:-240}" QDRANT_HTTP_URL

echo "== Applying isolated Prisma schema"
pnpm prisma:generate
pnpm prisma:deploy
echo "== Starting API"
env DATABASE_URL="$DATABASE_URL" REDIS_HOST="$REDIS_HOST" REDIS_PORT="$REDIS_PORT" QDRANT_HOST="$QDRANT_HOST" QDRANT_PORT="$QDRANT_PORT" QDRANT_GRPC_PORT="$QDRANT_GRPC_PORT" QDRANT_HTTP_URL="$QDRANT_HTTP_URL" EMBEDDING_BASE_URL="$EMBEDDING_BASE_URL" EMBEDDING_MODEL="$EMBEDDING_MODEL" EMBEDDING_DIMENSION="$EMBEDDING_DIMENSION" EMBEDDING_API_KEY="$EMBEDDING_API_KEY" API_KEY_AUTH_ENABLED=false ADMIN_API_KEY='' MANAGED_UPLOAD_STORAGE_DIR="$MANAGED_UPLOAD_STORAGE_DIR" CORS_ORIGIN='*' NODE_ENV=development PORT="$DEMO_API_PORT" pnpm --filter api start >"$DEMO_API_LOG" 2>&1 &
DEMO_API_PID=$!
wait_for "InfoWarden API" 90 curl -fsS "http://127.0.0.1:${DEMO_API_PORT}/health"

echo "== Starting read-only MCP HTTP adapter"
env CONTEXTFORGE_BACKEND_URL="$CONTEXTFORGE_BACKEND_URL" CONTEXTFORGE_API_KEY='' MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PORT="$DEMO_MCP_PORT" MCP_HTTP_PATH=/mcp MCP_PROFILE=read MCP_AUTH_ENABLED=true ADMIN_API_KEY="$DEMO_MCP_KEY" node apps/mcp-server/dist/index.js --http >"$DEMO_MCP_LOG" 2>&1 &
DEMO_MCP_PID=$!
wait_for "MCP HTTP adapter" 60 bash -c "curl -sS -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer $DEMO_MCP_KEY' '$DEMO_MCP_URL' | grep -Eq '200|400|405'"

echo "== Starting Studio"
env VITE_API_BASE_URL="$DEMO_API_URL" VITE_API_PROXY_TARGET="$DEMO_API_URL" pnpm --filter web dev --host 127.0.0.1 --port "$DEMO_STUDIO_PORT" >"$DEMO_STUDIO_LOG" 2>&1 &
DEMO_STUDIO_PID=$!
wait_for "InfoWarden Studio" 60 curl -fsS "http://127.0.0.1:${DEMO_STUDIO_PORT}"

echo "== Running bounded workspace, retrieval, refresh, and MCP demo"
node scripts/demo-bootstrap.mjs
echo
echo "Demo completed successfully"
echo "Studio: http://127.0.0.1:${DEMO_STUDIO_PORT}"
echo "API: http://127.0.0.1:${DEMO_API_PORT}/api/docs"
echo "Embedding: BAAI/bge-small-en-v1.5 (384 dimensions, local CPU)"
echo "Qdrant: rebuildable serving state only; canonical truth was PostgreSQL plus fixture files"
echo "Teardown: scoped cleanup runs automatically"
