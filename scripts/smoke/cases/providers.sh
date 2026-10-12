#!/usr/bin/env bash

smoke_case_providers() {
  if [[ -z "$SMOKE_URL_KB_ID" ]]; then
    smoke_note "providers smoke needs a refreshed URL workspace; running refresh first"
    smoke_case_refresh
  fi

  smoke_section "Installing hybrid retrieval profile through restore apply"
  local workspace_response profile_body apply_response missing_reranker
  missing_reranker="missing-smoke-reranker-$(date -u +%Y%m%d%H%M%S)"
  workspace_response="$(get_json "/workspaces/$SMOKE_URL_KB_ID")"
  profile_body="$(
    WORKSPACE="$workspace_response" MISSING_RERANKER="$missing_reranker" node <<'NODE'
const workspace = JSON.parse(process.env.WORKSPACE);
process.stdout.write(JSON.stringify({
  manifest: {
    formatVersion: 'workspace-export-manifest.v1',
    workspace: {
      slug: workspace.slug,
      name: workspace.name,
      description: workspace.description,
      kind: workspace.workspaceKind || 'docs',
      defaultIndexProfile: workspace.defaultIndexProfile || 'default',
      defaultRetrievalProfile: 'hybrid-smoke',
    },
    sources: [],
    retrievalProfiles: [
      {
        id: 'hybrid-smoke-profile',
        key: 'hybrid-smoke',
        name: 'Hybrid Smoke Retrieval',
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
          rerankerProviderName: process.env.MISSING_RERANKER,
          rerankerFallbackAllowed: true,
        },
      },
    ],
    memoryEntries: [],
    indexVersions: [],
  },
  targetWorkspace: {
    id: workspace.id,
    updateExisting: true,
  },
  enqueueReindex: false,
}));
NODE
  )"
  apply_response="$(post_json "/workspaces/import-manifest/apply" "$profile_body")"
  PROVIDER_PROFILE_APPLY_RESPONSE="$apply_response" node <<'NODE'
const response = JSON.parse(process.env.PROVIDER_PROFILE_APPLY_RESPONSE);
if (response.applied !== true || response.restored?.retrievalProfiles !== 1 || response.workspace?.updated !== true) {
  console.error('hybrid profile restore apply did not update the workspace');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking provider snapshot and hybrid retrieval diagnostics"
  local manifest_response trace_response
  manifest_response="$(get_json "/workspaces/$SMOKE_URL_KB_ID/export-manifest")"
  PROVIDER_MANIFEST_RESPONSE="$manifest_response" node <<'NODE'
const response = JSON.parse(process.env.PROVIDER_MANIFEST_RESPONSE);
const active = response.indexVersions?.find((version) => version.isActive);
const snapshot = response.sourceSnapshots?.[0];
if (!active || active.embeddingModel !== process.env.EMBEDDING_MODEL || active.embeddingDimension !== Number(process.env.EMBEDDING_DIMENSION)) {
  console.error('active index version did not record the smoke embedding provider model/dimension');
  console.error(JSON.stringify(active, null, 2));
  process.exit(1);
}
if (!snapshot?.metadata?.embeddingProvider?.source) {
  console.error('source snapshot is missing embedding provider snapshot metadata');
  console.error(JSON.stringify(snapshot, null, 2));
  process.exit(1);
}
NODE
  trace_response="$(post_json "/workspaces/$SMOKE_URL_KB_ID/retrieval-trace" '{"query":"Solstice URL marker","topK":5,"profileKey":"hybrid-smoke","tokenBudget":1000}')"
  HYBRID_TRACE_RESPONSE="$trace_response" node <<'NODE'
const response = JSON.parse(process.env.HYBRID_TRACE_RESPONSE);
if (response.retrievalProfile?.key !== 'hybrid-smoke' || response.retrievalProfile?.lexicalEnabled !== true) {
  console.error('retrieval trace did not use the hybrid profile');
  console.error(JSON.stringify(response.retrievalProfile, null, 2));
  process.exit(1);
}
if (!response.stages?.denseCandidates?.length || !response.stages?.lexicalCandidates?.length || response.diagnostics?.lexicalCandidates < 1) {
  console.error('hybrid retrieval did not include dense and lexical candidates');
  console.error(JSON.stringify(response.stages, null, 2));
  process.exit(1);
}
if (
  response.diagnostics?.reranked !== false ||
  response.diagnostics?.rerankerReason !== 'reranker_provider_not_found' ||
  response.diagnostics?.reranker?.requested !== true ||
  response.diagnostics?.reranker?.fallbackAllowed !== true
) {
  console.error('missing reranker diagnostics were not exposed');
  console.error(JSON.stringify(response.diagnostics, null, 2));
  process.exit(1);
}
NODE
}
