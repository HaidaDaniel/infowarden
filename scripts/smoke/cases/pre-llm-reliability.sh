#!/usr/bin/env bash

smoke_case_pre_llm_reliability() {
  smoke_section "Running complete pre-LLM reliability gate"

  run_case core
  run_case indexing
  run_case retrieval
  run_case resources
  run_case memory
  run_case export
  run_case mcp
  run_case git
  run_case documents
  run_case url
  run_case refresh
  run_case truth-refresh
  run_case restore
  run_case providers
  run_case eval
  run_case reranker
  run_case multi-source-topology

  smoke_pre_llm_start_second_qdrant
  smoke_pre_llm_register_second_backend
  smoke_pre_llm_capacity_and_degraded_backend_assertions
  smoke_pre_llm_move_outage_and_recover_workspace
  smoke_pre_llm_move_and_rollback_workspace
  smoke_pre_llm_assert_trace_contract
  smoke_pre_llm_verify_backup_rebuild
  smoke_multi_source_disable_upload_after_move
  smoke_pre_llm_assert_trace_contract
}

smoke_pre_llm_qdrant_b_container_name() {
  if [[ -n "${SMOKE_CLEAN_QDRANT_B_CONTAINER:-}" ]]; then
    printf '%s' "$SMOKE_CLEAN_QDRANT_B_CONTAINER"
  else
    printf '%s' "context-forge-qdrant-b"
  fi
}

smoke_pre_llm_qdrant_b_backend_id() {
  VECTOR_BACKEND_READ_MODEL="$(get_json "/vector-backends/read-model")" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_BACKEND_READ_MODEL);
const backend = (response.backends || []).find((item) => item.name === 'smoke-qdrant-b');
process.stdout.write(backend?.id || '');
NODE
}

smoke_pre_llm_wait_vector_operation_state() {
  local operation_id="$1"
  local expected_state="$2"
  local label="${3:-vector operation}"
  local deadline=$((SECONDS + POLL_SECONDS))
  local operation_state=""
  local operation_detail=""

  while (( SECONDS < deadline )); do
    operation_detail="$(get_json "/vector-operations/$operation_id")"
    operation_state="$(json_field "$operation_detail" "state")"
    smoke_note "$label state: $operation_state"
    if [[ "$operation_state" == "$expected_state" || "$operation_state" == "ready_for_cutover" || "$operation_state" == "failed" ]]; then
      break
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done

  if [[ "$operation_state" != "$expected_state" ]]; then
    echo "$operation_detail" >&2
    smoke_fail "$label did not reach state $expected_state"
  fi

  SMOKE_LAST_VECTOR_OPERATION_DETAIL="$operation_detail"
}

smoke_pre_llm_assert_manifest_and_placement_unchanged() {
  local before_manifest="$1"
  local before_placement="$2"
  local reason="$3"
  local after_manifest after_placement
  after_manifest="$(smoke_multi_source_manifest "$SMOKE_KB_ID")"
  smoke_multi_source_assert_same_manifest "$before_manifest" "$after_manifest" "$reason manifest"
  after_placement="$(get_json "/workspaces/$SMOKE_KB_ID/vector-placement")"
  BEFORE_PLACEMENT="$before_placement" AFTER_PLACEMENT="$after_placement" REASON="$reason" node <<'NODE'
const before = JSON.parse(process.env.BEFORE_PLACEMENT);
const after = JSON.parse(process.env.AFTER_PLACEMENT);
for (const field of ['vectorBackendId', 'servingRevisionId', 'physicalCollectionName', 'activeIndexBuildId']) {
  if ((before[field] || null) !== (after[field] || null)) {
    console.error(`${process.env.REASON} changed placement field ${field}`);
    console.error(JSON.stringify({ before, after }, null, 2));
    process.exit(1);
  }
}
NODE
}

