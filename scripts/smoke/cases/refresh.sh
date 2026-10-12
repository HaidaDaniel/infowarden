#!/usr/bin/env bash

write_url_fixture_page() {
  local page="$1"
  local marker="$2"
  local link="${3:-}"
  PAGE_PATH="$SMOKE_URL_SITE_DIR/$page" MARKER="$marker" LINK="$link" node <<'NODE'
const fs = require('fs');
const pagePath = process.env.PAGE_PATH;
const title = pagePath.endsWith('index.html') ? 'URL Smoke Home' : 'URL Smoke Guide';
const link = process.env.LINK
  ? `<a href="${process.env.LINK}">next</a>`
  : '';
fs.writeFileSync(pagePath, [
  '<!doctype html><html><head><title>',
  title,
  '</title></head><body><main><h1>',
  title,
  '</h1><p>Solstice URL marker stays searchable.</p>',
  '<p>Lantern URL marker stays searchable.</p>',
  `<p>${process.env.MARKER}</p>`,
  link,
  '</main></body></html>',
].join(''));
NODE
}

assert_refresh_job() {
  local job_detail="$1"
  local mode="$2"
  local trigger="$3"
  JOB_DETAIL="$job_detail" EXPECTED_MODE="$mode" EXPECTED_TRIGGER="$trigger" node <<'NODE'
const job = JSON.parse(process.env.JOB_DETAIL);
const stats = job.stats || {};
if (stats.refreshMode !== process.env.EXPECTED_MODE || stats.refreshTrigger !== process.env.EXPECTED_TRIGGER) {
  console.error('refresh job did not record expected mode/trigger');
  console.error(JSON.stringify(stats, null, 2));
  process.exit(1);
}
if ((stats.filesScanned || 0) < 2 || !stats.validationReportId) {
  console.error('refresh job stats are incomplete');
  console.error(JSON.stringify(stats, null, 2));
  process.exit(1);
}
NODE
}

