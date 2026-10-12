#!/usr/bin/env bash

SMOKE_API_PID="${SMOKE_API_PID:-}"
SMOKE_BAD_API_PID="${SMOKE_BAD_API_PID:-}"
SMOKE_AUTH_API_PID="${SMOKE_AUTH_API_PID:-}"
SMOKE_MCP_HTTP_PID="${SMOKE_MCP_HTTP_PID:-}"
SMOKE_KB_ID="${SMOKE_KB_ID:-}"
SMOKE_SOURCE_ID="${SMOKE_SOURCE_ID:-}"
SMOKE_JOB_ID="${SMOKE_JOB_ID:-}"
SMOKE_LAST_SEARCH_RESPONSE="${SMOKE_LAST_SEARCH_RESPONSE:-}"
SMOKE_LAST_JOB_DETAIL="${SMOKE_LAST_JOB_DETAIL:-}"
SMOKE_LAST_VECTOR_OPERATION_DETAIL="${SMOKE_LAST_VECTOR_OPERATION_DETAIL:-}"
SMOKE_CORE_READY="${SMOKE_CORE_READY:-0}"
SMOKE_GIT_TMP_DIR="${SMOKE_GIT_TMP_DIR:-}"
SMOKE_DOCS_TMP_DIR="${SMOKE_DOCS_TMP_DIR:-}"
SMOKE_URL_TMP_DIR="${SMOKE_URL_TMP_DIR:-}"
SMOKE_URL_SERVER_PID="${SMOKE_URL_SERVER_PID:-}"
SMOKE_URL_KB_ID="${SMOKE_URL_KB_ID:-}"
SMOKE_URL_SOURCE_ID="${SMOKE_URL_SOURCE_ID:-}"
SMOKE_URL_BASE="${SMOKE_URL_BASE:-}"
SMOKE_URL_SITE_DIR="${SMOKE_URL_SITE_DIR:-}"
SMOKE_TRUTH_TMP_DIR="${SMOKE_TRUTH_TMP_DIR:-}"
SMOKE_MULTI_SOURCE_TMP_DIR="${SMOKE_MULTI_SOURCE_TMP_DIR:-}"
SMOKE_ALT_POSTGRES_CONTAINER="${SMOKE_ALT_POSTGRES_CONTAINER:-}"
SMOKE_ALT_REDIS_CONTAINER="${SMOKE_ALT_REDIS_CONTAINER:-}"
SMOKE_CLEAN_POSTGRES_CONTAINER="${SMOKE_CLEAN_POSTGRES_CONTAINER:-}"
SMOKE_CLEAN_REDIS_CONTAINER="${SMOKE_CLEAN_REDIS_CONTAINER:-}"
SMOKE_CLEAN_QDRANT_CONTAINER="${SMOKE_CLEAN_QDRANT_CONTAINER:-}"
SMOKE_CLEAN_QDRANT_B_CONTAINER="${SMOKE_CLEAN_QDRANT_B_CONTAINER:-}"

smoke_section() {
  echo
  echo "== $*"
}

smoke_note() {
  echo "-- $*"
}

smoke_fail() {
  echo "smoke failed: $*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    smoke_fail "missing required command: $1"
  fi
}

