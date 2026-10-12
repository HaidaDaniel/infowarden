#!/usr/bin/env bash

smoke_case_core() {
  smoke_section "Checking required commands"
  require_cmd docker
  require_cmd curl
  require_cmd node
  require_cmd pnpm

  if [[ ! -d "$SAMPLE_SOURCE_PATH" ]]; then
    smoke_fail "sample source path does not exist: $SAMPLE_SOURCE_PATH"
  fi

  smoke_section "Starting dependencies"
  if [[ "${SMOKE_CLEAN_STATE:-0}" == "1" ]]; then
    start_clean_state_dependencies
  elif ! docker compose -f docker-compose.yml -f docker-compose.smoke.yml up -d; then
    smoke_note "default compose ports are unavailable; starting smoke PostgreSQL/Redis on fallback ports"
    docker compose -f docker-compose.yml -f docker-compose.smoke.yml up -d qdrant smoke-embeddings
    start_fallback_postgres_redis
  elif ! compose_database_ports_are_published; then
    smoke_note "compose PostgreSQL/Redis are not published on host ports; using fallback ports"
    start_fallback_postgres_redis
  else
    wait_for_compose_postgres_redis
  fi
  docker compose -f docker-compose.yml -f docker-compose.smoke.yml ps || true

  smoke_section "Waiting for local TEI embedding service"
  wait_for_url "$SMOKE_EMBEDDING_HEALTH_URL" "TEI embedding service" 180

  smoke_section "Applying Prisma migrations"
  pnpm prisma:generate
  pnpm prisma:deploy

  smoke_section "Building and testing API/MCP packages"
  pnpm --filter api build
  pnpm --filter api test
  pnpm --filter mcp-server build
  pnpm --filter mcp-server test

  start_main_api

  smoke_section "Checking dependency health"
  curl -fsS "$API_URL/health/full"
  echo
  curl -fsS "$API_URL/health/embeddings"
  echo
  curl -fsS "$QDRANT_URL$QDRANT_READY_PATH"
  echo

  smoke_section "Refreshing vector backend health"
  local vector_backend_health
  vector_backend_health="$(post_json "/vector-backends/health/refresh" '{}')"
  VECTOR_BACKEND_HEALTH="$vector_backend_health" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_BACKEND_HEALTH);
