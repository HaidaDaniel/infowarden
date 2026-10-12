#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=lib/common.sh
source scripts/smoke/lib/common.sh

load_env_file ".env"
load_env_file ".env.smoke"

API_URL="${API_URL:-http://localhost:3000}"
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
QDRANT_READY_PATH="${QDRANT_READY_PATH:-/collections}"
SMOKE_EMBEDDING_PORT="${SMOKE_EMBEDDING_PORT:-8080}"
SMOKE_EMBEDDING_MODEL="${SMOKE_EMBEDDING_MODEL:-BAAI/bge-small-en-v1.5}"
SMOKE_EMBEDDING_API_KEY="${SMOKE_EMBEDDING_API_KEY:-local-smoke-key}"
SMOKE_RERANKER_PORT="${SMOKE_RERANKER_PORT:-8081}"
SMOKE_RERANKER_MODEL="${SMOKE_RERANKER_MODEL:-cross-encoder/ms-marco-MiniLM-L6-v2}"
SMOKE_USE_EXTERNAL_PROVIDER="${SMOKE_USE_EXTERNAL_PROVIDER:-0}"
SMOKE_EMBEDDING_HEALTH_URL="${SMOKE_EMBEDDING_HEALTH_URL:-http://localhost:${SMOKE_EMBEDDING_PORT}/health}"
SMOKE_RERANKER_HEALTH_URL="${SMOKE_RERANKER_HEALTH_URL:-http://localhost:${SMOKE_RERANKER_PORT}/health}"
SAMPLE_SOURCE_PATH="${SAMPLE_SOURCE_PATH:-$ROOT_DIR/test-fixtures/sample-docs}"
POLL_SECONDS="${POLL_SECONDS:-180}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-3}"
API_LOG="${API_LOG:-.smoke-api.log}"
MCP_HTTP_LOG="${MCP_HTTP_LOG:-.smoke-mcp-http.log}"
RUN_INTENTIONAL_EMBEDDING_FAILURE="${RUN_INTENTIONAL_EMBEDDING_FAILURE:-1}"
SOURCE_TRIGGER_WEBHOOK_SECRET="${SOURCE_TRIGGER_WEBHOOK_SECRET:-smoke-webhook-secret}"
SMOKE_CASES="${SMOKE_CASES:-core,indexing,retrieval,memory,export,mcp}"
SMOKE_URL_PORT="${SMOKE_URL_PORT:-3199}"
if [[ -z "${URL_SOURCE_ALLOW_PRIVATE_NETWORKS:-}" ]]; then
  case ",${SMOKE_CASES// /}," in
    *,url,*|*,refresh,*|*,restore,*|*,pre-llm-reliability,*)
      URL_SOURCE_ALLOW_PRIVATE_NETWORKS=true
      URL_SOURCE_ALLOWED_PORTS="${URL_SOURCE_ALLOWED_PORTS:-80,443,$SMOKE_URL_PORT}"
      ;;
    *)
      URL_SOURCE_ALLOW_PRIVATE_NETWORKS=false
      ;;
  esac
fi

if [[ "$SMOKE_USE_EXTERNAL_PROVIDER" != "1" ]]; then
  EMBEDDING_BASE_URL="http://localhost:${SMOKE_EMBEDDING_PORT}/v1"
  EMBEDDING_MODEL="$SMOKE_EMBEDDING_MODEL"
  EMBEDDING_DIMENSION=384
  EMBEDDING_TIMEOUT_MS="${EMBEDDING_TIMEOUT_MS:-60000}"
  EMBEDDING_API_KEY="$SMOKE_EMBEDDING_API_KEY"
fi

RERANKER_BASE_URL="${RERANKER_BASE_URL:-http://localhost:${SMOKE_RERANKER_PORT}}"
RERANKER_MODEL="${RERANKER_MODEL:-$SMOKE_RERANKER_MODEL}"
RERANKER_TOP_N="${RERANKER_TOP_N:-3}"
RERANKER_TIMEOUT_MS="${RERANKER_TIMEOUT_MS:-60000}"
RERANKER_FALLBACK_ALLOWED="${RERANKER_FALLBACK_ALLOWED:-true}"

export API_URL
export QDRANT_URL
export QDRANT_READY_PATH
export SAMPLE_SOURCE_PATH
export POLL_SECONDS
export POLL_INTERVAL_SECONDS
export API_LOG
export MCP_HTTP_LOG
export RUN_INTENTIONAL_EMBEDDING_FAILURE
export SOURCE_TRIGGER_WEBHOOK_SECRET
export SMOKE_EMBEDDING_PORT
export SMOKE_EMBEDDING_MODEL
export SMOKE_EMBEDDING_API_KEY
export SMOKE_RERANKER_PORT
export SMOKE_RERANKER_MODEL
export SMOKE_URL_PORT
export SMOKE_RERANKER_HEALTH_URL
export SMOKE_USE_EXTERNAL_PROVIDER
export SMOKE_EMBEDDING_HEALTH_URL
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
export URL_SOURCE_ALLOW_PRIVATE_NETWORKS
export URL_SOURCE_ALLOWED_PORTS

trap smoke_cleanup EXIT

for case_file in scripts/smoke/cases/*.sh; do
  # shellcheck source=/dev/null
  source "$case_file"
done

IFS=',' read -ra selected_cases <<<"$SMOKE_CASES"
declare -A requested_cases=()
for selected_case in "${selected_cases[@]}"; do
  selected_case="$(echo "$selected_case" | xargs)"
  [[ -z "$selected_case" ]] && continue
  requested_cases["$selected_case"]=1
done

for core_dependent_case in indexing retrieval resources memory export mcp git documents url refresh truth-refresh restore providers eval reranker multi-source-topology; do
  if [[ -n "${requested_cases[$core_dependent_case]:-}" && -z "${requested_cases[core]:-}" ]]; then
    requested_cases["core"]=1
    break
  fi
done

ordered_cases=(
  core
  indexing
  retrieval
  resources
  memory
  export
  mcp
  git
  documents
  url
  refresh
  truth-refresh
  restore
  providers
  eval
  reranker
  multi-source-topology
)

declare -A emitted_cases=()
for ordered_case in "${ordered_cases[@]}"; do
  if [[ -n "${requested_cases[$ordered_case]:-}" ]]; then
    run_case "$ordered_case"
    emitted_cases["$ordered_case"]=1
  fi
done

for selected_case in "${selected_cases[@]}"; do
  selected_case="$(echo "$selected_case" | xargs)"
  [[ -z "$selected_case" ]] && continue
  [[ -n "${emitted_cases[$selected_case]:-}" ]] && continue
  run_case "$selected_case"
done

cleanup_smoke_workspaces

smoke_section "Live Ubuntu smoke test passed"
