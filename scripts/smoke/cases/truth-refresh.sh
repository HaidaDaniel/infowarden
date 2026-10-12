#!/usr/bin/env bash

truth_refresh_json() {
  node -e 'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1])))' "$1"
}

truth_refresh_assert_search_contains() {
  local response="$1"
  local marker="$2"
  local path="$3"
  local metadata_key="${4:-}"
  local metadata_value="${5:-}"

  SEARCH_RESPONSE="$response" EXPECTED_MARKER="$marker" EXPECTED_PATH="$path" METADATA_KEY="$metadata_key" METADATA_VALUE="$metadata_value" node <<'NODE'
const response = JSON.parse(process.env.SEARCH_RESPONSE);
const marker = process.env.EXPECTED_MARKER;
const path = process.env.EXPECTED_PATH;
const metadataKey = process.env.METADATA_KEY;
const metadataValue = process.env.METADATA_VALUE;
const result = (response.results || []).find((item) =>
  String(item.text || '').includes(marker) && (!path || item.path === path)
);
if (!result) {
  console.error('expected marker was not searchable');
  console.error(JSON.stringify({ marker, path, response }, null, 2));
  process.exit(1);
}
if (metadataKey && result.metadata?.[metadataKey] !== metadataValue) {
  console.error('search result metadata did not match expectation');
  console.error(JSON.stringify({ metadataKey, metadataValue, result }, null, 2));
  process.exit(1);
}
NODE
}

