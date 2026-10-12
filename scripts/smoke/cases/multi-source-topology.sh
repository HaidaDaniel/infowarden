#!/usr/bin/env bash

smoke_case_multi_source_topology() {
  if [[ "$SMOKE_CORE_READY" != "1" ]]; then
    smoke_note "multi-source topology smoke requires the core stack; running core first"
    smoke_case_core
  fi

  smoke_section "Creating multi-source topology fixtures"
  SMOKE_MULTI_SOURCE_TMP_DIR="$(mktemp -d)"
  local suffix workspace_name workspace_slug local_dir vault_dir upload_archive
  suffix="$(date -u +%Y%m%d%H%M%S)"
  workspace_name="Multi Source Topology Smoke $suffix"
  workspace_slug="multi-source-smoke-$suffix"
  local_dir="$SMOKE_MULTI_SOURCE_TMP_DIR/local"
  vault_dir="$SMOKE_MULTI_SOURCE_TMP_DIR/vault"
  upload_archive="$SMOKE_MULTI_SOURCE_TMP_DIR/upload.zip"
  mkdir -p "$local_dir/src" "$vault_dir/.obsidian"

  cat >"$local_dir/local-guide.md" <<'EOF'
# Multi source local guide

Cobalt multi local marker proves one local folder source participates in the same serving manifest.
This fixture also describes search functionality, document parsing and search, and retrieval topology checks.
EOF
  cat >"$local_dir/src/multi-source-search.ts" <<'EOF'
export function multiSourceSearchDocuments(query: string) {
  return `multiSourceSearchDocuments function handles ${query}`;
}
EOF
  cat >"$local_dir/retired.md" <<'EOF'
# Retired local note

Retired multi local marker should disappear after incremental refresh.
EOF
  cat >"$vault_dir/Alpha.md" <<'EOF'
---
topic: multi-source-topology
---
# Alpha

Indigo multi obsidian marker links to [[Beta]] and keeps #multi-source-topology.
EOF
  cat >"$vault_dir/Beta.md" <<'EOF'
# Beta

Violet multi obsidian marker proves a second vault note is available.
EOF
  echo '{"legacyEditor":false}' >"$vault_dir/.obsidian/app.json"

  MULTI_SOURCE_UPLOAD_ARCHIVE="$upload_archive" node <<'NODE'
const fs = require('fs');

function storedZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const fileName = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, fileName, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, fileName);
    offset += localHeader.length + fileName.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(process.env.MULTI_SOURCE_UPLOAD_ARCHIVE, Buffer.concat([...localParts, centralDirectory, end]));
}

