#!/usr/bin/env bash

smoke_case_memory() {
  if [[ -z "$SMOKE_KB_ID" ]]; then
    smoke_fail "memory case requires indexing case to set SMOKE_KB_ID"
  fi

  smoke_section "Creating memory entries"
  local fact_response decision_response session_response delete_response fact_id decision_id session_id delete_id
  fact_response="$(post_json "/workspaces/$SMOKE_KB_ID/memory" '{"entryType":"fact","title":"Smoke fact","body":"The smoke suite can remember facts.","summary":"Fact smoke entry","tags":["smoke","fact"],"authoredBy":"smoke","sessionId":"smoke-session"}')"
  decision_response="$(post_json "/workspaces/$SMOKE_KB_ID/memory/decisions" '{"title":"Smoke decision","body":"The smoke suite verifies recent decision retrieval.","summary":"Decision smoke entry","tags":["smoke","decision"],"authoredBy":"smoke","sessionId":"smoke-session"}')"
  session_response="$(post_json "/workspaces/$SMOKE_KB_ID/memory/session-summaries" '{"title":"Smoke session","body":"The smoke session indexed source data and verified retrieval.","summary":"Session smoke entry","tags":["smoke","session"],"authoredBy":"smoke","sessionId":"smoke-session"}')"
  delete_response="$(post_json "/workspaces/$SMOKE_KB_ID/memory" '{"entryType":"fact","title":"Smoke transient delete","body":"This entry exists only for delete smoke.","summary":"Transient delete entry","tags":["smoke","delete"],"authoredBy":"smoke","sessionId":"smoke-session"}')"
  fact_id="$(json_field "$fact_response" "id")"
  decision_id="$(json_field "$decision_response" "id")"
  session_id="$(json_field "$session_response" "id")"
  delete_id="$(json_field "$delete_response" "id")"
  if [[ -z "$fact_id" || -z "$decision_id" || -z "$session_id" || -z "$delete_id" ]]; then
    smoke_fail "memory creation did not return entry ids"
  fi

  smoke_section "Checking memory update"
  local updated_fact_response
  updated_fact_response="$(patch_json "/workspaces/$SMOKE_KB_ID/memory/$fact_id" '{"title":"Smoke fact updated","body":"The smoke suite can update remembered facts.","tags":["smoke","fact","updated"],"metadata":{"smokeMutation":"updated"}}')"
  UPDATED_FACT_RESPONSE="$updated_fact_response" node <<'NODE'
const response = JSON.parse(process.env.UPDATED_FACT_RESPONSE);
if (response.title !== 'Smoke fact updated' || response.metadata?.smokeMutation !== 'updated') {
  console.error('memory update did not persist expected fields');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (response.metadata?.vectorRefresh?.status !== 'not_configured') {
  console.error('memory update should preserve vector refresh not-configured metadata');
  console.error(JSON.stringify(response.metadata, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking memory archive and delete"
  local archived_session_response deleted_fact_response
  archived_session_response="$(post_json "/workspaces/$SMOKE_KB_ID/memory/$session_id/archive" '{"reason":"memory lifecycle smoke"}')"
  deleted_fact_response="$(delete_json "/workspaces/$SMOKE_KB_ID/memory/$delete_id")"
  ARCHIVED_SESSION_RESPONSE="$archived_session_response" DELETED_FACT_RESPONSE="$deleted_fact_response" node <<'NODE'
const archived = JSON.parse(process.env.ARCHIVED_SESSION_RESPONSE);
const deleted = JSON.parse(process.env.DELETED_FACT_RESPONSE);
if (archived.metadata?.lifecycleStatus !== 'archived' || archived.metadata?.archiveReason !== 'memory lifecycle smoke') {
  console.error('memory archive did not mark lifecycle metadata');
  console.error(JSON.stringify(archived, null, 2));
  process.exit(1);
}
if (!deleted.deleted || !deleted.id) {
  console.error('memory delete response is unexpected');
  console.error(JSON.stringify(deleted, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking memory list"
  local list_response
  list_response="$(get_json "/workspaces/$SMOKE_KB_ID/memory?tag=smoke")"
  MEMORY_LIST_RESPONSE="$list_response" node <<'NODE'
const response = JSON.parse(process.env.MEMORY_LIST_RESPONSE);
if (!Array.isArray(response) || !response.some((entry) => entry.title === 'Smoke decision') || !response.some((entry) => entry.title === 'Smoke fact updated')) {
  console.error('memory list did not include active smoke decision and updated fact');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (response.some((entry) => entry.title === 'Smoke session' || entry.title === 'Smoke transient delete')) {
  console.error('memory list included archived or deleted entries by default');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking archived memory list"
  local archived_list_response
  archived_list_response="$(get_json "/workspaces/$SMOKE_KB_ID/memory?tag=smoke&includeArchived=true")"
  ARCHIVED_MEMORY_LIST_RESPONSE="$archived_list_response" node <<'NODE'
const response = JSON.parse(process.env.ARCHIVED_MEMORY_LIST_RESPONSE);
if (!Array.isArray(response) || !response.some((entry) => entry.title === 'Smoke session' && entry.metadata?.lifecycleStatus === 'archived')) {
  console.error('includeArchived memory list did not include archived session');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking memory search"
  local search_response
  search_response="$(post_json "/workspaces/$SMOKE_KB_ID/search-memory" '{"query":"smoke decision","topK":5,"profileKey":"memory-recall"}')"
  MEMORY_SEARCH_RESPONSE="$search_response" node <<'NODE'
const response = JSON.parse(process.env.MEMORY_SEARCH_RESPONSE);
if (!response.results?.length || response.count < 1) {
  console.error('memory search returned no results');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking recent decisions"
  local decisions_response
  decisions_response="$(get_json "/workspaces/$SMOKE_KB_ID/recent-decisions?limit=5")"
  RECENT_DECISIONS_RESPONSE="$decisions_response" node <<'NODE'
const response = JSON.parse(process.env.RECENT_DECISIONS_RESPONSE);
if (!response.results?.some((entry) => entry.title === 'Smoke decision')) {
  console.error('recent decisions did not include smoke decision');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}
