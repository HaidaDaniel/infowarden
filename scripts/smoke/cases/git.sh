#!/usr/bin/env bash

smoke_case_git() {
  require_cmd git

  if [[ "$SMOKE_CORE_READY" != "1" ]]; then
    smoke_note "git smoke requires the core stack; running core first"
    smoke_case_core
  fi

  smoke_section "Creating temporary Git repository"
  SMOKE_GIT_TMP_DIR="$(mktemp -d)"
  local repo_dir="$SMOKE_GIT_TMP_DIR/repo"
  local clone_dir="$SMOKE_GIT_TMP_DIR/clone"
  mkdir -p "$repo_dir/docs"

  git -C "$repo_dir" init -b main >/dev/null
  git -C "$repo_dir" config user.email "smoke@example.local"
  git -C "$repo_dir" config user.name "ContextForge Smoke"
  cat >"$repo_dir/docs/changed.md" <<'EOF'
# Changed document

The first version talks about ordinary repository context.
EOF
  cat >"$repo_dir/docs/old.md" <<'EOF'
# Old document

This file should disappear after the refresh smoke commit.
EOF
  git -C "$repo_dir" add docs/changed.md docs/old.md
  git -C "$repo_dir" commit -m "initial smoke fixture" >/dev/null
  local initial_commit
  initial_commit="$(git -C "$repo_dir" rev-parse HEAD)"

  smoke_section "Creating Git workspace and source"
  local suffix kb_response source_body source_response git_kb_id git_source_id
  suffix="$(date -u +%Y%m%d%H%M%S)"
  kb_response="$(post_json "/knowledge-bases" "{\"name\":\"Git Smoke KB $suffix\",\"description\":\"Git update live smoke\",\"workspaceKind\":\"codebase\"}")"
  git_kb_id="$(json_field "$kb_response" "id")"
  if [[ -z "$git_kb_id" ]]; then
    smoke_fail "failed to create git smoke knowledge base: $kb_response"
  fi
  smoke_note "GIT_SMOKE_KB_ID=$git_kb_id"

  source_body="$(
    KB_ID="$git_kb_id" REPO_DIR="$repo_dir" CLONE_DIR="$clone_dir" node <<'NODE'
process.stdout.write(JSON.stringify({
  knowledgeBaseId: process.env.KB_ID,
  type: 'git_repo',
  uri: process.env.REPO_DIR,
  includeRules: ['**/*.md'],
  excludeRules: ['**/.git/**'],
  git: {
    branch: 'main',
    clonePath: process.env.CLONE_DIR,
  },
}));
NODE
  )"
  source_response="$(post_json "/sources" "$source_body")"
  git_source_id="$(json_field "$source_response" "id")"
  if [[ -z "$git_source_id" ]]; then
    smoke_fail "failed to create git smoke source: $source_response"
  fi
  smoke_note "GIT_SMOKE_SOURCE_ID=$git_source_id"

  smoke_section "Running initial Git source refresh"
  local refresh_response job_id
  refresh_response="$(post_json "/workspaces/$git_kb_id/sources/$git_source_id/refresh" '{"mode":"incremental","reason":"initial git smoke index"}')"
  job_id="$(json_field "$refresh_response" "job.id")"
  if [[ -z "$job_id" ]]; then
    smoke_fail "failed to enqueue initial git refresh: $refresh_response"
  fi
  wait_for_indexing_job "$job_id" "initial git refresh"
  INITIAL_GIT_JOB="$SMOKE_LAST_JOB_DETAIL" INITIAL_COMMIT="$initial_commit" node <<'NODE'
