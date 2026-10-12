#!/usr/bin/env bash

smoke_case_eval() {
  if [[ "$SMOKE_CORE_READY" != "1" ]]; then
    smoke_note "eval smoke requires the core stack; running core first"
    smoke_case_core
  fi

  smoke_section "Validating committed eval fixtures and baseline contract"
  pnpm eval:validate-fixtures >/dev/null

  smoke_section "Creating fixed-label eval workspace"
  local pack_dir suffix kb_response eval_kb_id source_response eval_source_id
  pack_dir="$ROOT_DIR/fixtures/eval/cf-smoke-mini"
  suffix="$(date -u +%Y%m%d%H%M%S)"
  kb_response="$(post_json "/knowledge-bases" "{
    \"name\":\"Eval Smoke KB $suffix\",
    \"slug\":\"eval-smoke-kb-$suffix\",
    \"description\":\"Fixed-label retrieval baseline smoke\",
    \"workspaceKind\":\"benchmarks\"
  }")"
  eval_kb_id="$(json_field "$kb_response" "id")"
  if [[ -z "$eval_kb_id" ]]; then
    smoke_fail "failed to create eval smoke workspace: $kb_response"
  fi
  source_response="$(post_json "/sources" "$(KB_ID="$eval_kb_id" SOURCE_URI="$pack_dir/documents" node <<'NODE'
process.stdout.write(JSON.stringify({
  knowledgeBaseId: process.env.KB_ID,
  type: 'local_folder',
  uri: process.env.SOURCE_URI,
  includeRules: ['**/*.md', '**/*.ts', '**/*.json', '**/*.html'],
  excludeRules: [],
}));
NODE
  )")"
  eval_source_id="$(json_field "$source_response" "id")"
  if [[ -z "$eval_source_id" ]]; then
    smoke_fail "failed to create eval source: $source_response"
  fi

  smoke_eval_index "$eval_kb_id" "$eval_source_id" "initial fixed-label eval pack index"
  smoke_eval_install_hybrid_profile "$eval_kb_id" "$suffix"
  smoke_eval_import_questions "$eval_kb_id" "$pack_dir"

  SMOKE_EVAL_KB_ID="$eval_kb_id"
  SMOKE_EVAL_SOURCE_ID="$eval_source_id"
  SMOKE_EVAL_DATASET_ID="cf-smoke-mini"
  SMOKE_EVAL_DATASET_VERSION="2026-07-18"
  SMOKE_EVAL_BASELINE_RUN_ID=""
  SMOKE_EVAL_HYBRID_RUN_ID=""
  export SMOKE_EVAL_KB_ID SMOKE_EVAL_SOURCE_ID SMOKE_EVAL_DATASET_ID SMOKE_EVAL_DATASET_VERSION
  export SMOKE_EVAL_BASELINE_RUN_ID SMOKE_EVAL_HYBRID_RUN_ID

  smoke_section "Running fixed-label default and hybrid baseline evals"
  local default_run hybrid_run
  default_run="$(smoke_eval_run_and_assert "$eval_kb_id" "default" "cf-smoke-mini default baseline")"
  SMOKE_EVAL_BASELINE_RUN_ID="$(json_field "$default_run" "id")"
  hybrid_run="$(smoke_eval_run_and_assert "$eval_kb_id" "cf-smoke-hybrid" "cf-smoke-mini hybrid baseline")"
  SMOKE_EVAL_HYBRID_RUN_ID="$(json_field "$hybrid_run" "id")"
  export SMOKE_EVAL_BASELINE_RUN_ID SMOKE_EVAL_HYBRID_RUN_ID

  smoke_section "Comparing same labels after source refresh"
  smoke_eval_index "$eval_kb_id" "$eval_source_id" "fixed-label eval refresh"
  smoke_eval_compare_after_change "$eval_kb_id" "$SMOKE_EVAL_BASELINE_RUN_ID" "default" "after refresh"

  smoke_section "Comparing same labels after canonical rebuild cutover and rollback"
  local operation operation_id rollback
  operation="$(post_json "/workspaces/$eval_kb_id/vector-operations" "{
    \"kind\":\"full_rebuild\",
    \"strategy\":\"canonical_reembed\",
    \"idempotencyKey\":\"eval-baseline-full-rebuild-$eval_kb_id\",
    \"rollbackRetentionHours\":1
  }")"
  operation_id="$(json_field "$operation" "id")"
  if [[ -z "$operation_id" ]]; then
    smoke_fail "eval baseline rebuild did not return operation id: $operation"
  fi
  wait_for_vector_operation_ready "$operation_id" "eval baseline canonical rebuild"
  post_json "/vector-operations/$operation_id/cutover" '{}' >/dev/null
  smoke_eval_compare_after_change "$eval_kb_id" "$SMOKE_EVAL_BASELINE_RUN_ID" "default" "after rebuild cutover"
  rollback="$(post_json "/vector-operations/$operation_id/rollback" '{}')"
  EVAL_REBUILD_ROLLBACK="$rollback" node <<'NODE'
const response = JSON.parse(process.env.EVAL_REBUILD_ROLLBACK);
if (response.state !== 'rollback_complete') {
  console.error('eval baseline rebuild rollback did not complete');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  smoke_eval_compare_after_change "$eval_kb_id" "$SMOKE_EVAL_BASELINE_RUN_ID" "default" "after rebuild rollback"

  smoke_section "Comparing same labels after unload/load"
  post_json "/workspaces/$eval_kb_id/unload" '{}' >/dev/null
  local load_response load_job_id
  load_response="$(post_json "/workspaces/$eval_kb_id/load" '{"storageProfile":"low_memory"}')"
  load_job_id="$(json_field "$load_response" "job.id")"
  if [[ -n "$load_job_id" ]]; then
    wait_for_indexing_job "$load_job_id" "eval baseline load rebuild"
  fi
  smoke_eval_compare_after_change "$eval_kb_id" "$SMOKE_EVAL_BASELINE_RUN_ID" "default" "after load"

  SMOKE_KB_ID="$eval_kb_id"
  SMOKE_SOURCE_ID="$eval_source_id"
  export SMOKE_KB_ID SMOKE_SOURCE_ID
}

smoke_eval_index() {
  local kb_id="$1"
  local source_id="$2"
  local label="$3"
  local job_body job_response job_id
  job_body="$(KB_ID="$kb_id" SOURCE_ID="$source_id" node <<'NODE'
process.stdout.write(JSON.stringify({
  knowledgeBaseId: process.env.KB_ID,
  sourceId: process.env.SOURCE_ID,
  type: 'scan_source',
}));
NODE
  )"
  job_response="$(post_json "/jobs/indexing" "$job_body")"
  job_id="$(json_field "$job_response" "id")"
  if [[ -z "$job_id" ]]; then
    smoke_fail "$label did not enqueue: $job_response"
  fi
  wait_for_indexing_job "$job_id" "$label"
}