load_env_file() {
  local path="$1"
  if [[ -f "$path" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$path"
    set +a
  fi
}

json_field() {
  printf '%s' "$1" | node -e "let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => input += c); process.stdin.on('end', () => { const data=JSON.parse(input); console.log(process.argv[1].split('.').reduce((v,k)=>v && v[k], data) ?? '') })" "$2"
}

assert_json() {
  local json="$1"
  local script="$2"
  JSON_INPUT="$json" node -e "$script"
}

api_headers() {
  if [[ "${API_KEY_AUTH_ENABLED:-false}" == "true" ]]; then
    local key="${CONTEXTFORGE_API_KEY:-${ADMIN_API_KEY:-}}"
    if [[ -n "$key" ]]; then
      printf '%s\n' "-H" "Authorization: Bearer $key"
    fi
  fi
}

get_json() {
  local path="$1"
  local response_file
  local headers=()
  while IFS= read -r header_arg; do
    [[ -n "$header_arg" ]] && headers+=("$header_arg")
  done < <(api_headers)
  response_file="$(mktemp)"
  if ! curl -sS --fail-with-body -o "$response_file" "${headers[@]}" "$API_URL$path"; then
    cat "$response_file" >&2 || true
    rm -f "$response_file"
    return 1
  fi
  cat "$response_file"
  rm -f "$response_file"
}

post_json() {
  local path="$1"
  local body="$2"
  local response_file
  local headers=()
  while IFS= read -r header_arg; do
    [[ -n "$header_arg" ]] && headers+=("$header_arg")
  done < <(api_headers)
  response_file="$(mktemp)"
  if ! curl -sS --fail-with-body -o "$response_file" -X POST "$API_URL$path" \
    -H "Content-Type: application/json" \
    "${headers[@]}" \
    --data-binary "$body"; then
    cat "$response_file" >&2 || true
    rm -f "$response_file"
    return 1
  fi
  cat "$response_file"
  rm -f "$response_file"
}

put_json() {
  local path="$1"
  local body="$2"
  local response_file
  local headers=()
  while IFS= read -r header_arg; do
    [[ -n "$header_arg" ]] && headers+=("$header_arg")
  done < <(api_headers)
  response_file="$(mktemp)"
  if ! curl -sS --fail-with-body -o "$response_file" -X PUT "$API_URL$path" \
    -H "Content-Type: application/json" \
    "${headers[@]}" \
    --data-binary "$body"; then
    cat "$response_file" >&2 || true
    rm -f "$response_file"
    return 1
  fi
  cat "$response_file"
  rm -f "$response_file"
}

patch_json() {
  local path="$1"
  local body="$2"
  local response_file
  local headers=()
  while IFS= read -r header_arg; do
    [[ -n "$header_arg" ]] && headers+=("$header_arg")
  done < <(api_headers)
  response_file="$(mktemp)"
  if ! curl -sS --fail-with-body -o "$response_file" -X PATCH "$API_URL$path" \
    -H "Content-Type: application/json" \
    "${headers[@]}" \
    --data-binary "$body"; then
    cat "$response_file" >&2 || true
    rm -f "$response_file"
    return 1
  fi
  cat "$response_file"
  rm -f "$response_file"
}

delete_json() {
  local path="$1"
  local response_file
  local headers=()
  while IFS= read -r header_arg; do
    [[ -n "$header_arg" ]] && headers+=("$header_arg")
  done < <(api_headers)
  response_file="$(mktemp)"
  if ! curl -sS --fail-with-body -o "$response_file" -X DELETE "$API_URL$path" \
    "${headers[@]}"; then
    cat "$response_file" >&2 || true
    rm -f "$response_file"
    return 1
  fi
  cat "$response_file"
  rm -f "$response_file"
}

post_multipart_file() {
  local path="$1"
  local file_path="$2"
  shift 2
  local headers=()
  while IFS= read -r header_arg; do
    [[ -n "$header_arg" ]] && headers+=("$header_arg")
  done < <(api_headers)
  curl -fsS -X POST "$API_URL$path" \
    "${headers[@]}" \
    -F "file=@${file_path}" \
    "$@"
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local deadline=$((SECONDS + "${3:-60}"))
  until curl -fsS "$url" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      smoke_fail "$label did not become ready at $url"
    fi
    sleep 2
  done
}

wait_for_api() {
  local url="${1:-$API_URL}"
  local log_file="${2:-$API_LOG}"
  local deadline=$((SECONDS + 60))
  until curl -fsS "$url/health" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "API did not become healthy within 60s. Last log lines:" >&2
      tail -n 80 "$log_file" >&2 || true
      exit 1
    fi
    sleep 2
  done
}

wait_for_mcp_http() {
  local url="$1"
  local log_file="$2"
  local deadline=$((SECONDS + 60))
  until curl -sS -o /dev/null -w '%{http_code}' "$url" | grep -qE '405|401'; do
    if (( SECONDS >= deadline )); then
      echo "MCP HTTP runtime did not become reachable within 60s. Last log lines:" >&2
      tail -n 80 "$log_file" >&2 || true
      exit 1
    fi
    sleep 2
  done
}

start_main_api() {
  smoke_section "Starting API"
  pnpm --filter api start >"$API_LOG" 2>&1 &
  SMOKE_API_PID=$!
  wait_for_api "$API_URL" "$API_LOG"
}

stop_pid() {
  local pid="$1"
  if [[ -n "$pid" ]]; then
    if command -v pgrep >/dev/null 2>&1; then
      local child
      while IFS= read -r child; do
        [[ -n "$child" ]] && stop_pid "$child"
      done < <(pgrep -P "$pid" || true)
    fi
    kill "$pid" >/dev/null 2>&1 || true
  fi
}

smoke_cleanup() {
  stop_pid "$SMOKE_API_PID"
  stop_pid "$SMOKE_BAD_API_PID"
  stop_pid "$SMOKE_AUTH_API_PID"
  stop_pid "$SMOKE_MCP_HTTP_PID"
  stop_pid "$SMOKE_URL_SERVER_PID"
  if [[ -n "$SMOKE_GIT_TMP_DIR" && -d "$SMOKE_GIT_TMP_DIR" ]]; then
    rm -rf "$SMOKE_GIT_TMP_DIR"
  fi
  if [[ -n "$SMOKE_DOCS_TMP_DIR" && -d "$SMOKE_DOCS_TMP_DIR" ]]; then
    rm -rf "$SMOKE_DOCS_TMP_DIR"
  fi
  if [[ -n "$SMOKE_URL_TMP_DIR" && -d "$SMOKE_URL_TMP_DIR" ]]; then
    rm -rf "$SMOKE_URL_TMP_DIR"
  fi
  if [[ -n "$SMOKE_TRUTH_TMP_DIR" && -d "$SMOKE_TRUTH_TMP_DIR" ]]; then
    rm -rf "$SMOKE_TRUTH_TMP_DIR"
  fi
  if [[ -n "$SMOKE_MULTI_SOURCE_TMP_DIR" && -d "$SMOKE_MULTI_SOURCE_TMP_DIR" ]]; then
    rm -rf "$SMOKE_MULTI_SOURCE_TMP_DIR"
  fi
  if [[ -n "$SMOKE_ALT_POSTGRES_CONTAINER" ]]; then
    docker rm -f "$SMOKE_ALT_POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SMOKE_ALT_REDIS_CONTAINER" ]]; then
    docker rm -f "$SMOKE_ALT_REDIS_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SMOKE_CLEAN_POSTGRES_CONTAINER" ]]; then
    docker rm -f "$SMOKE_CLEAN_POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SMOKE_CLEAN_REDIS_CONTAINER" ]]; then
    docker rm -f "$SMOKE_CLEAN_REDIS_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SMOKE_CLEAN_QDRANT_CONTAINER" ]]; then
    docker rm -f "$SMOKE_CLEAN_QDRANT_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SMOKE_CLEAN_QDRANT_B_CONTAINER" ]]; then
    docker rm -f "$SMOKE_CLEAN_QDRANT_B_CONTAINER" >/dev/null 2>&1 || true
  fi
}