storedZip({
  'upload-notes.md': [
    '# Managed upload note',
    '',
    'Amber multi upload marker proves a managed upload source participates in the same serving manifest.',
    'The upload fixture discusses multi source topology and retrieval evidence.',
  ].join('\n'),
});
NODE

  smoke_section "Creating multi-source topology workspace"
  local kb_response kb_id local_source_response local_source_id obsidian_source_response obsidian_source_id upload_response upload_source_id
  kb_response="$(post_json "/knowledge-bases" "$(MULTI_SOURCE_WORKSPACE_NAME="$workspace_name" MULTI_SOURCE_WORKSPACE_SLUG="$workspace_slug" node <<'NODE'
process.stdout.write(JSON.stringify({
  name: process.env.MULTI_SOURCE_WORKSPACE_NAME,
  slug: process.env.MULTI_SOURCE_WORKSPACE_SLUG,
  description: 'Live smoke workspace with local folder, Obsidian vault, and managed upload sources.',
  workspaceKind: 'docs',
}));
NODE
  )")"
  kb_id="$(json_field "$kb_response" "id")"
  if [[ -z "$kb_id" ]]; then
    smoke_fail "failed to create multi-source workspace: $kb_response"
  fi
  smoke_note "SMOKE_MULTI_SOURCE_KB_ID=$kb_id"

  local_source_response="$(post_json "/sources" "$(KB_ID="$kb_id" SOURCE_URI="$local_dir" node <<'NODE'
process.stdout.write(JSON.stringify({
  knowledgeBaseId: process.env.KB_ID,
  type: 'local_folder',
  uri: process.env.SOURCE_URI,
  includeRules: ['**/*.md', '**/*.ts'],
  excludeRules: ['**/node_modules/**', '**/dist/**'],
}));
NODE
  )")"
  local_source_id="$(json_field "$local_source_response" "id")"
  obsidian_source_response="$(post_json "/sources" "$(KB_ID="$kb_id" SOURCE_URI="$vault_dir" node <<'NODE'
process.stdout.write(JSON.stringify({
  knowledgeBaseId: process.env.KB_ID,
  type: 'obsidian_vault',
  uri: process.env.SOURCE_URI,
  includeRules: ['**/*.md'],
  excludeRules: ['**/.obsidian/**'],
}));
NODE
  )")"
  obsidian_source_id="$(json_field "$obsidian_source_response" "id")"
  upload_response="$(post_multipart_file "/workspaces/$kb_id/sources/upload" "$upload_archive" \
    -F 'includeRules=["**/*.md"]' \
    -F "sourceName=multi source managed upload")"
  upload_source_id="$(json_field "$upload_response" "source.id")"
  if [[ -z "$local_source_id" || -z "$obsidian_source_id" || -z "$upload_source_id" ]]; then
    smoke_fail "failed to create all multi-source inputs"
  fi

  smoke_section "Indexing all active multi-source inputs"
  smoke_multi_source_index "$kb_id" "$local_source_id" "initial local source"
  smoke_multi_source_index "$kb_id" "$obsidian_source_id" "initial Obsidian source"
  smoke_multi_source_index "$kb_id" "$upload_source_id" "initial upload source"

  SMOKE_MULTI_SOURCE_KB_ID="$kb_id"
  SMOKE_MULTI_SOURCE_LOCAL_SOURCE_ID="$local_source_id"
  SMOKE_MULTI_SOURCE_OBSIDIAN_SOURCE_ID="$obsidian_source_id"
  SMOKE_MULTI_SOURCE_UPLOAD_SOURCE_ID="$upload_source_id"
  SMOKE_KB_ID="$kb_id"
  SMOKE_SOURCE_ID="$local_source_id"
  SMOKE_EXPECTED_SOURCE_REVISION_COUNT=3
  SMOKE_VERIFY_QUERY="search functionality"
  export SMOKE_MULTI_SOURCE_KB_ID SMOKE_MULTI_SOURCE_LOCAL_SOURCE_ID
  export SMOKE_MULTI_SOURCE_OBSIDIAN_SOURCE_ID SMOKE_MULTI_SOURCE_UPLOAD_SOURCE_ID
  export SMOKE_KB_ID SMOKE_SOURCE_ID SMOKE_EXPECTED_SOURCE_REVISION_COUNT SMOKE_VERIFY_QUERY

  smoke_multi_source_install_hybrid_profile "$kb_id" "$workspace_slug" "$workspace_name"

  smoke_section "Asserting initial 3-source serving manifest"
  local initial_manifest
  initial_manifest="$(smoke_multi_source_manifest "$kb_id")"
  smoke_multi_source_assert_manifest "$initial_manifest" 3 "local_folder,obsidian_vault,upload"
  smoke_multi_source_assert_rest_surfaces "$kb_id"
  smoke_multi_source_assert_context_eval_and_mcp "$kb_id" "$initial_manifest"
  smoke_multi_source_assert_live_studio "$kb_id" "$workspace_name"

  smoke_section "Injecting failed refresh and checking manifest immutability"
  local missing_dir failed_response failed_job_id failed_manifest
  missing_dir="$SMOKE_MULTI_SOURCE_TMP_DIR/missing-local"
  put_json "/sources/$local_source_id" "$(SOURCE_URI="$missing_dir" node <<'NODE'
process.stdout.write(JSON.stringify({ uri: process.env.SOURCE_URI }));
NODE
  )" >/dev/null
  failed_response="$(post_json "/workspaces/$kb_id/sources/$local_source_id/refresh" '{"mode":"incremental","reason":"intentional missing local source"}')"
  failed_job_id="$(json_field "$failed_response" "job.id")"
  if [[ -z "$failed_job_id" ]]; then
    smoke_fail "failed refresh did not enqueue a job: $failed_response"
  fi
  wait_for_indexing_job_status "$failed_job_id" "intentional missing local refresh" "failed"
  failed_manifest="$(smoke_multi_source_manifest "$kb_id")"
  smoke_multi_source_assert_same_manifest "$initial_manifest" "$failed_manifest" "failed refresh changed active manifest"
  put_json "/sources/$local_source_id" "$(SOURCE_URI="$local_dir" node <<'NODE'
process.stdout.write(JSON.stringify({ uri: process.env.SOURCE_URI, status: 'active' }));
NODE
  )" >/dev/null

  smoke_section "Refreshing one source with add/change/delete"
  cat >"$local_dir/local-guide.md" <<'EOF'
# Multi source local guide

Emerald multi local updated marker proves a changed local document replaces prior retrieval text.
This changed fixture still describes search functionality and document parsing and search.
EOF
  cat >"$local_dir/added.md" <<'EOF'
# Added local note

Silver multi local added marker proves new source truth appears after refresh.
EOF
  rm "$local_dir/retired.md"
  local dry_run_response refresh_manifest
  dry_run_response="$(post_json "/workspaces/$kb_id/sources/$local_source_id/refresh" '{"mode":"incremental","dryRun":true,"reason":"preview multi-source local refresh"}')"
  truth_refresh_assert_dry_run_counts "$dry_run_response" "multi-source local"
  smoke_multi_source_index "$kb_id" "$local_source_id" "multi-source local add/change/delete refresh"
  refresh_manifest="$(smoke_multi_source_manifest "$kb_id")"
  smoke_multi_source_assert_manifest "$refresh_manifest" 3 "local_folder,obsidian_vault,upload"
  smoke_multi_source_assert_revision_change "$initial_manifest" "$refresh_manifest" "$local_source_id" "$obsidian_source_id" "$upload_source_id"
  smoke_multi_source_assert_refresh_results "$kb_id"
  smoke_multi_source_persist_candidate_probe_question "$kb_id"

  smoke_section "Canonical rebuilding, cutting over, and rolling back 3-source manifest"
  smoke_multi_source_full_rebuild "$kb_id"

  smoke_section "Unload/load 3-source workspace"
  smoke_multi_source_unload_load "$kb_id"

  smoke_section "Checking failed backend move target"
  smoke_multi_source_failed_move_guard "$kb_id"

  smoke_section "Multi-source topology smoke passed"
}

smoke_multi_source_disable_upload_after_move() {
  if [[ -z "${SMOKE_MULTI_SOURCE_KB_ID:-}" || -z "${SMOKE_MULTI_SOURCE_LOCAL_SOURCE_ID:-}" || -z "${SMOKE_MULTI_SOURCE_UPLOAD_SOURCE_ID:-}" || -z "${SMOKE_MULTI_SOURCE_TMP_DIR:-}" ]]; then
    smoke_fail "multi-source disable check requires the multi-source topology smoke to run first"
  fi

  smoke_section "Disabling upload source and checking next manifest semantics"
  local kb_id="$SMOKE_MULTI_SOURCE_KB_ID"
  local local_source_id="$SMOKE_MULTI_SOURCE_LOCAL_SOURCE_ID"
  local upload_source_id="$SMOKE_MULTI_SOURCE_UPLOAD_SOURCE_ID"
  local local_dir="$SMOKE_MULTI_SOURCE_TMP_DIR/local"
  put_json "/sources/$upload_source_id" '{"status":"disabled"}' >/dev/null
  cat >"$local_dir/local-guide.md" <<'EOF'
# Multi source local guide

Copper multi local after-disable marker proves a refresh activates only active sources.
Search functionality remains available after disabling the upload source.
EOF
  smoke_multi_source_index "$kb_id" "$local_source_id" "local refresh after upload disable"
  local disabled_manifest disabled_upload_search
  disabled_manifest="$(smoke_multi_source_manifest "$kb_id")"
  smoke_multi_source_assert_manifest "$disabled_manifest" 2 "local_folder,obsidian_vault"
  disabled_upload_search="$(post_json "/workspaces/$kb_id/search" '{"query":"Amber multi upload marker","topK":5,"pathPrefix":"upload-notes.md"}')"
  truth_refresh_assert_search_empty "$disabled_upload_search" "disabled upload source"
  smoke_multi_source_assert_search_contains "$kb_id" "Copper multi local after-disable marker" "local-guide.md"
  smoke_multi_source_assert_search_contains "$kb_id" "Indigo multi obsidian marker" "Alpha.md"

  SMOKE_EXPECTED_SOURCE_REVISION_COUNT=2
  export SMOKE_EXPECTED_SOURCE_REVISION_COUNT
}

smoke_multi_source_index() {
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

smoke_multi_source_manifest() {
  KB_ID="$1" node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const kb = await prisma.knowledgeBase.findUnique({
    where: { id: process.env.KB_ID },
    select: {
      id: true,
      activeServingRevisionId: true,
      activeServingRevision: {
        select: {
          id: true,
          manifestHash: true,
          status: true,
          manifestEntries: {
            orderBy: { position: 'asc' },
            select: {
              position: true,
              sourceRevision: {
                select: {
                  id: true,
                  sourceId: true,
                  documentCount: true,
                  contentHash: true,
                  status: true,
                  source: {
                    select: {
                      id: true,
                      type: true,
                      status: true,
                      uri: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!kb?.activeServingRevision) {
    throw new Error(`workspace ${process.env.KB_ID} has no active serving revision`);
  }
  process.stdout.write(JSON.stringify({
    knowledgeBaseId: kb.id,
    servingRevisionId: kb.activeServingRevisionId,
    manifestHash: kb.activeServingRevision.manifestHash,
    status: kb.activeServingRevision.status,
    entries: kb.activeServingRevision.manifestEntries.map((entry) => ({
      position: entry.position,
      sourceRevisionId: entry.sourceRevision.id,
      sourceId: entry.sourceRevision.sourceId,
      sourceType: entry.sourceRevision.source.type,
      sourceStatus: entry.sourceRevision.source.status,
      sourceUri: entry.sourceRevision.source.uri,
      revisionStatus: entry.sourceRevision.status,
      documentCount: entry.sourceRevision.documentCount,
      contentHash: entry.sourceRevision.contentHash,
    })),
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
NODE
}

smoke_multi_source_assert_manifest() {
  local manifest="$1"
  local expected_count="$2"
  local expected_types="$3"
  MULTI_SOURCE_MANIFEST="$manifest" EXPECTED_COUNT="$expected_count" EXPECTED_TYPES="$expected_types" node <<'NODE'
const manifest = JSON.parse(process.env.MULTI_SOURCE_MANIFEST);
const expectedCount = Number(process.env.EXPECTED_COUNT);
const expectedTypes = new Set(process.env.EXPECTED_TYPES.split(',').filter(Boolean));
if (!manifest.servingRevisionId || !manifest.manifestHash || manifest.status !== 'active') {
  console.error('manifest is not active');
  console.error(JSON.stringify(manifest, null, 2));
  process.exit(1);
}
if (manifest.entries.length !== expectedCount) {
  console.error(`expected ${expectedCount} manifest entries`);
  console.error(JSON.stringify(manifest, null, 2));
  process.exit(1);
}
const types = new Set(manifest.entries.map((entry) => entry.sourceType));
for (const type of expectedTypes) {
  if (!types.has(type)) {
    console.error(`manifest missing source type ${type}`);
    console.error(JSON.stringify(manifest.entries, null, 2));
    process.exit(1);
  }
}
for (const entry of manifest.entries) {
  if (entry.sourceStatus !== 'active' || entry.revisionStatus !== 'ready' || entry.documentCount < 1) {
    console.error('manifest entry is not an active ready source revision with documents');
    console.error(JSON.stringify(entry, null, 2));
    process.exit(1);
  }
}
NODE
}

smoke_multi_source_assert_same_manifest() {
  local before="$1"
  local after="$2"
  local message="$3"
  BEFORE_MANIFEST="$before" AFTER_MANIFEST="$after" MESSAGE="$message" node <<'NODE'
const before = JSON.parse(process.env.BEFORE_MANIFEST);
const after = JSON.parse(process.env.AFTER_MANIFEST);
if (before.servingRevisionId !== after.servingRevisionId || before.manifestHash !== after.manifestHash) {
  console.error(process.env.MESSAGE);
  console.error(JSON.stringify({ before, after }, null, 2));
  process.exit(1);
}
NODE
}

smoke_multi_source_assert_revision_change() {
  local before="$1"
  local after="$2"
  local changed_source_id="$3"
  local stable_source_id_a="$4"
  local stable_source_id_b="$5"
  BEFORE_MANIFEST="$before" AFTER_MANIFEST="$after" CHANGED_SOURCE_ID="$changed_source_id" STABLE_SOURCE_ID_A="$stable_source_id_a" STABLE_SOURCE_ID_B="$stable_source_id_b" node <<'NODE'
const before = JSON.parse(process.env.BEFORE_MANIFEST);
const after = JSON.parse(process.env.AFTER_MANIFEST);
const beforeBySource = new Map(before.entries.map((entry) => [entry.sourceId, entry]));
const afterBySource = new Map(after.entries.map((entry) => [entry.sourceId, entry]));
if (before.manifestHash === after.manifestHash || before.servingRevisionId === after.servingRevisionId) {
  console.error('refresh did not activate a new manifest');
  console.error(JSON.stringify({ before, after }, null, 2));
  process.exit(1);
}
if (beforeBySource.get(process.env.CHANGED_SOURCE_ID)?.sourceRevisionId === afterBySource.get(process.env.CHANGED_SOURCE_ID)?.sourceRevisionId) {
  console.error('changed source revision id did not change');
  console.error(JSON.stringify({ before, after }, null, 2));
  process.exit(1);
}
for (const sourceId of [process.env.STABLE_SOURCE_ID_A, process.env.STABLE_SOURCE_ID_B]) {
  if (beforeBySource.get(sourceId)?.sourceRevisionId !== afterBySource.get(sourceId)?.sourceRevisionId) {
    console.error(`unchanged source ${sourceId} revision id changed`);
    console.error(JSON.stringify({ before, after }, null, 2));
    process.exit(1);
  }
}
NODE
}

smoke_multi_source_assert_search_contains() {
  local kb_id="$1"
  local marker="$2"
  local path="$3"
  local search_body search_response
  search_body="$(MARKER="$marker" PATH_PREFIX="$path" node <<'NODE'
process.stdout.write(JSON.stringify({
  query: process.env.MARKER,
  topK: 5,
  pathPrefix: process.env.PATH_PREFIX,
}));
NODE
  )"
  search_response="$(post_json "/workspaces/$kb_id/search" "$search_body")"
  truth_refresh_assert_search_contains "$search_response" "$marker" "$path"
}

smoke_multi_source_assert_rest_surfaces() {
  local kb_id="$1"
  local local_search obsidian_search upload_search code_search trace_response
  local_search="$(post_json "/workspaces/$kb_id/search" '{"query":"Cobalt multi local marker","topK":5,"pathPrefix":"local-guide.md"}')"
  truth_refresh_assert_search_contains "$local_search" "Cobalt multi local marker" "local-guide.md"
  obsidian_search="$(post_json "/workspaces/$kb_id/search" '{"query":"Indigo multi obsidian marker","topK":5,"pathPrefix":"Alpha.md","filters":{"metadata":{"sourceType":"obsidian_vault"}}}')"
  truth_refresh_assert_search_contains "$obsidian_search" "Indigo multi obsidian marker" "Alpha.md" "sourceType" "obsidian_vault"
  upload_search="$(post_json "/workspaces/$kb_id/search" '{"query":"Amber multi upload marker","topK":5,"pathPrefix":"upload-notes.md"}')"
  truth_refresh_assert_search_contains "$upload_search" "Amber multi upload marker" "upload-notes.md"
  code_search="$(post_json "/workspaces/$kb_id/search-code" '{"query":"multiSourceSearchDocuments function","topK":5,"language":"typescript","pathPrefix":"src/multi-source-search.ts"}')"
  truth_refresh_assert_search_contains "$code_search" "multiSourceSearchDocuments function" "src/multi-source-search.ts"

  trace_response="$(post_json "/workspaces/$kb_id/retrieval-trace" '{"query":"Cobalt multi local marker","topK":5,"profileKey":"multi-source-hybrid","tokenBudget":1000}')"
  MULTI_SOURCE_TRACE="$trace_response" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_TRACE);
if (response.retrievalProfile?.key !== 'multi-source-hybrid' || response.retrievalProfile?.lexicalEnabled !== true) {
  console.error('hybrid trace did not use the multi-source hybrid profile');
  console.error(JSON.stringify(response.retrievalProfile, null, 2));
  process.exit(1);
}
if (!response.stages?.denseCandidates?.length || !response.stages?.lexicalCandidates?.length) {
  console.error('hybrid trace did not expose dense and lexical candidates');
  console.error(JSON.stringify(response.stages, null, 2));
  process.exit(1);
}
if ((response.diagnostics?.serving?.sourceRevisionIds || []).length !== 3) {
  console.error('trace diagnostics did not carry all three source revisions');
  console.error(JSON.stringify(response.diagnostics?.serving, null, 2));
  process.exit(1);
}
NODE
}

smoke_multi_source_assert_refresh_results() {
  local kb_id="$1"
  local updated_search added_search deleted_search obsidian_search upload_search
  updated_search="$(post_json "/workspaces/$kb_id/search" '{"query":"Emerald multi local updated marker","topK":5,"pathPrefix":"local-guide.md"}')"
  truth_refresh_assert_search_contains "$updated_search" "Emerald multi local updated marker" "local-guide.md"
  added_search="$(post_json "/workspaces/$kb_id/search" '{"query":"Silver multi local added marker","topK":5,"pathPrefix":"added.md"}')"
  truth_refresh_assert_search_contains "$added_search" "Silver multi local added marker" "added.md"
  deleted_search="$(post_json "/workspaces/$kb_id/search" '{"query":"Retired multi local marker","topK":5,"pathPrefix":"retired.md"}')"
  truth_refresh_assert_search_empty "$deleted_search" "retired local source"
  obsidian_search="$(post_json "/workspaces/$kb_id/search" '{"query":"Indigo multi obsidian marker","topK":5,"pathPrefix":"Alpha.md"}')"
  truth_refresh_assert_search_contains "$obsidian_search" "Indigo multi obsidian marker" "Alpha.md"
  upload_search="$(post_json "/workspaces/$kb_id/search" '{"query":"Amber multi upload marker","topK":5,"pathPrefix":"upload-notes.md"}')"
  truth_refresh_assert_search_contains "$upload_search" "Amber multi upload marker" "upload-notes.md"
}

smoke_multi_source_persist_candidate_probe_question() {
  local kb_id="$1"
  local search_response question_body question_response
  search_response="$(post_json "/workspaces/$kb_id/search" '{"query":"Emerald multi local updated marker","topK":3,"pathPrefix":"local-guide.md"}')"
  question_body="$(SEARCH_RESPONSE="$search_response" DATASET_ID="multi-source-live-smoke" node <<'NODE'
const response = JSON.parse(process.env.SEARCH_RESPONSE);
const result = response.results?.[0];
if (!result) throw new Error('no refreshed local result available for candidate probe question');
process.stdout.write(JSON.stringify({
  text: 'Which refreshed fixture proves the local folder participates in candidate rebuild validation?',
  expectedDocumentIds: [result.documentId, result.path].filter(Boolean),
  expectedChunkIds: [result.chunkId].filter(Boolean),
  metadata: { datasetId: process.env.DATASET_ID, source: 'candidate-semantic-probe' },
}));
NODE
  )"
  question_response="$(post_json "/workspaces/$kb_id/eval/questions" "$question_body")"
  MULTI_SOURCE_PROBE_QUESTION="$question_response" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_PROBE_QUESTION);
if (!response.id || !response.expectedChunkIds?.length) {
  console.error('candidate probe eval question was not persisted with expected chunk labels');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}

smoke_multi_source_assert_context_eval_and_mcp() {
  local kb_id="$1"
  local manifest="$2"
  local context_response local_search eval_response mcp_response
  context_response="$(post_json "/workspaces/$kb_id/context-package" '{"query":"multi source topology retrieval evidence","topK":5,"tokenBudget":1000}')"
  MULTI_SOURCE_CONTEXT="$context_response" MULTI_SOURCE_MANIFEST="$manifest" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_CONTEXT);
const manifest = JSON.parse(process.env.MULTI_SOURCE_MANIFEST);
if (!response.groups?.length || response.count < 1) {
  console.error('context package returned no groups');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
const expected = manifest.entries.map((entry) => entry.sourceRevisionId).sort();
const actual = (response.diagnostics?.serving?.sourceRevisionIds || []).slice().sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error('context package diagnostics do not match active manifest source revisions');
  console.error(JSON.stringify({ expected, actual, diagnostics: response.diagnostics }, null, 2));
  process.exit(1);
}
NODE

  local_search="$(post_json "/workspaces/$kb_id/search" '{"query":"Cobalt multi local marker","topK":3,"pathPrefix":"local-guide.md"}')"
  local eval_body
  eval_body="$(SEARCH_RESPONSE="$local_search" DATASET_ID="multi-source-live-smoke" node <<'NODE'
const response = JSON.parse(process.env.SEARCH_RESPONSE);
const result = response.results?.[0];
if (!result) throw new Error('no local result available for eval question');
process.stdout.write(JSON.stringify({
  name: 'Multi-source live eval',
  datasetId: process.env.DATASET_ID,
  topK: 3,
  rerank: { enabled: false },
  questions: [{
    text: 'Which fixture proves the local folder participates in the serving manifest?',
    expectedDocumentIds: [result.documentId, result.path].filter(Boolean),
    expectedChunkIds: [result.chunkId].filter(Boolean),
    metadata: { datasetId: process.env.DATASET_ID, source: 'multi-source-live-smoke' },
  }],
}));
NODE
  )"
  eval_response="$(post_json "/workspaces/$kb_id/eval/runs" "$eval_body")"
  MULTI_SOURCE_EVAL="$eval_response" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_EVAL);
if (response.status !== 'succeeded' || response.metrics?.questionCount !== 1 || !response.metrics?.configHash) {
  console.error('multi-source eval did not succeed with config evidence');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  mcp_response="$(CONTEXTFORGE_BACKEND_URL="$API_URL" KB_ID="$kb_id" MULTI_SOURCE_MANIFEST="$manifest" node <<'NODE'
const { createToolHandlers, handleToolCall } = require('./apps/mcp-server/dist/index.js');
const { BackendApiClient } = require('./apps/mcp-server/dist/backend-client.js');

function parse(result) {
  return JSON.parse(result.content[0].text);
}

async function search(handlers, query, path) {
  const response = parse(await handleToolCall('search_kb', {
    kbId: process.env.KB_ID,
    query,
    topK: 5,
  }, handlers));
  if (!response.results?.some((item) => item.path === path && String(item.text || '').includes(query))) {
    throw new Error(`MCP search_kb did not find ${query} at ${path}`);
  }
}

async function main() {
  const manifest = JSON.parse(process.env.MULTI_SOURCE_MANIFEST);
  const client = new BackendApiClient(process.env.CONTEXTFORGE_BACKEND_URL);
  const handlers = createToolHandlers(client);
  const status = parse(await handleToolCall('get_workspace_status', { workspaceId: process.env.KB_ID }, handlers));
  if (!status.activeIndexVersionId) {
    throw new Error('MCP get_workspace_status did not expose an active index');
  }
  const placement = parse(await handleToolCall('get_workspace_vector_placement', {
    workspaceId: process.env.KB_ID,
  }, handlers));
  if (
    !placement.vectorBackendId ||
    !placement.physicalCollectionName ||
    placement.servingRevisionId !== manifest.servingRevisionId
  ) {
    throw new Error('MCP get_workspace_vector_placement did not expose exact serving placement identity');
  }
  await search(handlers, 'Cobalt multi local marker', 'local-guide.md');
  await search(handlers, 'Indigo multi obsidian marker', 'Alpha.md');
  await search(handlers, 'Amber multi upload marker', 'upload-notes.md');
  const code = parse(await handleToolCall('search_code', {
    kbId: process.env.KB_ID,
    query: 'multiSourceSearchDocuments function',
    topK: 5,
    language: 'typescript',
  }, handlers));
  if (!code.results?.some((item) => item.path === 'src/multi-source-search.ts')) {
    throw new Error('MCP search_code did not find the TypeScript fixture');
  }
  const context = parse(await handleToolCall('get_context_package', {
    kbId: process.env.KB_ID,
    query: 'multi source topology retrieval evidence',
    topK: 5,
    tokenBudget: 1000,
  }, handlers));
  if (!context.groups?.length || (context.diagnostics?.serving?.sourceRevisionIds || []).length !== 3) {
    throw new Error('MCP context package did not include serving diagnostics for all source revisions');
  }
  process.stdout.write(JSON.stringify({ ok: true }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
  )"
  MCP_RESPONSE="$mcp_response" node -e "const response=JSON.parse(process.env.MCP_RESPONSE); if(response.ok!==true) process.exit(1);"
}

smoke_multi_source_install_hybrid_profile() {
  local kb_id="$1"
  local workspace_slug="$2"
  local workspace_name="$3"
  local apply_body apply_response
  apply_body="$(WORKSPACE_SLUG="$workspace_slug" WORKSPACE_NAME="$workspace_name" KB_ID="$kb_id" node <<'NODE'
process.stdout.write(JSON.stringify({
  manifest: {
    formatVersion: 'workspace-export-manifest.v1',
    workspace: {
      slug: process.env.WORKSPACE_SLUG,
      name: process.env.WORKSPACE_NAME,
      description: 'Hybrid retrieval profile for live multi-source smoke.',
      kind: 'docs',
      defaultIndexProfile: 'default',
      defaultRetrievalProfile: 'multi-source-hybrid',
    },
    sources: [],
    retrievalProfiles: [{
      id: 'multi-source-hybrid-profile',
      key: 'multi-source-hybrid',
      name: 'Multi-source Hybrid Smoke',
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
  targetWorkspace: {
    id: process.env.KB_ID,
    updateExisting: true,
  },
  enqueueReindex: false,
}));
NODE
  )"
  apply_response="$(post_json "/workspaces/import-manifest/apply" "$apply_body")"
  MULTI_SOURCE_PROFILE_APPLY="$apply_response" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_PROFILE_APPLY);
if (response.applied !== true || response.restored?.retrievalProfiles !== 1 || response.workspace?.updated !== true) {
  console.error('multi-source hybrid profile was not applied');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}

smoke_multi_source_assert_live_studio() {
  local kb_id="$1"
  local workspace_name="$2"
  if [[ "${SMOKE_MULTI_SOURCE_RUN_STUDIO:-1}" != "1" ]]; then
    smoke_note "multi-source live Studio e2e skipped by SMOKE_MULTI_SOURCE_RUN_STUDIO=0"
    return 0
  fi
  local placement expected_backend_id expected_serving_revision_id expected_collection_name
  placement="$(get_json "/workspaces/$kb_id/vector-placement")"
  expected_backend_id="$(json_field "$placement" "vectorBackendId")"
  expected_serving_revision_id="$(json_field "$placement" "servingRevisionId")"
  expected_collection_name="$(json_field "$placement" "physicalCollectionName")"
  STUDIO_E2E_LIVE=1 \
    STUDIO_E2E_WORKSPACE_ID="$kb_id" \
    STUDIO_E2E_WORKSPACE_NAME="$workspace_name" \
    STUDIO_E2E_EXPECTED_SOURCE_TYPES="local_folder,obsidian_vault,upload" \
    STUDIO_E2E_EXPECTED_VECTOR_BACKEND_ID="$expected_backend_id" \
    STUDIO_E2E_EXPECTED_SERVING_REVISION_ID="$expected_serving_revision_id" \
    STUDIO_E2E_EXPECTED_COLLECTION_NAME="$expected_collection_name" \
    pnpm --filter web test:e2e:live
}

smoke_multi_source_full_rebuild() {
  local kb_id="$1"
  local operation operation_id built cutover rollback trace_response
  operation="$(post_json "/workspaces/$kb_id/vector-operations" "{
    \"kind\":\"full_rebuild\",
    \"strategy\":\"canonical_reembed\",
    \"idempotencyKey\":\"multi-source-full-rebuild-$kb_id\",
    \"rollbackRetentionHours\":1
  }")"
  operation_id="$(json_field "$operation" "id")"
  if [[ -z "$operation_id" ]]; then
    smoke_fail "multi-source full rebuild did not return operation id: $operation"
  fi
  wait_for_vector_operation_ready "$operation_id" "multi-source canonical rebuild"
  built="$SMOKE_LAST_VECTOR_OPERATION_DETAIL"
  MULTI_SOURCE_REBUILD_BUILT="$built" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_REBUILD_BUILT);
const coverage = response.validationSummary?.revisionCoverage || [];
if (response.state !== 'ready_for_cutover' || coverage.length !== 3) {
  console.error('canonical rebuild did not validate all three source revisions');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (coverage.some((item) => item.targetPoints <= 0 || item.sourcePoints !== item.targetPoints)) {
  console.error('canonical rebuild coverage is not point-perfect');
  console.error(JSON.stringify(coverage, null, 2));
  process.exit(1);
}
if ((response.validationSummary?.semanticProbes?.checked || 0) < 1) {
  console.error('canonical rebuild did not run candidate semantic probes');
  console.error(JSON.stringify(response.validationSummary, null, 2));
  process.exit(1);
}
NODE
  cutover="$(post_json "/vector-operations/$operation_id/cutover" '{}')"
  MULTI_SOURCE_REBUILD_CUTOVER="$cutover" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_REBUILD_CUTOVER);
if (response.state !== 'cutover_complete') {
  console.error('canonical rebuild did not cut over');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  trace_response="$(post_json "/workspaces/$kb_id/retrieval-trace" '{"query":"Emerald multi local updated marker","topK":5,"tokenBudget":1000}')"
  MULTI_SOURCE_REBUILD_TRACE="$trace_response" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_REBUILD_TRACE);
if (!response.stages?.finalCandidates?.length || (response.diagnostics?.serving?.sourceRevisionIds || []).length !== 3) {
  console.error('retrieval after canonical rebuild did not use all three source revisions');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  rollback="$(post_json "/vector-operations/$operation_id/rollback" '{}')"
  MULTI_SOURCE_REBUILD_ROLLBACK="$rollback" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_REBUILD_ROLLBACK);
if (response.state !== 'rollback_complete') {
  console.error('canonical rebuild rollback did not complete');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  sleep 5
}

smoke_multi_source_unload_load() {
  local kb_id="$1"
  local unload_response load_response load_job_id search_response load_status load_attempt
  for attempt in 1 2 3; do
    if unload_response="$(post_json "/workspaces/$kb_id/unload" '{}')"; then
      break
    fi
    if [[ "$attempt" == "3" ]]; then
      smoke_fail "multi-source workspace unload failed after retries"
    fi
    sleep "$((attempt * 3))"
  done
  MULTI_SOURCE_UNLOAD="$unload_response" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_UNLOAD);
if (response.lifecycle?.status !== 'unloaded' || response.lifecycle?.collectionAvailable !== false) {
  console.error('multi-source workspace did not unload');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  sleep 5
  load_job_id=""
  for load_attempt in 1 2 3; do
    load_response="$(post_json "/workspaces/$kb_id/load" '{"storageProfile":"low_memory"}')"
    load_job_id="$(json_field "$load_response" "job.id")"
    if [[ -z "$load_job_id" ]]; then
      load_status="succeeded"
      break
    fi
    smoke_multi_source_wait_load_job "$load_job_id" "multi-source workspace load rebuild"
    load_status="$(json_field "$SMOKE_LAST_JOB_DETAIL" "status")"
    if [[ "$load_status" == "succeeded" ]]; then
      break
    fi
    if [[ "$load_attempt" == "3" ]]; then
      echo "$SMOKE_LAST_JOB_DETAIL" >&2
      smoke_fail "multi-source workspace load rebuild failed after retries"
    fi
    sleep "$((load_attempt * 3))"
  done
  if [[ -n "$load_job_id" ]]; then
    MULTI_SOURCE_LOAD_JOB="$SMOKE_LAST_JOB_DETAIL" node <<'NODE'
const response = JSON.parse(process.env.MULTI_SOURCE_LOAD_JOB);
const coverage = response.stats?.revisionCoverage || [];
if (response.type !== 'build_index' || response.stats?.sourceRevisionCount !== 3 || coverage.length !== 3) {
  console.error('multi-source load did not rebuild all three active source revisions');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
  fi
  search_response="$(post_json "/workspaces/$kb_id/search" '{"query":"Emerald multi local updated marker","topK":5,"pathPrefix":"local-guide.md"}')"
  truth_refresh_assert_search_contains "$search_response" "Emerald multi local updated marker" "local-guide.md"
}

smoke_multi_source_wait_load_job() {
  local job_id="$1"
  local label="${2:-multi-source load job}"
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

  if [[ "$job_status" != "succeeded" && "$job_status" != "failed" ]]; then
    echo "$job_detail" >&2
    smoke_fail "$label did not reach a terminal status"
  fi

  SMOKE_LAST_JOB_DETAIL="$job_detail"
}

smoke_multi_source_failed_move_guard() {
  local kb_id="$1"
  local before_manifest missing_backend_id after_manifest
  before_manifest="$(smoke_multi_source_manifest "$kb_id")"
  missing_backend_id="00000000-0000-4000-8000-000000000120"
  API_URL="$API_URL" KB_ID="$kb_id" BACKEND_ID="$missing_backend_id" node <<'NODE'
const headers = { 'Content-Type': 'application/json' };
const apiKey = process.env.CONTEXTFORGE_API_KEY || process.env.ADMIN_API_KEY;
if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

async function post(path, body) {
  const response = await fetch(`${process.env.API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text };
}

async function main() {
  const move = await post(`/workspaces/${process.env.KB_ID}/vector-operations`, {
    kind: 'backend_move',
    targetVectorBackendId: process.env.BACKEND_ID,
    idempotencyKey: `multi-source-offline-move-${process.env.KB_ID}`,
  });
  if (move.status < 400) {
    console.error('offline backend move unexpectedly succeeded');
    console.error(move.body);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
  after_manifest="$(smoke_multi_source_manifest "$kb_id")"
  smoke_multi_source_assert_same_manifest "$before_manifest" "$after_manifest" "failed backend move changed active manifest"
}