truth_refresh_assert_search_empty() {
  local response="$1"
  local label="$2"

  SEARCH_RESPONSE="$response" SEARCH_LABEL="$label" node <<'NODE'
const response = JSON.parse(process.env.SEARCH_RESPONSE);
if ((response.results || []).length !== 0) {
  console.error(`${process.env.SEARCH_LABEL} unexpectedly returned results`);
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}

truth_refresh_assert_search_lacks_marker() {
  local response="$1"
  local marker="$2"
  local label="$3"

  SEARCH_RESPONSE="$response" UNEXPECTED_MARKER="$marker" SEARCH_LABEL="$label" node <<'NODE'
const response = JSON.parse(process.env.SEARCH_RESPONSE);
const marker = process.env.UNEXPECTED_MARKER;
if ((response.results || []).some((item) => String(item.text || '').includes(marker))) {
  console.error(`${process.env.SEARCH_LABEL} unexpectedly returned marker text`);
  console.error(JSON.stringify({ marker, response }, null, 2));
  process.exit(1);
}
NODE
}

truth_refresh_assert_dry_run_counts() {
  local response="$1"
  local label="$2"

  DRY_RUN_RESPONSE="$response" DRY_RUN_LABEL="$label" node <<'NODE'
const response = JSON.parse(process.env.DRY_RUN_RESPONSE);
const stats = response.plan?.stats || {};
if (response.dryRun !== true || stats.added !== 1 || stats.changed !== 1 || stats.deleted !== 1) {
  console.error(`${process.env.DRY_RUN_LABEL} dry-run did not detect add/change/delete`);
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}

truth_refresh_assert_refresh_job() {
  local job_detail="$1"
  local trigger="$2"
  local label="$3"

  JOB_DETAIL="$job_detail" EXPECTED_TRIGGER="$trigger" JOB_LABEL="$label" node <<'NODE'
const job = JSON.parse(process.env.JOB_DETAIL);
const stats = job.stats || {};
if (stats.refreshMode !== 'incremental' || stats.refreshTrigger !== process.env.EXPECTED_TRIGGER) {
  console.error(`${process.env.JOB_LABEL} did not record expected refresh mode/trigger`);
  console.error(JSON.stringify(stats, null, 2));
  process.exit(1);
}
if (!stats.validationReportId || (stats.filesParsed || 0) < 1) {
  console.error(`${process.env.JOB_LABEL} stats are incomplete`);
  console.error(JSON.stringify(stats, null, 2));
  process.exit(1);
}
NODE
}

truth_refresh_enqueue_refresh() {
  local kb_id="$1"
  local source_id="$2"
  local reason="$3"
  local response job_id
  response="$(post_json "/workspaces/$kb_id/sources/$source_id/refresh" "$(REASON="$reason" node <<'NODE'
process.stdout.write(JSON.stringify({
  mode: 'incremental',
  reason: process.env.REASON,
}));
NODE
)")"
  job_id="$(json_field "$response" "job.id")"
  if [[ -z "$job_id" ]]; then
    smoke_fail "failed to enqueue refresh: $response"
  fi
  echo "$job_id"
}

smoke_case_truth_refresh() {
  if [[ "$SMOKE_CORE_READY" != "1" ]]; then
    smoke_note "truth-refresh smoke requires the core stack; running core first"
    smoke_case_core
  fi

  smoke_section "Creating source-truth fixtures"
  SMOKE_TRUTH_TMP_DIR="$(mktemp -d)"
  local local_dir="$SMOKE_TRUTH_TMP_DIR/local-truth"
  local vault_dir="$SMOKE_TRUTH_TMP_DIR/obsidian-vault"
  mkdir -p "$local_dir" "$vault_dir/.obsidian"

  cat >"$local_dir/guide.md" <<'EOF'
# Local truth guide

Quartz local truth marker proves the initial local folder source is searchable.
EOF
  cat >"$local_dir/retired.md" <<'EOF'
# Retired local truth

Retired local truth marker should disappear after source truth deletion.
EOF
  cat >"$vault_dir/Alpha.md" <<'EOF'
---
topic: rag-memory
---
# Alpha

Atlas obsidian initial marker links to [[Beta]] and carries #rag-memory.
EOF
  cat >"$vault_dir/Beta.md" <<'EOF'
# Beta

Beta obsidian retired marker exists for backlink metadata before deletion.
EOF
  cat >"$vault_dir/.obsidian/app.json" <<'EOF'
{"ignored":"smoke should not index app config"}
EOF

  smoke_section "Creating truth-refresh workspace and sources"
  local suffix kb_response truth_kb_id local_source_body local_source_response local_source_id
  local obsidian_source_body obsidian_source_response obsidian_source_id
  suffix="$(date -u +%Y%m%d%H%M%S)"
  kb_response="$(post_json "/knowledge-bases" "{\"name\":\"Truth Refresh Smoke $suffix\",\"description\":\"Source truth refresh smoke\",\"workspaceKind\":\"docs\"}")"
  truth_kb_id="$(json_field "$kb_response" "id")"
  if [[ -z "$truth_kb_id" ]]; then
    smoke_fail "failed to create truth-refresh workspace: $kb_response"
  fi
  smoke_note "TRUTH_REFRESH_KB_ID=$truth_kb_id"

  local_source_body="$(
    KB_ID="$truth_kb_id" LOCAL_DIR="$local_dir" node <<'NODE'
process.stdout.write(JSON.stringify({
  knowledgeBaseId: process.env.KB_ID,
  type: 'local_folder',
  uri: process.env.LOCAL_DIR,
  includeRules: ['**/*.md'],
  excludeRules: ['**/.DS_Store'],
}));
NODE
  )"
  local_source_response="$(post_json "/sources" "$local_source_body")"
  local_source_id="$(json_field "$local_source_response" "id")"
  if [[ -z "$local_source_id" ]]; then
    smoke_fail "failed to create local truth source: $local_source_response"
  fi

  obsidian_source_body="$(
    KB_ID="$truth_kb_id" VAULT_DIR="$vault_dir" node <<'NODE'
process.stdout.write(JSON.stringify({
  knowledgeBaseId: process.env.KB_ID,
  type: 'obsidian_vault',
  uri: process.env.VAULT_DIR,
  includeRules: ['**/*.md'],
}));
NODE
  )"
  obsidian_source_response="$(post_json "/sources" "$obsidian_source_body")"
  obsidian_source_id="$(json_field "$obsidian_source_response" "id")"
  if [[ -z "$obsidian_source_id" ]]; then
    smoke_fail "failed to create Obsidian truth source: $obsidian_source_response"
  fi

  smoke_section "Checking source truth policies"
  local local_policy obsidian_policy
  local_policy="$(get_json "/workspaces/$truth_kb_id/sources/$local_source_id/policy")"
  obsidian_policy="$(get_json "/workspaces/$truth_kb_id/sources/$obsidian_source_id/policy")"
  LOCAL_POLICY="$local_policy" OBSIDIAN_POLICY="$obsidian_policy" node <<'NODE'
for (const [label, policy] of [
  ['local', JSON.parse(process.env.LOCAL_POLICY)],
  ['obsidian', JSON.parse(process.env.OBSIDIAN_POLICY)],
]) {
  if (policy.sourceTruthPolicy?.truthMode !== 'read_only' || policy.sourceTruthPolicy?.writePolicy !== 'disabled') {
    console.error(`${label} source truth policy is not read-only/disabled`);
    console.error(JSON.stringify(policy, null, 2));
    process.exit(1);
  }
}
NODE

  smoke_section "Indexing initial truth fixtures"
  local job_id
  job_id="$(truth_refresh_enqueue_refresh "$truth_kb_id" "$local_source_id" "initial local truth index")"
  wait_for_indexing_job "$job_id" "initial local truth refresh"
  truth_refresh_assert_refresh_job "$SMOKE_LAST_JOB_DETAIL" "manual" "initial local truth refresh"
  job_id="$(truth_refresh_enqueue_refresh "$truth_kb_id" "$obsidian_source_id" "initial obsidian truth index")"
  wait_for_indexing_job "$job_id" "initial obsidian truth refresh"
  truth_refresh_assert_refresh_job "$SMOKE_LAST_JOB_DETAIL" "manual" "initial obsidian truth refresh"

  smoke_section "Checking retrieval and Qdrant presence after initial index"
  local collection_name="kb-$truth_kb_id"
  local scroll_response point_count local_search obsidian_search
  scroll_response="$(curl -fsS -X POST "$QDRANT_URL/collections/$collection_name/points/scroll" -H "Content-Type: application/json" --data-binary '{"limit":1,"with_payload":true,"with_vector":false}')"
  point_count="$(node -e "const data=JSON.parse(process.argv[1]); console.log((data.result?.points || []).length)" "$scroll_response")"
  if [[ "$point_count" == "0" ]]; then
    smoke_fail "truth-refresh Qdrant collection has no points"
  fi
  local_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Quartz local truth marker","topK":5,"pathPrefix":"guide.md"}')"
  truth_refresh_assert_search_contains "$local_search" "Quartz local truth marker" "guide.md"
  obsidian_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Atlas obsidian initial marker","topK":5,"pathPrefix":"Alpha.md","filters":{"metadata":{"sourceType":"obsidian_vault"}}}')"
  truth_refresh_assert_search_contains "$obsidian_search" "Atlas obsidian initial marker" "Alpha.md" "sourceType" "obsidian_vault"

  smoke_section "Editing local folder source truth"
  cat >"$local_dir/guide.md" <<'EOF'
# Local truth guide

Saffron local updated marker proves changed source truth replaces prior retrieval text.
EOF
  cat >"$local_dir/new.md" <<'EOF'
# New local truth

Topaz local added marker proves new source truth appears after refresh.
EOF
  rm "$local_dir/retired.md"
  grep -q "Saffron local updated marker" "$local_dir/guide.md"

  local dry_run_response
  dry_run_response="$(post_json "/workspaces/$truth_kb_id/sources/$local_source_id/refresh" '{"mode":"incremental","dryRun":true,"reason":"preview local truth edit"}')"
  truth_refresh_assert_dry_run_counts "$dry_run_response" "local truth"
  job_id="$(truth_refresh_enqueue_refresh "$truth_kb_id" "$local_source_id" "apply local truth edit")"
  wait_for_indexing_job "$job_id" "local truth update refresh"
  truth_refresh_assert_refresh_job "$SMOKE_LAST_JOB_DETAIL" "manual" "local truth update refresh"

  local_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Saffron local updated marker","topK":5,"pathPrefix":"guide.md"}')"
  truth_refresh_assert_search_contains "$local_search" "Saffron local updated marker" "guide.md"
  local_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Topaz local added marker","topK":5,"pathPrefix":"new.md"}')"
  truth_refresh_assert_search_contains "$local_search" "Topaz local added marker" "new.md"
  local_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Retired local truth marker","topK":5,"pathPrefix":"retired.md"}')"
  truth_refresh_assert_search_empty "$local_search" "deleted local truth"

  smoke_section "Editing Obsidian vault source truth"
  cat >"$vault_dir/Alpha.md" <<'EOF'
---
topic: rag-memory
---
# Alpha

Borealis obsidian updated marker links to [[Gamma]] and keeps #rag-memory.
EOF
  cat >"$vault_dir/Gamma.md" <<'EOF'
# Gamma

Celadon obsidian added marker proves new vault notes appear after refresh.
EOF
  rm "$vault_dir/Beta.md"
  dry_run_response="$(post_json "/workspaces/$truth_kb_id/sources/$obsidian_source_id/refresh" '{"mode":"incremental","dryRun":true,"reason":"preview obsidian truth edit"}')"
  truth_refresh_assert_dry_run_counts "$dry_run_response" "obsidian truth"
  job_id="$(truth_refresh_enqueue_refresh "$truth_kb_id" "$obsidian_source_id" "apply obsidian truth edit")"
  wait_for_indexing_job "$job_id" "obsidian truth update refresh"
  truth_refresh_assert_refresh_job "$SMOKE_LAST_JOB_DETAIL" "manual" "obsidian truth update refresh"

  obsidian_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Borealis obsidian updated marker","topK":5,"pathPrefix":"Alpha.md","filters":{"metadata":{"sourceType":"obsidian_vault"}}}')"
  truth_refresh_assert_search_contains "$obsidian_search" "Borealis obsidian updated marker" "Alpha.md" "sourceType" "obsidian_vault"
  OBSIDIAN_UPDATED_SEARCH="$obsidian_search" node <<'NODE'
const response = JSON.parse(process.env.OBSIDIAN_UPDATED_SEARCH);
const result = response.results?.[0];
const links = result?.metadata?.obsidianOutgoingLinks || [];
if (!links.includes('Gamma.md')) {
  console.error('updated Obsidian result is missing outgoing wikilink metadata');
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
NODE
  obsidian_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Celadon obsidian added marker","topK":5,"pathPrefix":"Gamma.md","filters":{"metadata":{"sourceType":"obsidian_vault"}}}')"
  truth_refresh_assert_search_contains "$obsidian_search" "Celadon obsidian added marker" "Gamma.md" "sourceType" "obsidian_vault"
  obsidian_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Beta obsidian retired marker","topK":5,"pathPrefix":"Beta.md","filters":{"metadata":{"sourceType":"obsidian_vault"}}}')"
  truth_refresh_assert_search_empty "$obsidian_search" "deleted Obsidian truth"

  smoke_section "Checking disabled webhook policy blocks automation but not manual refresh"
  put_json "/workspaces/$truth_kb_id/sources/$local_source_id/policy" '{"syncPolicy":{"triggerMode":"webhook","enabled":false,"webhookSecretRef":"truth-refresh-smoke","mode":"incremental","reason":"disabled webhook truth smoke"}}' >/dev/null
  cat >"$local_dir/guide.md" <<'EOF'
# Local truth guide

Indigo manual disabled-policy marker proves manual refresh still works while automation is disabled.
EOF
  job_id="$(truth_refresh_enqueue_refresh "$truth_kb_id" "$local_source_id" "manual refresh with disabled webhook policy")"
  wait_for_indexing_job "$job_id" "manual refresh while webhook disabled"
  truth_refresh_assert_refresh_job "$SMOKE_LAST_JOB_DETAIL" "manual" "manual refresh while webhook disabled"
  local_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Indigo manual disabled-policy marker","topK":5,"pathPrefix":"guide.md"}')"
  truth_refresh_assert_search_contains "$local_search" "Indigo manual disabled-policy marker" "guide.md"

  cat >"$local_dir/guide.md" <<'EOF'
# Local truth guide

Jade webhook disabled marker should not appear until the policy is enabled.
EOF
  local webhook_body webhook_status
  webhook_body="$(mktemp)"
  webhook_status="$(curl -sS -o "$webhook_body" -w '%{http_code}' -X POST "$API_URL/workspaces/$truth_kb_id/sources/$local_source_id/webhook" \
    -H "Content-Type: application/json" \
    -H "x-contextforge-webhook-secret: $SOURCE_TRIGGER_WEBHOOK_SECRET" \
    --data-binary '{"event":"truth-refresh-disabled-webhook"}')"
  if [[ "$webhook_status" =~ ^2 ]]; then
    smoke_fail "disabled webhook policy unexpectedly enqueued a refresh: $(cat "$webhook_body")"
  fi
  DISABLED_WEBHOOK_RESPONSE="$(cat "$webhook_body")" node <<'NODE'
const response = JSON.parse(process.env.DISABLED_WEBHOOK_RESPONSE);
if (response.error?.code !== 'source_trigger_not_enabled') {
  console.error('disabled webhook did not return source_trigger_not_enabled');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  rm -f "$webhook_body"
  local_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Jade webhook disabled marker","topK":5,"pathPrefix":"guide.md"}')"
  truth_refresh_assert_search_lacks_marker "$local_search" "Jade webhook disabled marker" "disabled webhook marker before enabled policy"

  smoke_section "Enabling webhook policy and applying automated refresh"
  put_json "/workspaces/$truth_kb_id/sources/$local_source_id/policy" '{"syncPolicy":{"triggerMode":"webhook","enabled":true,"webhookSecretRef":"truth-refresh-smoke","mode":"incremental","reason":"enabled webhook truth smoke"}}' >/dev/null
  local webhook_response
  webhook_response="$(curl -fsS -X POST "$API_URL/workspaces/$truth_kb_id/sources/$local_source_id/webhook" \
    -H "Content-Type: application/json" \
    -H "x-contextforge-webhook-secret: $SOURCE_TRIGGER_WEBHOOK_SECRET" \
    --data-binary '{"event":"truth-refresh-enabled-webhook","ref":"refs/heads/source-truth"}')"
  job_id="$(json_field "$webhook_response" "job.id")"
  if [[ -z "$job_id" ]]; then
    smoke_fail "enabled webhook did not return job id: $webhook_response"
  fi
  wait_for_indexing_job "$job_id" "enabled webhook truth refresh"
  truth_refresh_assert_refresh_job "$SMOKE_LAST_JOB_DETAIL" "webhook" "enabled webhook truth refresh"
  local_search="$(post_json "/workspaces/$truth_kb_id/search" '{"query":"Jade webhook disabled marker","topK":5,"pathPrefix":"guide.md"}')"
  truth_refresh_assert_search_contains "$local_search" "Jade webhook disabled marker" "guide.md"

  smoke_section "Truth refresh smoke passed"
}
