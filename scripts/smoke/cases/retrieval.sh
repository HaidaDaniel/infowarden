#!/usr/bin/env bash

smoke_case_retrieval() {
  if [[ -z "$SMOKE_KB_ID" ]]; then
    smoke_fail "retrieval case requires indexing case to set SMOKE_KB_ID"
  fi

  smoke_section "Checking Qdrant collection and vectors"
  local collection_name="kb-$SMOKE_KB_ID"
  curl -fsS "$QDRANT_URL/collections/$collection_name" >/dev/null
  local scroll_response point_count
  scroll_response="$(curl -fsS -X POST "$QDRANT_URL/collections/$collection_name/points/scroll" -H "Content-Type: application/json" --data-binary '{"limit":1,"with_payload":true,"with_vector":false}')"
  point_count="$(node -e "const data=JSON.parse(process.argv[1]); console.log((data.result?.points || []).length)" "$scroll_response")"
  if [[ "$point_count" == "0" ]]; then
    smoke_fail "Qdrant collection has no points"
  fi

  smoke_section "Running REST search smoke"
  SMOKE_LAST_SEARCH_RESPONSE="$(post_json "/knowledge-bases/$SMOKE_KB_ID/search" '{"query":"search functionality","topK":3}')"
  SEARCH_RESPONSE="$SMOKE_LAST_SEARCH_RESPONSE" node <<'NODE'
const response = JSON.parse(process.env.SEARCH_RESPONSE);
if (!response.results?.length || response.count < 1) {
  console.error('REST search returned no results');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
const item = response.results[0];
for (const key of ['chunkId', 'documentId', 'path', 'score']) {
  if (item[key] === undefined || item[key] === null || item[key] === '') {
    console.error(`REST search result missing ${key}`);
    console.error(JSON.stringify(item, null, 2));
    process.exit(1);
  }
}
if (!item.indexVersionId && !item.metadata?.indexVersionId) {
  console.error('REST search result missing indexVersionId');
  console.error(JSON.stringify(item, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Running REST code search smoke"
  local code_search_response
  code_search_response="$(post_json "/knowledge-bases/$SMOKE_KB_ID/search-code" '{"query":"searchDocuments function","topK":3,"language":"typescript"}')"
  CODE_SEARCH_RESPONSE="$code_search_response" node <<'NODE'
const response = JSON.parse(process.env.CODE_SEARCH_RESPONSE);
if (!response.results?.length || response.count < 1) {
  console.error('REST code search returned no results');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Running context package smoke"
  local context_response
  context_response="$(post_json "/workspaces/$SMOKE_KB_ID/context-package" '{"query":"document parsing and search","topK":3,"tokenBudget":1000}')"
  CONTEXT_RESPONSE="$context_response" node <<'NODE'
const response = JSON.parse(process.env.CONTEXT_RESPONSE);
if (!response.groups?.length || response.count < 1 || !response.diagnostics) {
  console.error('context package returned an unexpected payload');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Running retrieval trace smoke"
  local trace_response
  trace_response="$(post_json "/workspaces/$SMOKE_KB_ID/retrieval-trace" '{"query":"document parsing and search","topK":3,"tokenBudget":1000}')"
  TRACE_RESPONSE="$trace_response" node <<'NODE'
const response = JSON.parse(process.env.TRACE_RESPONSE);
if (!response.stages?.denseCandidates?.length || response.contextPackage?.count < 1 || !response.diagnostics) {
  console.error('retrieval trace returned an unexpected payload');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}
