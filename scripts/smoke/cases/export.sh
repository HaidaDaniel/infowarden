#!/usr/bin/env bash

smoke_case_export() {
  if [[ -z "$SMOKE_KB_ID" ]]; then
    smoke_fail "export case requires indexing case to set SMOKE_KB_ID"
  fi

  smoke_section "Checking workspace export manifest"
  local manifest_response
  manifest_response="$(get_json "/workspaces/$SMOKE_KB_ID/export-manifest")"
  EXPORT_MANIFEST_RESPONSE="$manifest_response" node <<'NODE'
const response = JSON.parse(process.env.EXPORT_MANIFEST_RESPONSE);
if (response.restorePlan?.mode !== 'plan_only') {
  console.error('export manifest is not plan-only');
  console.error(JSON.stringify(response.restorePlan, null, 2));
  process.exit(1);
}
if ((response.counts?.sources || 0) < 1 || (response.counts?.memoryEntries || 0) < 3) {
  console.error('export manifest counts do not include smoke source and memory entries');
  console.error(JSON.stringify(response.counts, null, 2));
  process.exit(1);
}
if (!response.sources?.length || !response.exportScope?.includes?.length) {
  console.error('export manifest is missing sources or export scope');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}