const job = JSON.parse(process.env.INITIAL_GIT_JOB);
const stats = job.stats || {};
if ((stats.added || 0) < 2 || !stats.validationReportId) {
  console.error('initial git refresh stats are incomplete');
  console.error(JSON.stringify(stats, null, 2));
  process.exit(1);
}
if (stats.refreshMode !== 'incremental') {
  console.error('initial git refresh did not record refreshMode');
  console.error(JSON.stringify(stats, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Committing add/change/delete updates"
  cat >"$repo_dir/docs/changed.md" <<'EOF'
# Changed document

The second version contains the nebula refresh marker for Git update smoke.
EOF
  cat >"$repo_dir/docs/new.md" <<'EOF'
# New document

The aurora added marker proves new Git files become searchable.
EOF
  rm "$repo_dir/docs/old.md"
  git -C "$repo_dir" add docs/changed.md docs/new.md
  git -C "$repo_dir" rm docs/old.md >/dev/null
  git -C "$repo_dir" commit -m "update smoke fixture" >/dev/null
  local updated_commit
  updated_commit="$(git -C "$repo_dir" rev-parse HEAD)"

  smoke_section "Checking Git refresh dry-run plan"
  local dry_run_response
  dry_run_response="$(post_json "/workspaces/$git_kb_id/sources/$git_source_id/refresh" '{"mode":"incremental","dryRun":true,"reason":"preview git update"}')"
  GIT_DRY_RUN_RESPONSE="$dry_run_response" node <<'NODE'
const response = JSON.parse(process.env.GIT_DRY_RUN_RESPONSE);
const stats = response.plan?.stats || {};
const added = response.plan?.addedPaths || [];
const changed = response.plan?.changedPaths || [];
const deleted = response.plan?.deletedPaths || [];
if (stats.added !== 1 || stats.changed !== 1 || stats.deleted !== 1) {
  console.error('git dry-run stats did not detect add/change/delete');
  console.error(JSON.stringify(response.plan, null, 2));
  process.exit(1);
}
for (const [label, list, path] of [
  ['added', added, 'docs/new.md'],
  ['changed', changed, 'docs/changed.md'],
  ['deleted', deleted, 'docs/old.md'],
]) {
  if (!list.includes(path)) {
    console.error(`git dry-run ${label} paths missing ${path}`);
    console.error(JSON.stringify(response.plan, null, 2));
    process.exit(1);
  }
}
NODE

  smoke_section "Refreshing Git source after updates"
  refresh_response="$(post_json "/workspaces/$git_kb_id/sources/$git_source_id/refresh" '{"mode":"incremental","reason":"after git smoke commit"}')"
  job_id="$(json_field "$refresh_response" "job.id")"
  if [[ -z "$job_id" ]]; then
    smoke_fail "failed to enqueue updated git refresh: $refresh_response"
  fi
  wait_for_indexing_job "$job_id" "updated git refresh"
  UPDATED_GIT_JOB="$SMOKE_LAST_JOB_DETAIL" UPDATED_COMMIT="$updated_commit" node <<'NODE'
const job = JSON.parse(process.env.UPDATED_GIT_JOB);
const stats = job.stats || {};
if (stats.added !== 1 || stats.changed !== 1 || stats.deleted !== 1) {
  console.error('updated git refresh stats did not detect add/change/delete');
  console.error(JSON.stringify(stats, null, 2));
  process.exit(1);
}
if (stats.refreshMode !== 'incremental' || !Array.isArray(job.logs) || !job.logs.some((entry) => entry.message === 'Prepared git working tree')) {
  console.error('updated git refresh logs/stats are missing refresh or git metadata');
  console.error(JSON.stringify({ stats, logs: job.logs }, null, 2));
  process.exit(1);
}
const prepared = job.logs.find((entry) => entry.message === 'Prepared git working tree');
if (prepared.data?.branch !== 'main' || prepared.data?.commit !== process.env.UPDATED_COMMIT) {
  console.error('prepared git working tree log does not reference updated commit');
  console.error(JSON.stringify(prepared, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking Git search metadata"
  local changed_search new_search old_search
  changed_search="$(post_json "/workspaces/$git_kb_id/search" '{"query":"nebula refresh marker","topK":5,"pathPrefix":"docs/changed.md","branch":"main"}')"
  GIT_CHANGED_SEARCH="$changed_search" UPDATED_COMMIT="$updated_commit" node <<'NODE'
const response = JSON.parse(process.env.GIT_CHANGED_SEARCH);
const result = response.results?.[0];
if (!result) {
  console.error('changed Git document was not searchable');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (result.path !== 'docs/changed.md' || result.branch !== 'main' || result.commit !== process.env.UPDATED_COMMIT) {
  console.error('changed Git search result is missing path/branch/commit metadata');
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
if (!String(result.text || '').includes('nebula refresh marker')) {
  console.error('changed Git search result does not include updated text');
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
NODE

  new_search="$(post_json "/workspaces/$git_kb_id/search" '{"query":"aurora added marker","topK":5,"pathPrefix":"docs/new.md","branch":"main"}')"
  GIT_NEW_SEARCH="$new_search" UPDATED_COMMIT="$updated_commit" node <<'NODE'
const response = JSON.parse(process.env.GIT_NEW_SEARCH);
const result = response.results?.[0];
if (!result || result.path !== 'docs/new.md' || result.branch !== 'main' || result.commit !== process.env.UPDATED_COMMIT) {
  console.error('new Git document was not searchable with updated metadata');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  old_search="$(post_json "/workspaces/$git_kb_id/search" '{"query":"disappear refresh smoke","topK":5,"pathPrefix":"docs/old.md","branch":"main"}')"
  GIT_OLD_SEARCH="$old_search" node <<'NODE'
const response = JSON.parse(process.env.GIT_OLD_SEARCH);
if ((response.results || []).length !== 0) {
  console.error('deleted Git document still appears in search');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}
