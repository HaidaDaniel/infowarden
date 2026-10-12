#!/usr/bin/env bash

smoke_case_reranker() {
  if [[ -z "$SMOKE_KB_ID" ]]; then
    smoke_fail "reranker case requires indexing case to set SMOKE_KB_ID"
  fi

  smoke_section "Waiting for local CPU reranker service"
  docker compose -f docker-compose.yml -f docker-compose.smoke.yml --profile reranker up -d smoke-reranker
  wait_for_url "$SMOKE_RERANKER_HEALTH_URL" "TEI reranker service" 240

  smoke_section "Installing local CPU reranker provider config"
  RERANKER_PROVIDER_NAME="${RERANKER_PROVIDER_NAME:-local-cpu-reranker}"
  export RERANKER_PROVIDER_NAME
  node <<'NODE'
const { PrismaClient, ProviderType } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const name = process.env.RERANKER_PROVIDER_NAME || 'local-cpu-reranker';
  const existing = await prisma.providerConfig.findFirst({
    where: { type: ProviderType.reranker, name },
  });
  const data = {
    type: ProviderType.reranker,
    name,
    baseUrl: process.env.RERANKER_BASE_URL || 'http://localhost:8081',
    model: process.env.RERANKER_MODEL || 'cross-encoder/ms-marco-MiniLM-L6-v2',
    apiKeyRef: null,
    metadata: {
      default: true,
      maxCandidates: Number(process.env.RERANKER_TOP_N || 3),
      timeoutMs: Number(process.env.RERANKER_TIMEOUT_MS || 60000),
      fallbackAllowed: process.env.RERANKER_FALLBACK_ALLOWED !== 'false',
      smoke: true,
    },
  };

  if (existing) {
    await prisma.providerConfig.update({ where: { id: existing.id }, data });
  } else {
    await prisma.providerConfig.create({ data });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
NODE

  smoke_section "Checking reranker request override diagnostics"
  local off_response on_response
  off_response="$(post_json "/workspaces/$SMOKE_KB_ID/retrieval-trace" '{"query":"document parsing and search","topK":5,"tokenBudget":1000,"rerank":{"enabled":false}}')"
  RERANK_OFF_RESPONSE="$off_response" node <<'NODE'
const response = JSON.parse(process.env.RERANK_OFF_RESPONSE);
if (response.diagnostics?.reranked !== false) {
  console.error('rerank disabled request unexpectedly reranked candidates');
  console.error(JSON.stringify(response.diagnostics, null, 2));
  process.exit(1);
}
if (response.diagnostics?.reranker?.source !== 'request' || response.diagnostics?.reranker?.reason !== 'reranker_disabled_by_request') {
  console.error('rerank disabled request did not expose request diagnostics');
  console.error(JSON.stringify(response.diagnostics, null, 2));
  process.exit(1);
}
NODE

  on_response="$(post_json "/workspaces/$SMOKE_KB_ID/retrieval-trace" "$(node <<'NODE'
const body = {
  query: 'document parsing and search',
  topK: 5,
  tokenBudget: 1000,
  rerank: {
    enabled: true,
    providerName: process.env.RERANKER_PROVIDER_NAME || 'local-cpu-reranker',
    topN: Number(process.env.RERANKER_TOP_N || 3),
    fallbackAllowed: false,
  },
};
process.stdout.write(JSON.stringify(body));
NODE
  )")"
  RERANK_ON_RESPONSE="$on_response" node <<'NODE'
const response = JSON.parse(process.env.RERANK_ON_RESPONSE);
const diagnostics = response.diagnostics || {};
if (diagnostics.reranked !== true || diagnostics.rerankerFallbackUsed !== false) {
  console.error('rerank enabled request did not rerank successfully');
  console.error(JSON.stringify(diagnostics, null, 2));
  process.exit(1);
}
if (diagnostics.reranker?.source !== 'request' || diagnostics.reranker?.enabled !== true) {
  console.error('rerank enabled request did not expose request/provider diagnostics');
  console.error(JSON.stringify(diagnostics, null, 2));
  process.exit(1);
}
const topN = Number(process.env.RERANKER_TOP_N || 3);
if (diagnostics.rerankerCandidateCount < 1 || diagnostics.rerankerCandidateCount > topN) {
  console.error('reranker candidate count was not bounded by topN');
  console.error(JSON.stringify(diagnostics, null, 2));
  process.exit(1);
}
if (!response.stages?.rerankedCandidates?.length) {
  console.error('reranked stage was empty');
  console.error(JSON.stringify(response.stages, null, 2));
  process.exit(1);
}
NODE

  if [[ -z "${SMOKE_EVAL_QUESTION_ID:-}" ]]; then
    smoke_note "no live eval question found; skipping reranker eval comparison"
    return
  fi

  smoke_section "Comparing eval runs with reranker off and on"
  local eval_off eval_on eval_comparison comparison_body
  eval_off="$(post_json "/workspaces/$SMOKE_KB_ID/eval/runs" "$(node <<'NODE'
process.stdout.write(JSON.stringify({
  name: 'Live smoke reranker off',
  datasetId: process.env.SMOKE_EVAL_DATASET_ID || 'live-smoke-mini',
  profileKey: 'default',
  topK: 5,
  rerank: { enabled: false },
}));
NODE
  )")"
  eval_on="$(post_json "/workspaces/$SMOKE_KB_ID/eval/runs" "$(node <<'NODE'
process.stdout.write(JSON.stringify({
  name: 'Live smoke reranker on',
  datasetId: process.env.SMOKE_EVAL_DATASET_ID || 'live-smoke-mini',
  profileKey: 'default',
  topK: 5,
  rerank: {
    enabled: true,
    providerName: process.env.RERANKER_PROVIDER_NAME || 'local-cpu-reranker',
    topN: Number(process.env.RERANKER_TOP_N || 3),
    fallbackAllowed: false,
  },
}));
NODE
  )")"
  RERANK_EVAL_OFF="$eval_off" RERANK_EVAL_ON="$eval_on" node <<'NODE'
const off = JSON.parse(process.env.RERANK_EVAL_OFF);
const on = JSON.parse(process.env.RERANK_EVAL_ON);
for (const [label, run] of [['off', off], ['on', on]]) {
  if (run.status !== 'succeeded' || !run.metrics?.configHash || run.metrics?.questionCount < 1) {
    console.error(`reranker ${label} eval did not succeed`);
    console.error(JSON.stringify(run, null, 2));
    process.exit(1);
  }
}
if (on.metrics?.config?.providers?.reranker?.enabled !== true) {
  console.error('reranker on eval did not record reranker config');
  console.error(JSON.stringify(on.metrics?.config, null, 2));
  process.exit(1);
}
NODE
  comparison_body="$(RERANK_EVAL_OFF="$eval_off" RERANK_EVAL_ON="$eval_on" node <<'NODE'
const off = JSON.parse(process.env.RERANK_EVAL_OFF);
const on = JSON.parse(process.env.RERANK_EVAL_ON);
process.stdout.write(JSON.stringify({ baselineRunId: off.id, candidateRunId: on.id }));
NODE
  )"
  eval_comparison="$(post_json "/workspaces/$SMOKE_KB_ID/eval/run-comparison" "$comparison_body")"
  RERANK_EVAL_COMPARISON="$eval_comparison" node <<'NODE'
const response = JSON.parse(process.env.RERANK_EVAL_COMPARISON);
if (!response.metricDeltas || typeof response.config?.changed !== 'boolean') {
  console.error('reranker eval comparison did not expose deltas/config state');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE
}