smoke_eval_install_hybrid_profile() {
  local kb_id="$1"
  local suffix="$2"
  local apply_body apply_response
  apply_body="$(KB_ID="$kb_id" SUFFIX="$suffix" node <<'NODE'
process.stdout.write(JSON.stringify({
  manifest: {
    formatVersion: 'workspace-export-manifest.v1',
    workspace: {
      slug: `eval-smoke-kb-${process.env.SUFFIX}`,
      name: `Eval Smoke KB ${process.env.SUFFIX}`,
      description: 'Fixed-label retrieval baseline smoke',
      kind: 'benchmarks',
      defaultIndexProfile: 'default',
      defaultRetrievalProfile: 'default',
    },
    sources: [],
    retrievalProfiles: [{
      id: 'cf-smoke-hybrid-profile',
      key: 'cf-smoke-hybrid',
      name: 'CF Smoke Hybrid',
      intent: 'general_search',
      denseTopK: 8,
      neighborBefore: 0,
      neighborAfter: 0,
      grouping: 'document',
      recencyBoost: false,
      metadata: {
        hybridSearch: true,
        lexicalTopK: 5,
        denseWeight: 0.6,
        lexicalWeight: 0.4,
      },
    }],
    memoryEntries: [],
    indexVersions: [],
  },
  targetWorkspace: { id: process.env.KB_ID, updateExisting: true },
  enqueueReindex: false,
}));
NODE
  )"
  apply_response="$(post_json "/workspaces/import-manifest/apply" "$apply_body")"
  EVAL_PROFILE_APPLY="$apply_response" node <<'NODE'
const response = JSON.parse(process.env.EVAL_PROFILE_APPLY);
if (response.applied !== true || response.restored?.retrievalProfiles !== 1) {
  console.error('eval hybrid profile was not applied');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}