const items = Array.isArray(response) ? response : [];
if (!items.some((backend) => backend.name === 'default-qdrant' && backend.healthMetadata?.healthy === true && backend.healthMetadata?.compatible === true)) {
  console.error('default-qdrant did not become healthy/compatible');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  if [[ "$RUN_INTENTIONAL_EMBEDDING_FAILURE" == "1" ]]; then
    smoke_section "Checking intentional embedding preflight failure sanitization"
    local bad_api_url="http://localhost:3099"
    local bad_api_log=".smoke-api-bad-embedding.log"
    PORT=3099 API_KEY_AUTH_ENABLED=false EMBEDDING_API_KEY="" pnpm --filter api start >"$bad_api_log" 2>&1 &
    SMOKE_BAD_API_PID=$!
    wait_for_api "$bad_api_url" "$bad_api_log"
    local bad_embedding_response
    bad_embedding_response="$(curl -fsS "$bad_api_url/health/embeddings")"
    BAD_EMBEDDING_RESPONSE="$bad_embedding_response" node <<'NODE'
const response = JSON.parse(process.env.BAD_EMBEDDING_RESPONSE);
if (response.status !== 'not_configured' || response.code !== 'embedding_api_key_missing') {
  console.error('unexpected embedding failure shape');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (JSON.stringify(response).match(/Bearer|sk-|token|authorization/i)) {
  console.error('embedding failure leaked a secret-like value');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
    stop_pid "$SMOKE_BAD_API_PID"
    SMOKE_BAD_API_PID=""
  fi

  SMOKE_CORE_READY=1
}

start_clean_state_dependencies() {
  local suffix="${SMOKE_CLEAN_SUFFIX:-$RANDOM-$$}"
  local postgres_port="${SMOKE_CLEAN_POSTGRES_PORT:-15432}"
  local redis_port="${SMOKE_CLEAN_REDIS_PORT:-16379}"
  local qdrant_port="${SMOKE_CLEAN_QDRANT_PORT:-16333}"
  local qdrant_grpc_port="${SMOKE_CLEAN_QDRANT_GRPC_PORT:-16334}"

  suffix="${suffix//[^a-zA-Z0-9_-]/-}"
  SMOKE_CLEAN_POSTGRES_CONTAINER="context-forge-smoke-postgres-$suffix"
  SMOKE_CLEAN_REDIS_CONTAINER="context-forge-smoke-redis-$suffix"
  SMOKE_CLEAN_QDRANT_CONTAINER="context-forge-smoke-qdrant-$suffix"

  docker rm -f "$SMOKE_CLEAN_POSTGRES_CONTAINER" "$SMOKE_CLEAN_REDIS_CONTAINER" "$SMOKE_CLEAN_QDRANT_CONTAINER" >/dev/null 2>&1 || true

  docker run -d --name "$SMOKE_CLEAN_POSTGRES_CONTAINER" \
    -e POSTGRES_USER=contextforge \
    -e POSTGRES_PASSWORD=contextforge_password \
    -e POSTGRES_DB=contextforge \
    -p "$postgres_port:5432" \
    postgres:16.4-alpine >/dev/null

  docker run -d --name "$SMOKE_CLEAN_REDIS_CONTAINER" \
    -p "$redis_port:6379" \
    redis:7.2-alpine >/dev/null

  docker run -d --name "$SMOKE_CLEAN_QDRANT_CONTAINER" \
    -p "$qdrant_port:6333" \
    -p "$qdrant_grpc_port:6334" \
    qdrant/qdrant:v1.17.0 >/dev/null

  docker compose -f docker-compose.yml -f docker-compose.smoke.yml up -d smoke-embeddings

  local deadline=$((SECONDS + 60))
  until docker exec "$SMOKE_CLEAN_POSTGRES_CONTAINER" pg_isready -U contextforge >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      smoke_fail "clean PostgreSQL did not become ready"
    fi
    sleep 2
  done

  deadline=$((SECONDS + 60))
  until docker exec "$SMOKE_CLEAN_REDIS_CONTAINER" redis-cli ping >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      smoke_fail "clean Redis did not become ready"
    fi
    sleep 2
  done

  DATABASE_URL="postgresql://contextforge:contextforge_password@localhost:${postgres_port}/contextforge?schema=public"
  REDIS_HOST="localhost"
  REDIS_PORT="$redis_port"
  QDRANT_HOST="localhost"
  QDRANT_PORT="$qdrant_port"
  QDRANT_HTTP_URL="http://localhost:${qdrant_port}"
  QDRANT_GRPC_PORT="$qdrant_grpc_port"
  QDRANT_URL="$QDRANT_HTTP_URL"
  VERIFY_SOURCE_POSTGRES_CONTAINER="$SMOKE_CLEAN_POSTGRES_CONTAINER"

  export DATABASE_URL
  export REDIS_HOST
  export REDIS_PORT
  export QDRANT_HOST
  export QDRANT_PORT
  export QDRANT_HTTP_URL
  export QDRANT_GRPC_PORT
  export QDRANT_URL
  export VERIFY_SOURCE_POSTGRES_CONTAINER

  wait_for_url "$QDRANT_URL$QDRANT_READY_PATH" "clean Qdrant" 90
}

compose_database_ports_are_published() {
  [[ -n "$(docker port context-forge-postgres 5432/tcp 2>/dev/null || true)" ]] &&
    [[ -n "$(docker port context-forge-redis 6379/tcp 2>/dev/null || true)" ]]
}

wait_for_compose_postgres_redis() {
  local deadline=$((SECONDS + 60))
  until docker exec context-forge-postgres pg_isready -U contextforge >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      smoke_fail "compose PostgreSQL did not become ready"
    fi
    sleep 2
  done

  deadline=$((SECONDS + 60))
  until docker exec context-forge-redis redis-cli ping >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      smoke_fail "compose Redis did not become ready"
    fi
    sleep 2
  done
}

start_fallback_postgres_redis() {
  local postgres_port="${SMOKE_POSTGRES_FALLBACK_PORT:-15432}"
  local redis_port="${SMOKE_REDIS_FALLBACK_PORT:-16379}"
  SMOKE_ALT_POSTGRES_CONTAINER="context-forge-postgres-smoke-alt"
  SMOKE_ALT_REDIS_CONTAINER="context-forge-redis-smoke-alt"

  docker rm -f "$SMOKE_ALT_POSTGRES_CONTAINER" "$SMOKE_ALT_REDIS_CONTAINER" >/dev/null 2>&1 || true

  docker run -d --name "$SMOKE_ALT_POSTGRES_CONTAINER" \
    -e POSTGRES_USER=contextforge \
    -e POSTGRES_PASSWORD=contextforge_password \
    -e POSTGRES_DB=contextforge \
    -p "$postgres_port:5432" \
    postgres:16-alpine >/dev/null

  docker run -d --name "$SMOKE_ALT_REDIS_CONTAINER" \
    -p "$redis_port:6379" \
    redis:7-alpine >/dev/null

  local deadline=$((SECONDS + 60))
  until docker exec "$SMOKE_ALT_POSTGRES_CONTAINER" pg_isready -U contextforge >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      smoke_fail "fallback PostgreSQL did not become ready"
    fi
    sleep 2
  done

  deadline=$((SECONDS + 60))
  until docker exec "$SMOKE_ALT_REDIS_CONTAINER" redis-cli ping >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      smoke_fail "fallback Redis did not become ready"
    fi
    sleep 2
  done

  DATABASE_URL="postgresql://contextforge:contextforge_password@localhost:${postgres_port}/contextforge?schema=public"
  REDIS_HOST="localhost"
  REDIS_PORT="$redis_port"
  export DATABASE_URL REDIS_HOST REDIS_PORT
}