smoke_case_refresh() {
  if [[ -z "$SMOKE_URL_KB_ID" || -z "$SMOKE_URL_SOURCE_ID" || -z "$SMOKE_URL_SITE_DIR" ]]; then
    smoke_note "refresh smoke requires the URL fixture; running url first"
    smoke_case_url
  fi

  smoke_section "Checking URL refresh dry-run"
  write_url_fixture_page "guide.html" "Cinder incremental marker proves dry-run detects URL changes."
  local dry_run_response
  dry_run_response="$(post_json "/workspaces/$SMOKE_URL_KB_ID/sources/$SMOKE_URL_SOURCE_ID/refresh" '{"mode":"incremental","dryRun":true,"reason":"preview url fixture update"}')"
  URL_DRY_RUN_RESPONSE="$dry_run_response" node <<'NODE'
const response = JSON.parse(process.env.URL_DRY_RUN_RESPONSE);
const stats = response.plan?.stats || {};
if (response.dryRun !== true || response.mode !== 'incremental' || (stats.changed || 0) < 1) {
  console.error('URL dry-run did not detect the changed page');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!response.preparedSource?.url?.fetchedUrls?.length) {
  console.error('URL dry-run did not include prepared URL metadata');
  console.error(JSON.stringify(response.preparedSource, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Applying URL incremental refresh"
  local refresh_response job_id search_response
  refresh_response="$(post_json "/workspaces/$SMOKE_URL_KB_ID/sources/$SMOKE_URL_SOURCE_ID/refresh" '{"mode":"incremental","reason":"apply url fixture update"}')"
  job_id="$(json_field "$refresh_response" "job.id")"
  wait_for_indexing_job "$job_id" "URL incremental refresh"
  assert_refresh_job "$SMOKE_LAST_JOB_DETAIL" "incremental" "manual"
  search_response="$(post_json "/workspaces/$SMOKE_URL_KB_ID/search" '{"query":"Cinder incremental marker","topK":5,"pathPrefix":"guide.html"}')"
  URL_REFRESH_SEARCH="$search_response" EXPECTED_TEXT="Cinder incremental marker" node <<'NODE'
const response = JSON.parse(process.env.URL_REFRESH_SEARCH);
if (!response.results?.some((item) => String(item.text || '').includes(process.env.EXPECTED_TEXT))) {
  console.error('incremental URL refresh marker was not searchable');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Applying force re-embed refresh"
  write_url_fixture_page "guide.html" "Ember force reembed marker proves explicit vector refresh."
  refresh_response="$(post_json "/workspaces/$SMOKE_URL_KB_ID/sources/$SMOKE_URL_SOURCE_ID/refresh" '{"mode":"force_reembed","reason":"force reembed url smoke"}')"
  job_id="$(json_field "$refresh_response" "job.id")"
  wait_for_indexing_job "$job_id" "URL force re-embed refresh"
  assert_refresh_job "$SMOKE_LAST_JOB_DETAIL" "force_reembed" "manual"

  smoke_section "Applying force re-chunk refresh"
  write_url_fixture_page "index.html" "Vector force rechunk marker proves explicit chunk refresh." "/guide.html"
  refresh_response="$(post_json "/workspaces/$SMOKE_URL_KB_ID/sources/$SMOKE_URL_SOURCE_ID/refresh" '{"mode":"force_rechunk","reason":"force rechunk url smoke"}')"
  job_id="$(json_field "$refresh_response" "job.id")"
  wait_for_indexing_job "$job_id" "URL force re-chunk refresh"
  assert_refresh_job "$SMOKE_LAST_JOB_DETAIL" "force_rechunk" "manual"

  smoke_section "Checking bounded rebuild collection dry-run"
  local rebuild_dry_run
  rebuild_dry_run="$(post_json "/workspaces/$SMOKE_URL_KB_ID/sources/$SMOKE_URL_SOURCE_ID/refresh" '{"mode":"rebuild_collection","dryRun":true,"reason":"bounded rebuild preview"}')"
  REBUILD_DRY_RUN_RESPONSE="$rebuild_dry_run" node <<'NODE'
const response = JSON.parse(process.env.REBUILD_DRY_RUN_RESPONSE);
if (response.dryRun !== true || response.mode !== 'rebuild_collection') {
  console.error('rebuild_collection dry-run did not return the requested mode');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking authenticated webhook refresh"
  put_json "/sources/$SMOKE_URL_SOURCE_ID" '{"syncPolicy":{"triggerMode":"webhook","enabled":true,"webhookSecretRef":"smoke-webhook-secret-ref","mode":"incremental","reason":"webhook url smoke"}}' >/dev/null
  write_url_fixture_page "guide.html" "Orbit webhook marker proves authenticated triggers enqueue refresh."
  local webhook_response
  webhook_response="$(curl -fsS -X POST "$API_URL/workspaces/$SMOKE_URL_KB_ID/sources/$SMOKE_URL_SOURCE_ID/webhook" \
    -H "Content-Type: application/json" \
    -H "x-contextforge-webhook-secret: $SOURCE_TRIGGER_WEBHOOK_SECRET" \
    --data-binary '{"event":"smoke-url-webhook","ref":"refs/heads/smoke"}')"
  job_id="$(json_field "$webhook_response" "job.id")"
  if [[ -z "$job_id" ]]; then
    smoke_fail "webhook refresh did not return job id: $webhook_response"
  fi
  wait_for_indexing_job "$job_id" "URL webhook refresh"
  assert_refresh_job "$SMOKE_LAST_JOB_DETAIL" "incremental" "webhook"
  URL_WEBHOOK_JOB="$SMOKE_LAST_JOB_DETAIL" node <<'NODE'
const job = JSON.parse(process.env.URL_WEBHOOK_JOB);
const metadata = job.stats?.refreshTriggerMetadata || {};
if (metadata.webhookEvent?.event !== 'smoke-url-webhook' || metadata.triggerMode !== 'webhook') {
  console.error('webhook refresh did not record trigger metadata');
  console.error(JSON.stringify(job.stats, null, 2));
  process.exit(1);
}
NODE
}