smoke_eval_import_questions() {
  local kb_id="$1"
  local pack_dir="$2"
  API_URL="$API_URL" KB_ID="$kb_id" PACK_DIR="$pack_dir" node <<'NODE'
const fs = require('fs');
const path = require('path');

const headers = { 'Content-Type': 'application/json' };
const apiKey = process.env.CONTEXTFORGE_API_KEY || process.env.ADMIN_API_KEY;
if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

const manifest = JSON.parse(fs.readFileSync(path.join(process.env.PACK_DIR, 'manifest.json'), 'utf8'));
const documentsById = new Map(manifest.documents.map((document) => [document.id, document]));
const questions = fs
  .readFileSync(path.join(process.env.PACK_DIR, manifest.questionsPath), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

function runtimePath(documentId) {
  const document = documentsById.get(documentId);
  if (!document) return undefined;
  return document.path.replace(`${manifest.documentsPath}/`, '');
}

async function main() {
  for (const question of questions) {
    const fixedDocumentLabels = new Set(question.expectedDocumentIds || []);
    for (const documentId of question.expectedDocumentIds || []) {
      const pathLabel = runtimePath(documentId);
      if (pathLabel) fixedDocumentLabels.add(pathLabel);
    }
    const response = await fetch(`${process.env.API_URL}/workspaces/${process.env.KB_ID}/eval/questions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: question.text,
        expectedDocumentIds: [...fixedDocumentLabels],
        expectedChunkIds: [],
        metadata: {
          ...(question.metadata || {}),
          fixtureQuestionId: question.id,
          datasetId: manifest.id,
          datasetVersion: manifest.version,
          fixedLabels: true,
          labelsSource: `${manifest.id}@${manifest.version}`,
          expectedChunkHints: question.expectedChunkHints || [],
          tags: question.tags || [],
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`failed to import ${question.id}: HTTP ${response.status} ${await response.text()}`);
    }
  }
  console.log(`imported ${questions.length} fixed eval questions`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
}

smoke_eval_run_and_assert() {
  local kb_id="$1"
  local profile_key="$2"
  local name="$3"
  local run_body run_response run_file
  run_body="$(PROFILE_KEY="$profile_key" NAME="$name" node <<'NODE'
process.stdout.write(JSON.stringify({
  name: process.env.NAME,
  datasetId: 'cf-smoke-mini',
  datasetVersion: '2026-07-18',
  profileKey: process.env.PROFILE_KEY,
  topK: 5,
  rerank: { enabled: false },
}));
NODE
)"
  run_response="$(post_json "/workspaces/$kb_id/eval/runs" "$run_body")"
  run_file="$(mktemp)"
  printf '%s' "$run_response" >"$run_file"
  node scripts/benchmarks/assert-eval-baseline.mjs --baseline fixtures/eval/cf-smoke-mini/baseline.json --profile "$profile_key" --run-json "$run_file" >/dev/null
  rm -f "$run_file"
  printf '%s' "$run_response"
}

smoke_eval_compare_after_change() {
  local kb_id="$1"
  local baseline_run_id="$2"
  local profile_key="$3"
  local label="$4"
  local candidate comparison candidate_id
  candidate="$(smoke_eval_run_and_assert "$kb_id" "$profile_key" "cf-smoke-mini $label")"
  candidate_id="$(json_field "$candidate" "id")"
  comparison="$(post_json "/workspaces/$kb_id/eval/run-comparison" "$(BASELINE_RUN_ID="$baseline_run_id" CANDIDATE_RUN_ID="$candidate_id" node <<'NODE'
process.stdout.write(JSON.stringify({
  baselineRunId: process.env.BASELINE_RUN_ID,
  candidateRunId: process.env.CANDIDATE_RUN_ID,
}));
NODE
  )")"
  EVAL_COMPARISON="$comparison" LABEL="$label" node <<'NODE'
const response = JSON.parse(process.env.EVAL_COMPARISON);
const deltas = response.metricDeltas || {};
for (const key of ['hitAtK', 'hitAt3', 'mrr', 'expectedDocumentHitRate']) {
  if (typeof deltas[key] === 'number' && deltas[key] < -0.000001) {
    console.error(`${process.env.LABEL} regressed ${key}`);
    console.error(JSON.stringify(response, null, 2));
    process.exit(1);
  }
}
if (typeof deltas.emptyResultRate === 'number' && deltas.emptyResultRate > 0.000001) {
  console.error(`${process.env.LABEL} increased emptyResultRate`);
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}