wait_for_indexing_job() {
  local job_id="$1"
  local label="${2:-indexing job}"
  wait_for_indexing_job_status "$job_id" "$label" "succeeded"
}

wait_for_indexing_job_status() {
  local job_id="$1"
  local label="${2:-indexing job}"
  local expected_status="${3:-succeeded}"
  local deadline=$((SECONDS + POLL_SECONDS))
  local job_status=""
  local job_detail=""

  while (( SECONDS < deadline )); do
    job_detail="$(get_json "/jobs/indexing/$job_id")"
    job_status="$(json_field "$job_detail" "status")"
    smoke_note "$label status: $job_status"
    if [[ "$job_status" == "succeeded" || "$job_status" == "failed" ]]; then
      break
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done

  if [[ "$job_status" != "$expected_status" ]]; then
    echo "$job_detail" >&2
    smoke_fail "$label did not reach status $expected_status"
  fi

  SMOKE_LAST_JOB_DETAIL="$job_detail"
}

wait_for_vector_operation_ready() {
  local operation_id="$1"
  local label="${2:-vector operation}"
  local deadline=$((SECONDS + POLL_SECONDS))
  local operation_state=""
  local operation_detail=""

  while (( SECONDS < deadline )); do
    operation_detail="$(get_json "/vector-operations/$operation_id")"
    operation_state="$(json_field "$operation_detail" "state")"
    smoke_note "$label state: $operation_state"
    if [[ "$operation_state" == "ready_for_cutover" || "$operation_state" == "failed" ]]; then
      break
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done

  if [[ "$operation_state" != "ready_for_cutover" ]]; then
    echo "$operation_detail" >&2
    smoke_fail "$label did not become ready for cutover"
  fi

  SMOKE_LAST_VECTOR_OPERATION_DETAIL="$operation_detail"
}

