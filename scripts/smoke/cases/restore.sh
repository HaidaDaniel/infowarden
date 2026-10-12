#!/usr/bin/env bash

smoke_case_restore() {
  if [[ -z "$SMOKE_URL_KB_ID" || -z "$SMOKE_URL_SOURCE_ID" ]]; then
    smoke_note "restore smoke needs a refreshed URL workspace; running refresh first"
    smoke_case_refresh
  fi

  smoke_section "Validating and applying workspace restore manifest"
  local manifest_response restore_body validate_response apply_response
  manifest_response="$(get_json "/workspaces/$SMOKE_URL_KB_ID/export-manifest")"
  restore_body="$(
    MANIFEST="$manifest_response" node <<'NODE'
const manifest = JSON.parse(process.env.MANIFEST);
const suffix = Date.now().toString(36);
process.stdout.write(JSON.stringify({
  manifest,
  targetWorkspace: {
    slug: `${manifest.workspace.slug}-restore-${suffix}`,
    name: `${manifest.workspace.name} restored ${suffix}`,
    updateExisting: false,
  },
  enqueueReindex: false,
}));
NODE
  )"
  validate_response="$(post_json "/workspaces/import-manifest/validate" "$restore_body")"
  RESTORE_VALIDATE_RESPONSE="$validate_response" node <<'NODE'
const response = JSON.parse(process.env.RESTORE_VALIDATE_RESPONSE);
const warnings = new Set((response.warnings || []).map((item) => item.code));
if (response.valid !== true || response.counts?.sources < 1 || !warnings.has('restore_reindex_required') || !warnings.has('restore_reindex_not_enqueued')) {
  console.error('restore validation did not return the expected safe metadata-only plan');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  apply_response="$(post_json "/workspaces/import-manifest/apply" "$restore_body")"
  RESTORE_APPLY_RESPONSE="$apply_response" node <<'NODE'
const response = JSON.parse(process.env.RESTORE_APPLY_RESPONSE);
if (response.applied !== true || response.restored?.sources < 1 || response.reindexJobs?.length !== 0) {
  console.error('restore apply did not create a metadata-only workspace');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!response.nextActions?.includes('enqueue_source_reindex_when_ready')) {
  console.error('restore apply did not expose the expected next action');
  console.error(JSON.stringify(response.nextActions, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking index version compare and rollback readiness"
  local compare_path compare_response
  compare_path="$(
    MANIFEST="$manifest_response" node <<'NODE'
const manifest = JSON.parse(process.env.MANIFEST);
const versions = manifest.indexVersions || [];
if (versions.length < 2) {
  console.error('restore smoke requires at least two index versions; run refresh smoke first');
  process.exit(1);
}
const newest = versions[0].id;
const oldest = versions[versions.length - 1].id;
process.stdout.write(`/workspaces/${manifest.workspace.id}/index-versions/compare?base=${encodeURIComponent(newest)}&target=${encodeURIComponent(oldest)}`);
NODE
  )"
  compare_response="$(get_json "$compare_path")"
  INDEX_COMPARE_RESPONSE="$compare_response" node <<'NODE'
const response = JSON.parse(process.env.INDEX_COMPARE_RESPONSE);
if (!response.base?.provider?.embeddingModel || !response.target?.provider?.embeddingDimension) {
  console.error('index compare did not include provider summaries');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (typeof response.comparison?.documentCountDelta !== 'number' || !response.comparison?.rollback?.code) {
  console.error('index compare did not include deltas and rollback readiness');
  console.error(JSON.stringify(response.comparison, null, 2));
  process.exit(1);
}
if (response.comparison.rollback.safe !== false || response.comparison.rollback.code !== 'index_rollback_blocked_mutable_collection') {
  console.error('mutable collection rollback readiness should be explicitly blocked');
  console.error(JSON.stringify(response.comparison.rollback, null, 2));
  process.exit(1);
}
NODE
}
