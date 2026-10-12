#!/usr/bin/env bash

smoke_case_indexing() {
  smoke_section "Creating sample workspace"
  local kb_response
  kb_response="$(post_json "/knowledge-bases" "{\"name\":\"Smoke Test KB $(date -u +%Y%m%d%H%M%S)\",\"description\":\"Live Ubuntu smoke test\"}")"
  SMOKE_KB_ID="$(json_field "$kb_response" "id")"
  if [[ -z "$SMOKE_KB_ID" ]]; then
    smoke_fail "failed to create knowledge base: $kb_response"
  fi
  smoke_note "SMOKE_KB_ID=$SMOKE_KB_ID"

  smoke_section "Creating local folder source"
  local source_body source_response
  source_body="$(KB_ID="$SMOKE_KB_ID" SAMPLE_SOURCE_PATH="$SAMPLE_SOURCE_PATH" node -e 'process.stdout.write(JSON.stringify({knowledgeBaseId:process.env.KB_ID,type:"local_folder",uri:process.env.SAMPLE_SOURCE_PATH,includeRules:["**/*.md","**/*.ts"],excludeRules:["**/node_modules/**","**/dist/**"]}))')"
  source_response="$(post_json "/sources" "$source_body")"
  SMOKE_SOURCE_ID="$(json_field "$source_response" "id")"
  if [[ -z "$SMOKE_SOURCE_ID" ]]; then
    smoke_fail "failed to create source: $source_response"
  fi
  smoke_note "SMOKE_SOURCE_ID=$SMOKE_SOURCE_ID"

  smoke_section "Enqueueing indexing job"
  local job_body job_response
  job_body="$(KB_ID="$SMOKE_KB_ID" SOURCE_ID="$SMOKE_SOURCE_ID" node -e 'process.stdout.write(JSON.stringify({knowledgeBaseId:process.env.KB_ID,sourceId:process.env.SOURCE_ID,type:"scan_source"}))')"
  job_response="$(post_json "/jobs/indexing" "$job_body")"
  SMOKE_JOB_ID="$(json_field "$job_response" "id")"
  if [[ -z "$SMOKE_JOB_ID" ]]; then
    smoke_fail "failed to enqueue job: $job_response"
  fi
  smoke_note "SMOKE_JOB_ID=$SMOKE_JOB_ID"

  smoke_section "Polling indexing job"
  wait_for_indexing_job "$SMOKE_JOB_ID" "indexing job"

  JOB_DETAIL="$SMOKE_LAST_JOB_DETAIL" node <<'NODE'
const job = JSON.parse(process.env.JOB_DETAIL);
const stats = job.stats || {};
const required = ['filesScanned', 'filesParsed', 'chunksCreated', 'vectorsUpserted', 'validationReportId'];
const missing = required.filter((key) => stats[key] === undefined || stats[key] === null || (stats[key] === 0 && key !== 'validationReportId'));
if (missing.length) {
  console.error(`job stats missing expected values: ${missing.join(', ')}`);
  console.error(JSON.stringify(stats, null, 2));
  process.exit(1);
}
if (!Array.isArray(job.logs) || job.logs.length === 0) {
  console.error('job logs are missing');
  process.exit(1);
}
NODE
}
