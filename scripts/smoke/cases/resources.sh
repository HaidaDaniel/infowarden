#!/usr/bin/env bash

smoke_case_resources() {
  if [[ -z "$SMOKE_KB_ID" ]]; then
    smoke_fail "resources case requires indexing case to set SMOKE_KB_ID"
  fi

  smoke_section "Checking system resource inventory"
  local system_response
  system_response="$(get_json "/resources/system")"
  SYSTEM_RESPONSE="$system_response" node <<'NODE'
const response = JSON.parse(process.env.SYSTEM_RESPONSE);
if (!response.target || response.target.cpuCores !== 4 || response.target.ramBytes !== 8 * 1024 ** 3) {
  console.error('system resource target is missing the 4 CPU / 8 GB dev budget');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!response.host || typeof response.host.cpuCores !== 'number' || typeof response.host.freeRamBytes !== 'number') {
  console.error('system host resource snapshot is incomplete');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!response.qdrant || typeof response.qdrant.collections !== 'number') {
  console.error('qdrant resource snapshot is incomplete');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking workspace resource status and low-memory estimate"
  local resource_response estimate_response
  resource_response="$(get_json "/workspaces/$SMOKE_KB_ID/resources")"
  RESOURCE_RESPONSE="$resource_response" node <<'NODE'
const response = JSON.parse(process.env.RESOURCE_RESPONSE);
if (response.lifecycle?.status !== 'loaded' || response.lifecycle?.collectionAvailable !== true) {
  console.error('workspace should be loaded before resource lifecycle smoke');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!response.activeIndexVersion?.embeddingDimension || !response.activeIndexVersion?.storageProfile) {
  console.error('active index resource metadata is incomplete');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (response.resources?.estimate?.storageProfile !== response.activeIndexVersion.storageProfile) {
  console.error('workspace resource estimate is not exposed under the split resource shape');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
for (const key of ['requested', 'allocated', 'observed']) {
  if (response.resources?.[key]?.kind !== key) {
    console.error(`workspace resources.${key} is missing kind=${key}`);
    console.error(JSON.stringify(response, null, 2));
    process.exit(1);
  }
}
NODE

  estimate_response="$(get_json "/workspaces/$SMOKE_KB_ID/resources/estimate?storageProfile=low_memory")"
  ESTIMATE_RESPONSE="$estimate_response" node <<'NODE'
const response = JSON.parse(process.env.ESTIMATE_RESPONSE);
if (response.storageProfile !== 'low_memory') {
  console.error('low_memory estimate did not preserve requested storage profile');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!response.storageConfig?.onDiskVectors || !response.storageConfig?.onDiskPayload || !response.storageConfig?.onDiskHnsw) {
  console.error('low_memory estimate is missing on-disk Qdrant controls');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!response.estimatedChunks || !response.embeddingDimension || !response.rawVectorBytes) {
  console.error('workspace capacity estimate is incomplete');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Unloading workspace and checking retrieval guardrail"
  local unload_response
  unload_response="$(post_json "/workspaces/$SMOKE_KB_ID/unload" '{}')"
  UNLOAD_RESPONSE="$unload_response" node <<'NODE'
const response = JSON.parse(process.env.UNLOAD_RESPONSE);
if (response.lifecycle?.status !== 'unloaded' || response.lifecycle?.collectionAvailable !== false) {
  console.error('workspace unload did not return unloaded lifecycle');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  local unloaded_search_body unloaded_search_status
  unloaded_search_body="$(mktemp)"
  unloaded_search_status="$(curl -sS -o "$unloaded_search_body" -w '%{http_code}' \
    -X POST "$API_URL/knowledge-bases/$SMOKE_KB_ID/search" \
    -H "Content-Type: application/json" \
    $(api_headers) \
    --data-binary '{"query":"search functionality","topK":1}')"
  if [[ "$unloaded_search_status" -lt 400 ]]; then
    cat "$unloaded_search_body" >&2
    rm -f "$unloaded_search_body"
    smoke_fail "retrieval unexpectedly succeeded while workspace was unloaded"
  fi
  rm -f "$unloaded_search_body"

  smoke_section "Loading workspace with low-memory storage profile"
  local load_response load_job_id
  load_response="$(post_json "/workspaces/$SMOKE_KB_ID/load" '{"storageProfile":"low_memory"}')"
  load_job_id="$(json_field "$load_response" "job.id")"
  if [[ -n "$load_job_id" ]]; then
    wait_for_indexing_job "$load_job_id" "workspace load rebuild job"
    local load_job_response
    load_job_response="$(get_json "/jobs/indexing/$load_job_id")"
    LOAD_JOB_RESPONSE="$load_job_response" node <<'NODE'
const response = JSON.parse(process.env.LOAD_JOB_RESPONSE);
if (response.type !== 'build_index' || response.stats?.lifecycleAction !== 'load_workspace') {
  console.error('workspace load did not run through the all-source build_index reconciliation job');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!response.stats?.sourceRevisionCount || !Array.isArray(response.stats?.revisionCoverage)) {
  console.error('workspace load job did not report serving-manifest revision coverage');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  fi

  resource_response="$(get_json "/workspaces/$SMOKE_KB_ID/resources")"
  RESOURCE_RESPONSE="$resource_response" node <<'NODE'
const response = JSON.parse(process.env.RESOURCE_RESPONSE);
if (response.lifecycle?.status !== 'loaded' || response.lifecycle?.collectionAvailable !== true) {
  console.error('workspace should be loaded after lifecycle smoke');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (response.activeIndexVersion?.storageProfile !== 'low_memory') {
  console.error('workspace load did not materialize the low_memory storage profile');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!response.activeIndexVersion?.storageConfig?.onDiskVectors) {
  console.error('loaded low_memory index is missing on-disk vector config');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (response.resources?.requested?.storageProfile !== 'low_memory') {
  console.error('loaded workspace resources.requested did not record low_memory profile');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!response.resources?.allocated?.vectorBackendId || !response.resources?.observed?.vectorBackendId) {
  console.error('loaded workspace did not expose allocated/observed backend identity');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking retrieval after workspace reload"
  local search_response
  search_response="$(post_json "/knowledge-bases/$SMOKE_KB_ID/search" '{"query":"search functionality","topK":3}')"
  SEARCH_RESPONSE="$search_response" node <<'NODE'
const response = JSON.parse(process.env.SEARCH_RESPONSE);
if (!response.results?.length || response.count < 1) {
  console.error('REST search returned no results after workspace reload');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}