cleanup_smoke_workspaces() {
  local retain="${SMOKE_RETAIN_WORKSPACES:-2}"
  if [[ "${SMOKE_CLEANUP_WORKSPACES:-1}" != "1" ]]; then
    smoke_note "smoke workspace cleanup disabled by SMOKE_CLEANUP_WORKSPACES=0"
    return 0
  fi
  if ! [[ "$retain" =~ ^[0-9]+$ ]]; then
    retain=2
  fi

  smoke_section "Pruning smoke workspaces"
  SMOKE_RETAIN_WORKSPACES="$retain" node <<'NODE'
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const retain = Number.parseInt(process.env.SMOKE_RETAIN_WORKSPACES || '2', 10);
const smokeSlugPattern = /^(smoke-test-kb-|git-smoke-kb-|document-smoke-kb-|url-smoke-workspace-|truth-refresh-smoke-|multi-source-smoke-|eval-smoke-kb-)/;

async function main() {
  const workspaces = await prisma.knowledgeBase.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, slug: true, createdAt: true },
  });
  const smokeWorkspaces = workspaces.filter((workspace) => smokeSlugPattern.test(workspace.slug));
  const stale = smokeWorkspaces.slice(Math.max(0, retain));

  for (const workspace of stale) {
    await prisma.knowledgeBase.update({
      where: { id: workspace.id },
      data: {
        activeIndexVersionId: null,
        activeServingRevisionId: null,
      },
    });
    await prisma.workspaceVectorPlacement.updateMany({
      where: { knowledgeBaseId: workspace.id },
      data: {
        servingRevisionId: null,
        activeIndexBuildId: null,
      },
    });
    await prisma.workspaceServingManifestEntry.deleteMany({
      where: {
        workspaceServingRevision: {
          knowledgeBaseId: workspace.id,
        },
      },
    });
    await prisma.knowledgeBase.delete({ where: { id: workspace.id } });
    console.log(`deleted ${workspace.slug}`);
  }

  const offlineBackends = await prisma.vectorBackend.deleteMany({
    where: {
      name: {
        startsWith: 'multi-source-offline-',
      },
    },
  });

  console.log(`kept ${Math.min(smokeWorkspaces.length, retain)} smoke workspace(s), deleted ${stale.length}`);
  if (offlineBackends.count > 0) {
    console.log(`deleted ${offlineBackends.count} multi-source offline backend(s)`);
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
}

run_case() {
  local name="$1"
  local fn="smoke_case_${name//-/_}"
  if ! declare -F "$fn" >/dev/null 2>&1; then
    smoke_fail "unknown smoke case: $name"
  fi
  "$fn"
}