smoke_pre_llm_expect_move_rejected() {
  local kb_id="$1"
  local target_backend_id="$2"
  local key="$3"
  API_URL="$API_URL" KB_ID="$kb_id" TARGET_BACKEND_ID="$target_backend_id" IDEMPOTENCY_KEY="$key" node <<'NODE'
const headers = { 'Content-Type': 'application/json' };
const apiKey = process.env.CONTEXTFORGE_API_KEY || process.env.ADMIN_API_KEY;
if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

async function main() {
  const response = await fetch(`${process.env.API_URL}/workspaces/${process.env.KB_ID}/vector-operations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      kind: 'backend_move',
      targetVectorBackendId: process.env.TARGET_BACKEND_ID,
      idempotencyKey: process.env.IDEMPOTENCY_KEY,
      strategy: 'canonical_reembed',
    }),
  });
  const text = await response.text();
  if (response.status < 400) {
    console.error('backend move unexpectedly succeeded');
    console.error(text);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
}

smoke_pre_llm_capacity_and_degraded_backend_assertions() {
  smoke_section "Checking live capacity and degraded backend exclusion"
  local target_backend_id before_manifest before_placement
  target_backend_id="$(smoke_pre_llm_qdrant_b_backend_id)"
  if [[ -z "$target_backend_id" ]]; then
    smoke_fail "could not resolve smoke-qdrant-b backend id"
  fi
  before_manifest="$(smoke_multi_source_manifest "$SMOKE_KB_ID")"
  before_placement="$(get_json "/workspaces/$SMOKE_KB_ID/vector-placement")"

  patch_json "/vector-backends/$target_backend_id" '{"state":"enabled","capacityHints":{"diskBytes":1,"ramBytes":1,"maxWorkspaces":1}}' >/dev/null
  smoke_pre_llm_expect_move_rejected "$SMOKE_KB_ID" "$target_backend_id" "pre-llm-capacity-reject-$SMOKE_KB_ID"
  smoke_pre_llm_assert_manifest_and_placement_unchanged "$before_manifest" "$before_placement" "capacity rejection"

  patch_json "/vector-backends/$target_backend_id" '{"state":"draining","capacityHints":{"diskBytes":53687091200,"ramBytes":4294967296,"maxWorkspaces":4}}' >/dev/null
  smoke_pre_llm_expect_move_rejected "$SMOKE_KB_ID" "$target_backend_id" "pre-llm-draining-reject-$SMOKE_KB_ID"
  read_model="$(get_json "/vector-backends/read-model")"
  VECTOR_BACKEND_READ_MODEL="$read_model" TARGET_BACKEND_ID="$target_backend_id" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_BACKEND_READ_MODEL);
const backend = (response.backends || []).find((item) => item.id === process.env.TARGET_BACKEND_ID);
if (backend?.state !== 'draining') {
  console.error('read model did not expose draining backend state');
  console.error(JSON.stringify(backend, null, 2));
  process.exit(1);
}
NODE
  smoke_pre_llm_assert_manifest_and_placement_unchanged "$before_manifest" "$before_placement" "draining rejection"

  patch_json "/vector-backends/$target_backend_id" '{"state":"enabled","capacityHints":{"diskBytes":53687091200,"ramBytes":4294967296,"maxWorkspaces":4}}' >/dev/null
  post_json "/vector-backends/$target_backend_id/health" '{}' >/dev/null
}

smoke_pre_llm_move_outage_and_recover_workspace() {
  smoke_section "Failing accepted backend move by stopping real Qdrant-B"
  local target_backend_id qdrant_b_container before_manifest before_placement operation operation_id failed retry_request built cutover moved_trace rollback
  target_backend_id="$(smoke_pre_llm_qdrant_b_backend_id)"
  qdrant_b_container="$(smoke_pre_llm_qdrant_b_container_name)"
  if [[ -z "$target_backend_id" ]]; then
    smoke_fail "could not resolve smoke-qdrant-b backend id"
  fi
  before_manifest="$(smoke_multi_source_manifest "$SMOKE_KB_ID")"
  before_placement="$(get_json "/workspaces/$SMOKE_KB_ID/vector-placement")"
  operation="$(post_json "/workspaces/$SMOKE_KB_ID/vector-operations" "{
    \"kind\":\"backend_move\",
    \"targetVectorBackendId\":\"$target_backend_id\",
    \"strategy\":\"canonical_reembed\",
    \"idempotencyKey\":\"pre-llm-real-outage-move-$SMOKE_KB_ID\",
    \"rollbackRetentionHours\":1
  }")"
  operation_id="$(json_field "$operation" "id")"
  if [[ -z "$operation_id" ]]; then
    echo "$operation" >&2
    smoke_fail "outage backend move operation did not return an id"
  fi

  docker stop "$qdrant_b_container" >/dev/null
  post_json "/vector-backends/$target_backend_id/health" '{}' >/dev/null || true
  smoke_pre_llm_wait_vector_operation_state "$operation_id" "failed" "backend move during Qdrant-B outage"
  failed="$SMOKE_LAST_VECTOR_OPERATION_DETAIL"
  VECTOR_OPERATION_FAILED="$failed" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_OPERATION_FAILED);
if (response.state !== 'failed' || !response.errorSummary?.code || !response.errorSummary?.stage) {
  console.error('outage operation did not record structured failure');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  smoke_pre_llm_assert_manifest_and_placement_unchanged "$before_manifest" "$before_placement" "target outage"

  docker start "$qdrant_b_container" >/dev/null
  wait_for_url "http://localhost:${SMOKE_QDRANT_B_PORT:-6335}/collections" "Qdrant-B recovery" 90
  post_json "/vector-backends/$target_backend_id/health" '{}' >/dev/null

  retry_request="$(post_json "/vector-operations/$operation_id/build" '{}')"
  VECTOR_OPERATION_RETRY="$retry_request" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_OPERATION_RETRY);
if (!response.buildJobId || response.state === 'failed') {
  console.error('retry did not enqueue a fresh build job');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  wait_for_vector_operation_ready "$operation_id" "recovered backend move candidate build"
  built="$SMOKE_LAST_VECTOR_OPERATION_DETAIL"
  VECTOR_OPERATION_BUILT="$built" EXPECTED_SOURCE_REVISION_COUNT="${SMOKE_EXPECTED_SOURCE_REVISION_COUNT:-0}" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_OPERATION_BUILT);
const expectedCount = Number(process.env.EXPECTED_SOURCE_REVISION_COUNT || '0');
const coverage = response.validationSummary?.revisionCoverage || [];
if (response.state !== 'ready_for_cutover' || (expectedCount > 0 && coverage.length !== expectedCount)) {
  console.error('recovered outage candidate did not validate manifest coverage');
  console.error(JSON.stringify(response.validationSummary, null, 2));
  process.exit(1);
}
if ((response.validationSummary?.semanticProbes?.checked || 0) < 1) {
  console.error('recovered outage candidate did not run semantic probes');
  console.error(JSON.stringify(response.validationSummary, null, 2));
  process.exit(1);
}
NODE

  cutover="$(post_json "/vector-operations/$operation_id/cutover" '{}')"
  VECTOR_OPERATION_CUTOVER="$cutover" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_OPERATION_CUTOVER);
if (response.state !== 'cutover_complete') {
  console.error('recovered outage move did not cut over');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  moved_trace="$(post_json "/workspaces/$SMOKE_KB_ID/retrieval-trace" '{"query":"Emerald multi local updated marker","topK":3,"tokenBudget":300}')"
  MOVED_TRACE="$moved_trace" TARGET_BACKEND_ID="$target_backend_id" node <<'NODE'
const response = JSON.parse(process.env.MOVED_TRACE);
if (response.diagnostics?.serving?.vectorBackendId !== process.env.TARGET_BACKEND_ID || !response.stages?.finalCandidates?.length) {
  console.error('retrieval after recovered outage move did not use target backend');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  rollback="$(post_json "/vector-operations/$operation_id/rollback" '{}')"
  VECTOR_OPERATION_ROLLBACK="$rollback" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_OPERATION_ROLLBACK);
if (response.state !== 'rollback_complete') {
  console.error('recovered outage move rollback did not complete');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}

smoke_pre_llm_start_second_qdrant() {
  smoke_section "Starting independent Qdrant-B backend"
  if [[ "${SMOKE_CLEAN_STATE:-0}" == "1" ]]; then
    local suffix="${SMOKE_CLEAN_SUFFIX:-$RANDOM-$$}"
    suffix="${suffix//[^a-zA-Z0-9_-]/-}"
    SMOKE_QDRANT_B_PORT="${SMOKE_QDRANT_B_PORT:-16335}"
    SMOKE_QDRANT_B_GRPC_PORT="${SMOKE_QDRANT_B_GRPC_PORT:-16336}"
    SMOKE_CLEAN_QDRANT_B_CONTAINER="context-forge-smoke-qdrant-b-$suffix"
    docker rm -f "$SMOKE_CLEAN_QDRANT_B_CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$SMOKE_CLEAN_QDRANT_B_CONTAINER" \
      -p "$SMOKE_QDRANT_B_PORT:6333" \
      -p "$SMOKE_QDRANT_B_GRPC_PORT:6334" \
      qdrant/qdrant:v1.17.0 >/dev/null
    export SMOKE_QDRANT_B_PORT
    export SMOKE_QDRANT_B_GRPC_PORT
  else
    docker compose -f docker-compose.reliability.yml up -d qdrant-b
  fi
  wait_for_url "http://localhost:${SMOKE_QDRANT_B_PORT:-6335}/collections" "Qdrant-B" 90
}

smoke_pre_llm_register_second_backend() {
  smoke_section "Registering and checking second vector backend"
  local backend_name="smoke-qdrant-b"
  local existing_backend_id
  existing_backend_id="$(VECTOR_BACKEND_LIST="$(get_json "/vector-backends")" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_BACKEND_LIST);
const backend = (Array.isArray(response) ? response : []).find((item) => item.name === 'smoke-qdrant-b');
process.stdout.write(backend?.id || '');
NODE
)"
  if [[ -z "$existing_backend_id" ]]; then
    post_json "/vector-backends" "{
        \"name\":\"${backend_name}\",
        \"baseUrl\":\"http://localhost:${SMOKE_QDRANT_B_PORT:-6335}\",
        \"labels\":[\"smoke\",\"independent\",\"ssd\"],
        \"capacityHints\":{
          \"diskBytes\":53687091200,
          \"ramBytes\":4294967296,
          \"maxWorkspaces\":4
        }
      }" >/dev/null
  fi

  local refresh_response read_model
  refresh_response="$(post_json "/vector-backends/health/refresh" '{}')"
  VECTOR_BACKEND_REFRESH="$refresh_response" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_BACKEND_REFRESH);
const backends = Array.isArray(response) ? response : [];
const names = new Set(backends.map((backend) => backend.name));
if (!names.has('default-qdrant') || !names.has('smoke-qdrant-b')) {
  console.error('expected default-qdrant and smoke-qdrant-b in health refresh');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
for (const name of ['default-qdrant', 'smoke-qdrant-b']) {
  const backend = backends.find((item) => item.name === name);
  if (backend?.healthMetadata?.healthy !== true || backend?.healthMetadata?.compatible !== true) {
    console.error(`${name} is not healthy/compatible`);
    console.error(JSON.stringify(backend, null, 2));
    process.exit(1);
  }
}
NODE

  read_model="$(get_json "/vector-backends/read-model")"
  VECTOR_BACKEND_READ_MODEL="$read_model" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_BACKEND_READ_MODEL);
const backends = response.backends || [];
if (backends.length < 2 || !backends.some((backend) => backend.name === 'smoke-qdrant-b')) {
  console.error('read model did not expose both independent vector backends');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
for (const backend of backends) {
  if ('apiKey' in backend || 'secret' in backend || 'authorization' in backend || 'headers' in backend) {
    console.error('vector backend read model exposed a raw secret-bearing field');
    console.error(JSON.stringify(backend, null, 2));
    process.exit(1);
  }
  if (backend.apiKeyRef !== null && backend.apiKeyRef !== '[configured]') {
    console.error('vector backend read model exposed an unredacted apiKeyRef');
    console.error(JSON.stringify(backend, null, 2));
    process.exit(1);
  }
}
function hasSecretLikeString(value) {
  if (typeof value === 'string') return /(Bearer\s+|sk-[a-z0-9]|token[:=_-]|secret[:=_-])/i.test(value);
  if (Array.isArray(value)) return value.some(hasSecretLikeString);
  if (value && typeof value === 'object') return Object.values(value).some(hasSecretLikeString);
  return false;
}
if (hasSecretLikeString(response)) {
  console.error('vector backend read model leaked secret-like data');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}

smoke_pre_llm_move_and_rollback_workspace() {
  if [[ -z "$SMOKE_KB_ID" ]]; then
    smoke_fail "pre-LLM backend move requires SMOKE_KB_ID"
  fi

  smoke_section "Moving smoke workspace to Qdrant-B and rolling back"
  local read_model target_backend_id operation operation_id built cutover rollback
  read_model="$(get_json "/vector-backends/read-model")"
  target_backend_id="$(VECTOR_BACKEND_READ_MODEL="$read_model" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_BACKEND_READ_MODEL);
const backend = (response.backends || []).find((item) => item.name === 'smoke-qdrant-b');
process.stdout.write(backend?.id || '');
NODE
)"
  if [[ -z "$target_backend_id" ]]; then
    smoke_fail "could not resolve smoke-qdrant-b backend id"
  fi

  operation="$(post_json "/workspaces/$SMOKE_KB_ID/vector-operations" "{
    \"kind\":\"backend_move\",
    \"targetVectorBackendId\":\"$target_backend_id\",
    \"idempotencyKey\":\"pre-llm-reliability-move-$SMOKE_KB_ID\",
    \"rollbackRetentionHours\":1
  }")"
  operation_id="$(json_field "$operation" "id")"
  if [[ -z "$operation_id" ]]; then
    echo "$operation" >&2
    smoke_fail "backend move operation did not return an id"
  fi

  wait_for_vector_operation_ready "$operation_id" "backend move candidate build"
  built="$SMOKE_LAST_VECTOR_OPERATION_DETAIL"
  VECTOR_OPERATION_BUILT="$built" EXPECTED_SOURCE_REVISION_COUNT="${SMOKE_EXPECTED_SOURCE_REVISION_COUNT:-0}" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_OPERATION_BUILT);
const expectedCount = Number(process.env.EXPECTED_SOURCE_REVISION_COUNT || '0');
if (response.state !== 'ready_for_cutover') {
  console.error('backend move candidate was not ready for cutover');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
const coverage = response.validationSummary?.revisionCoverage || [];
if (expectedCount > 0 && coverage.length !== expectedCount) {
  console.error(`backend move validation did not cover ${expectedCount} source revisions`);
  console.error(JSON.stringify(response.validationSummary, null, 2));
  process.exit(1);
}
if (!coverage.length || coverage.some((item) => item.targetPoints <= 0 || item.sourcePoints !== item.targetPoints)) {
  console.error('backend move validation did not prove per-source revision parity');
  console.error(JSON.stringify(response.validationSummary, null, 2));
  process.exit(1);
}
if ((response.validationSummary?.semanticProbes?.checked || 0) < 1) {
  console.error('backend move validation did not run candidate semantic probes');
  console.error(JSON.stringify(response.validationSummary, null, 2));
  process.exit(1);
}
NODE

  cutover="$(post_json "/vector-operations/$operation_id/cutover" '{}')"
  VECTOR_OPERATION_CUTOVER="$cutover" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_OPERATION_CUTOVER);
if (response.state !== 'cutover_complete') {
  console.error('backend move did not cut over');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  local moved_trace moved_trace_body
  moved_trace_body="$(VERIFY_QUERY="${SMOKE_VERIFY_QUERY:-search functionality}" node <<'NODE'
process.stdout.write(JSON.stringify({ query: process.env.VERIFY_QUERY, topK: 3, tokenBudget: 300 }));
NODE
)"
  moved_trace="$(post_json "/workspaces/$SMOKE_KB_ID/retrieval-trace" "$moved_trace_body")"
  MOVED_TRACE="$moved_trace" TARGET_BACKEND_ID="$target_backend_id" EXPECTED_SOURCE_REVISION_COUNT="${SMOKE_EXPECTED_SOURCE_REVISION_COUNT:-0}" node <<'NODE'
const response = JSON.parse(process.env.MOVED_TRACE);
const expectedCount = Number(process.env.EXPECTED_SOURCE_REVISION_COUNT || '0');
if (response.diagnostics?.serving?.vectorBackendId !== process.env.TARGET_BACKEND_ID) {
  console.error('retrieval trace did not use target vector backend after cutover');
  console.error(JSON.stringify(response.diagnostics?.serving, null, 2));
  process.exit(1);
}
if (expectedCount > 0 && (response.diagnostics?.serving?.sourceRevisionIds || []).length !== expectedCount) {
  console.error(`retrieval after backend move did not use ${expectedCount} source revisions`);
  console.error(JSON.stringify(response.diagnostics?.serving, null, 2));
  process.exit(1);
}
if (!response.stages?.finalCandidates?.length) {
  console.error('retrieval after backend move returned no candidates');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  rollback="$(post_json "/vector-operations/$operation_id/rollback" '{}')"
  VECTOR_OPERATION_ROLLBACK="$rollback" node <<'NODE'
const response = JSON.parse(process.env.VECTOR_OPERATION_ROLLBACK);
if (response.state !== 'rollback_complete') {
  console.error('backend move rollback did not complete');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}

smoke_pre_llm_assert_trace_contract() {
  smoke_section "Checking hard-budget/provenance trace contract"
  local trace_response trace_body
  trace_body="$(VERIFY_QUERY="${SMOKE_VERIFY_QUERY:-search functionality}" node <<'NODE'
process.stdout.write(JSON.stringify({ query: process.env.VERIFY_QUERY, topK: 5, tokenBudget: 12 }));
NODE
)"
  trace_response="$(post_json "/workspaces/$SMOKE_KB_ID/retrieval-trace" "$trace_body")"
  PRE_LLM_TRACE="$trace_response" EXPECTED_SOURCE_REVISION_COUNT="${SMOKE_EXPECTED_SOURCE_REVISION_COUNT:-0}" node <<'NODE'
const response = JSON.parse(process.env.PRE_LLM_TRACE);
const diag = response.diagnostics || {};
const expectedCount = Number(process.env.EXPECTED_SOURCE_REVISION_COUNT || '0');
if (!diag.serving?.servingRevisionId || !diag.serving?.vectorBackendId || !diag.serving?.sourceRevisionIds?.length) {
  console.error('trace is missing serving revision/vector backend/source revisions');
  console.error(JSON.stringify(diag.serving, null, 2));
  process.exit(1);
}
if (expectedCount > 0 && diag.serving.sourceRevisionIds.length !== expectedCount) {
  console.error(`trace source revision count did not match ${expectedCount}`);
  console.error(JSON.stringify(diag.serving, null, 2));
  process.exit(1);
}
if (!diag.budget?.tokenizer?.id || diag.budget.usedTokens > diag.budget.retrievalBudgetTokens) {
  console.error('trace budget diagnostics are missing or over hard budget');
  console.error(JSON.stringify(diag.budget, null, 2));
  process.exit(1);
}
if (typeof diag.neighborExpansionQueries !== 'number' || diag.neighborExpansionQueries > 2) {
  console.error('neighbor expansion query count is not bounded');
  console.error(JSON.stringify(diag, null, 2));
  process.exit(1);
}
if (!Array.isArray(response.stages?.nearDedupedCandidates)) {
  console.error('trace is missing near-deduped stage');
  console.error(JSON.stringify(response.stages, null, 2));
  process.exit(1);
}
NODE
}

smoke_pre_llm_verify_backup_rebuild() {
  smoke_section "Verifying backup/rebuild path after Qdrant materialization loss"
  WORKSPACE_IDENTIFIER="$SMOKE_KB_ID" API_BASE_URL="$API_URL" VERIFY_QUERY="${SMOKE_VERIFY_QUERY:-search functionality}" \
    scripts/verify-backup-rebuild.sh
}
