import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { aggregate, collapseResults, createBenchmarkIdentityResolver, loadPartition, scoreQuery } from "./contract.mjs";
import { validateV21Harness } from "./v21-matrix.mjs";

const DEV_SPLIT = "DEV";
const TOP_K = 10;
const CANDIDATE_DEPTH = 50;
const OUTPUT_RELATIVE = "fixtures/eval/benchmark-v2/reports/v2.1-dev";
const WORKSPACE_ROOT_RELATIVE = ".contextforge/benchmarks/benchmark-v2.1-dev";

export async function runV21Dev(repoRoot, options = {}) {
  const apiUrl = options.apiUrl || process.env.INFO_WARDEN_API_URL || "http://localhost:3000";
  const outputDir = path.resolve(repoRoot, options.output || OUTPUT_RELATIVE);
  const workRoot = path.resolve(repoRoot, WORKSPACE_ROOT_RELATIVE);
  const { split, matrix, configurations } = await validateV21Harness(repoRoot);
  const splitByPartition = splitAssignmentsByPartition(split);
  const packs = new Map();
  for (const partition of ["en", "ru", "mixed"]) {
    const assignments = splitByPartition.get(partition) || [];
    packs.set(partition, loadPartition(repoRoot, partition, { queryIds: assignments.map((row) => row.queryId) }));
  }

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.rm(workRoot, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(workRoot, { recursive: true });

  const runtime = {
    apiUrl,
    node: process.version,
    environment: process.env.BENCHMARK_V21_ENVIRONMENT || "local-dev-external",
    provider: process.env.BENCHMARK_V21_PROVIDER || "local-90-qwen3-embedding-0.6b",
    embeddingModel: process.env.BENCHMARK_V21_EMBEDDING_MODEL || "qwen3-embedding-0.6b",
    rerankerModel: process.env.BENCHMARK_V21_RERANKER_MODEL || "qwen3-reranker-0.6b",
    embeddingDimension: Number(process.env.BENCHMARK_V21_EMBEDDING_DIMENSION || 1024),
  };
  const report = {
    formatVersion: "infowarden-benchmark-v21-dev-report.v1",
    qualityRun: true,
    split: {
      path: "fixtures/eval/benchmark-v2/metadata/v2.1-split.json",
      checksumSha256: split.splitChecksumSha256,
      assignmentCount: split.assignments.length,
      devCount: split.counts.DEV,
      holdoutCount: split.counts.HOLDOUT,
    },
    methodology: {
      matrixStages: matrix.stages,
      configurationChecksumSha256: configurations.configurationChecksumSha256,
      matrixChecksumSha256: matrix.matrixChecksumSha256,
      repetitions: matrix.repetitions,
      holdoutRead: false,
      historicalV2PerQueryHoldoutRead: false,
    },
    runtime,
    workspaces: [],
    attemptedConfigurations: [],
    selected: {},
  };

  const workspaces = new Map();
  try {
    for (const partition of ["en", "ru", "mixed"]) {
      const pack = packs.get(partition);
      const assignments = splitByPartition.get(pack.partition) || [];
      if (assignments.length === 0) {
        throw new Error(`frozen DEV split has no assignments for ${pack.label}`);
      }
      const workspace = await prepareWorkspace(apiUrl, workRoot, pack, assignments);
      workspaces.set(partition, workspace);
      report.workspaces.push({
        partition: pack.label,
        workspaceId: workspace.id,
        sourceId: workspace.sourceId,
        indexJobId: workspace.indexJobId,
        documentCount: pack.documents.length,
        devQueryCount: assignments.length,
      });
    }

    const lexicalCandidates = buildLexicalCandidates(configurations.parameterGrids);
    const lexicalResults = [];
    for (const candidate of lexicalCandidates) {
      const result = await runConfiguration({
        apiUrl,
        packs,
        splitByPartition,
        workspaces,
        configuration: candidate,
        outputDir,
      });
      lexicalResults.push(result);
      report.attemptedConfigurations.push(summarizeAttempt(result));
    }
    const lexicalSelection = selectLexicalLeg(lexicalResults);
    report.selected.lexicalLeg = lexicalSelection.selection;
    await writeJson(outputDir, "lexical-leg-selection.json", lexicalSelection);

    const fusionCandidates = buildFusionCandidates(configurations.parameterGrids, lexicalSelection.selection);
    const fusionResults = [];
    for (const candidate of fusionCandidates) {
      const result = await runConfiguration({
        apiUrl,
        packs,
        splitByPartition,
        workspaces,
        configuration: candidate,
        outputDir,
      });
      fusionResults.push(result);
      report.attemptedConfigurations.push(summarizeAttempt(result));
    }
    const fusionSelection = selectFusion(fusionResults);
    report.selected.fusion = fusionSelection.selection;
    await writeJson(outputDir, "controlled-fusion-selection.json", fusionSelection);

    const rerankerCandidates = buildRerankerCandidates(lexicalSelection.selection, fusionSelection.selection);
    const rerankerResults = [];
    for (const candidate of rerankerCandidates) {
      const result = await runConfiguration({
        apiUrl,
        packs,
        splitByPartition,
        workspaces,
        configuration: candidate,
        outputDir,
      });
      rerankerResults.push(result);
      report.attemptedConfigurations.push(summarizeAttempt(result));
    }
    report.selected.rerankerPairs = rerankerResults.map(summarizeAttempt);
    await writeJson(outputDir, "reranker-isolation.json", { results: rerankerResults.map(summarizeAttempt) });

    report.selected.lexicalLeg = bindSelectionHash(report.selected.lexicalLeg);
    report.selected.fusion = bindSelectionHash(report.selected.fusion);
    report.completedAt = new Date().toISOString();
    await writeJson(outputDir, "benchmark-v21-dev-summary.json", report);
    await fs.writeFile(path.join(outputDir, "report.md"), renderReport(report));
    console.log(`benchmark-v2.1 DEV report: ${path.relative(repoRoot, outputDir)}`);
  } finally {
    for (const workspace of workspaces.values()) {
      await deleteWorkspace(apiUrl, workspace.id).catch((error) => {
        console.error(`warning: failed to delete benchmark workspace ${workspace.id}: ${error.message}`);
      });
    }
  }
}

function buildLexicalCandidates(grids) {
  return [
    {
      id: "lexical-pg-fts",
      stage: "lexical-leg-selection",
      profileKey: "v21-dev-lexical-pg-fts",
      metadata: lexicalMetadata("pg-fts"),
    },
    {
      id: "lexical-structured",
      stage: "lexical-leg-selection",
      profileKey: "v21-dev-lexical-structured",
      metadata: lexicalMetadata("structured"),
    },
    ...grids.bm25.k1.flatMap((k1) =>
      grids.bm25.b.map((b) => ({
        id: `lexical-bm25-k1-${k1}-b-${b}`,
        baseId: "lexical-bm25",
        stage: "lexical-leg-selection",
        profileKey: `v21-dev-bm25-${k1}-${b}`,
        metadata: lexicalMetadata("bm25", { bm25K1: k1, bm25B: b }),
      })),
    ),
    ...grids.bm25fFieldWeights.map(({ id, weights }) => ({
      id: `lexical-bm25f-${id}`,
      baseId: "lexical-bm25f",
      stage: "lexical-leg-selection",
      profileKey: `v21-dev-bm25f-${id}`,
      metadata: lexicalMetadata("bm25f", { bm25fWeightGridId: id, bm25fWeights: weights }),
    })),
  ];
}

function buildFusionCandidates(grids, lexicalSelection) {
  const lexicalMetadata = lexicalSelection.metadata;
  return [
    {
      id: "fusion-legacy",
      stage: "controlled-fusion",
      profileKey: "v21-dev-fusion-legacy",
      metadata: hybridMetadata(lexicalMetadata, "legacy-weighted-rank"),
    },
    ...grids.rrf.k.flatMap((rrfK) =>
      grids.rrf.candidateDepth.map((candidateDepth) => ({
        id: `fusion-rrf-k-${rrfK}-depth-${candidateDepth}`,
        baseId: "fusion-rrf",
        stage: "controlled-fusion",
        profileKey: `v21-dev-fusion-rrf-${rrfK}-${candidateDepth}`,
        metadata: hybridMetadata(lexicalMetadata, "rrf", { rrfK, candidateDepth }),
      })),
    ),
    ...grids.rrf.candidateDepth.map((candidateDepth) => ({
      id: `fusion-dbsf-depth-${candidateDepth}`,
      baseId: "fusion-dbsf",
      stage: "controlled-fusion",
      profileKey: `v21-dev-fusion-dbsf-${candidateDepth}`,
      metadata: hybridMetadata(lexicalMetadata, "dbsf", { candidateDepth }),
    })),
  ];
}

function buildRerankerCandidates(lexicalSelection, fusionSelection) {
  const dense = {
    id: "dense",
    stage: "reranker-pair",
    profileKey: "v21-dev-dense",
    metadata: { candidateStrategy: "dense", denseTopK: CANDIDATE_DEPTH },
  };
  const lexical = {
    id: "lexical-lstar",
    stage: "reranker-pair",
    profileKey: "v21-dev-lstar",
    metadata: lexicalSelection.metadata,
  };
  const fusion = {
    id: "fusion-selected",
    stage: "reranker-pair",
    profileKey: "v21-dev-selected-fusion",
    metadata: fusionSelection.metadata,
  };
  return [
    dense,
    { ...dense, id: "dense-reranker", profileKey: "v21-dev-dense-reranker", metadata: reranker(dense.metadata) },
    lexical,
    {
      ...lexical,
      id: "lexical-lstar-reranker",
      profileKey: "v21-dev-lstar-reranker",
      metadata: reranker(lexical.metadata),
    },
    fusion,
    {
      ...fusion,
      id: "fusion-selected-reranker",
      profileKey: "v21-dev-selected-fusion-reranker",
      metadata: reranker(fusion.metadata),
    },
  ];
}

function lexicalMetadata(strategy, extra = {}) {
  return {
    candidateStrategy: "lexical",
    lexicalEnabled: true,
    lexicalStrategy: strategy,
    lexicalTopK: CANDIDATE_DEPTH,
    ...extra,
  };
}

function hybridMetadata(lexical, fusionStrategy, extra = {}) {
  return {
    ...lexical,
    candidateStrategy: "hybrid",
    hybridSearch: true,
    fusionStrategy,
    denseTopK: CANDIDATE_DEPTH,
    ...extra,
  };
}

function reranker(metadata) {
  return { ...metadata, reranker: { enabled: true } };
}

export async function prepareWorkspace(apiUrl, workRoot, pack, assignments, stage = "DEV", options = {}) {
  const stageKey = stage.toLowerCase();
  const workspace = await request(apiUrl, "POST", "/knowledge-bases", {
    name: `Benchmark v2.1 ${stage} ${pack.label}`,
    slug: `benchmark-v21-${stageKey}-${pack.partition}-${Date.now()}`,
    description: `Temporary ${stage}-only retrieval benchmark workspace for ${pack.label}`,
    workspaceKind: "benchmarks",
  });
  options.onWorkspaceCreated?.(workspace.id);
  const materializedRoot = path.join(workRoot, pack.partition);
  for (const document of pack.documents) {
    const filename = path.join(materializedRoot, `${pack.partition}`, `${document.id}.md`);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, `# ${document.title || document.id}\n\n${document.text}\n`);
  }
  const source = await request(apiUrl, "POST", "/sources", {
    knowledgeBaseId: workspace.id,
    type: "local_folder",
    uri: materializedRoot,
    includeRules: ["**/*.md"],
    excludeRules: [],
  });
  const startedAt = Date.now();
  const job = await request(apiUrl, "POST", "/jobs/indexing", {
    knowledgeBaseId: workspace.id,
    sourceId: source.id,
    type: "scan_source",
  });
  const finished = await pollJob(apiUrl, job.id);
  if (finished.status !== "succeeded") {
    throw new Error(`DEV indexing failed for ${pack.label}: ${JSON.stringify(finished).slice(0, 1200)}`);
  }
  return {
    id: workspace.id,
    sourceId: source.id,
    indexJobId: job.id,
    indexBuildDurationMs: Date.now() - startedAt,
    assignments,
  };
}

export async function applyProfile(apiUrl, workspaceId, configuration, stage = "DEV") {
  const manifest = {
    formatVersion: "workspace-export-manifest.v1",
    workspace: {
      slug: `benchmark-v21-${stage.toLowerCase()}-${workspaceId}`,
      name: `Benchmark v2.1 ${stage} ${configuration.id}`,
      kind: "benchmarks",
      defaultIndexProfile: "default",
      defaultRetrievalProfile: "default",
    },
    sources: [],
    retrievalProfiles: [
      {
        id: `benchmark-v21-${configuration.id}`,
        key: configuration.profileKey,
        name: `Benchmark v2.1 ${configuration.id}`,
        intent: "general_search",
        denseTopK: CANDIDATE_DEPTH,
        neighborBefore: 0,
        neighborAfter: 0,
        grouping: "document",
        recencyBoost: false,
        metadata: configuration.metadata,
      },
    ],
    memoryEntries: [],
    indexVersions: [],
  };
  const response = await request(apiUrl, "POST", "/workspaces/import-manifest/apply", {
    manifest,
    targetWorkspace: { id: workspaceId, updateExisting: true },
    enqueueReindex: false,
  });
  if (response.applied !== true || response.restored?.retrievalProfiles !== 1) {
    throw new Error(`failed to apply benchmark profile ${configuration.profileKey}`);
  }
}

export async function runConfiguration({
  apiUrl,
  packs,
  splitByPartition,
  workspaces,
  configuration,
  outputDir,
  stage = "DEV",
  responseEvidence,
  profileEvidence,
}) {
  const rows = [];
  for (const [partition, workspace] of workspaces) {
    const pack = packs.get(partition);
    const assignments = splitByPartition.get(pack.partition) || [];
    const identityResolver = createBenchmarkIdentityResolver(pack);
    const questionById = new Map(pack.questions.map((question) => [question.id, question]));
    await applyProfile(apiUrl, workspace.id, configuration, stage);
    const appliedProfileEvidence = await profileEvidence?.(workspace.id, configuration);
    const partitionRows = await mapWithConcurrency(assignments, 8, async (assignment) => {
      const question = questionById.get(assignment.queryId);
      if (!question) throw new Error(`missing DEV question ${pack.label}/${assignment.queryId}`);
      const started = performance.now();
      let response;
      try {
        response = await request(apiUrl, "POST", `/workspaces/${encodeURIComponent(workspace.id)}/retrieval-trace`, {
          query: question.text,
          topK: CANDIDATE_DEPTH,
          tokenBudget: 12000,
          profileKey: configuration.profileKey,
          rerank: configuration.metadata.reranker,
        });
      } catch (error) {
        return {
          partition: pack.label,
          query_id: question.id,
          primary_bucket: assignment.reviewedPrimaryBucket,
          configuration_id: configuration.id,
          profile_key: configuration.profileKey,
          qrels: pack.qrelsByQuery.get(question.id) || [],
          retrieved_document_ids: [],
          candidate_overlap: {
            relevant_dense_only: [],
            relevant_lexical_only: [],
            relevant_both: [],
            relevant_neither: (pack.qrelsByQuery.get(question.id) || [])
              .filter((qrel) => qrel.grade > 0)
              .map((qrel) => qrel.document_id),
          },
          candidate_recall: 0,
          latency_ms: performance.now() - started,
          duplicate_count: 0,
          raw_result_count: 0,
          unidentified_count: 0,
          error_code: errorCode(error),
          error_class: errorClass(error),
          ...scoreQuery(question, [], pack.qrelsByQuery, TOP_K),
        };
      }
      assertRuntimeConfiguration(configuration, response);
      const runtimeConfigurationEvidence = responseEvidence?.(configuration, response, appliedProfileEvidence);
      const latencyMs = performance.now() - started;
      const rawResults = Array.isArray(response.stages?.finalCandidates) ? response.stages.finalCandidates : [];
      const collapsed = collapseResults(rawResults, { resolveDocumentId: identityResolver.resolve });
      const metrics = scoreQuery(question, collapsed.documents, pack.qrelsByQuery, TOP_K);
      metrics.duplicate_count = collapsed.duplicateCount;
      metrics.unidentified_count = collapsed.unidentifiedCount;
      metrics.raw_result_count = rawResults.length;
      const qrels = pack.qrelsByQuery.get(question.id) || [];
      const overlap = candidateOverlap(response.stages, qrels, identityResolver);
      const row = {
        partition: pack.label,
        query_id: question.id,
        primary_bucket: assignment.reviewedPrimaryBucket,
        configuration_id: configuration.id,
        profile_key: configuration.profileKey,
        qrels,
        retrieved_document_ids: collapsed.documents.slice(0, TOP_K).map((result) => result.documentId),
        ranked_document_ids: collapsed.documents.map((result) => result.documentId),
        candidate_overlap: overlap,
        candidate_recall: candidateRecall(overlap, qrels),
        latency_ms: latencyMs,
        retrieval_profile: response.retrievalProfile,
        retrieval_diagnostics: response.diagnostics,
        ...(runtimeConfigurationEvidence ? { runtime_configuration_evidence: runtimeConfigurationEvidence } : {}),
        ...metrics,
      };
      return row;
    });
    rows.push(...partitionRows);
    const latencies = partitionRows.map((row) => row.latency_ms).filter(Number.isFinite);
    const summary = aggregate(partitionRows, latencies);
    summary.candidate_recall = mean(partitionRows.map((row) => row.candidate_recall));
    summary.relevant_dense_only = countOverlap(partitionRows, "relevant_dense_only");
    summary.relevant_lexical_only = countOverlap(partitionRows, "relevant_lexical_only");
    summary.relevant_both = countOverlap(partitionRows, "relevant_both");
    summary.relevant_neither = countOverlap(partitionRows, "relevant_neither");
    configuration[`summary_${partition}`] = summary;
  }
  const result = {
    configuration: { ...configuration },
    summary: aggregate(rows, rows.map((row) => row.latency_ms).filter(Number.isFinite)),
    rows,
  };
  result.summary.candidate_recall = mean(rows.map((row) => row.candidate_recall));
  await writeJson(outputDir, `runs/${safeName(configuration.id)}.json`, result);
  return result;
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

export function assertRuntimeConfiguration(configuration, response) {
  const candidateStrategy = configuration.metadata.candidateStrategy;
  const expectedLexical = candidateStrategy !== "dense";
  const expectedDense = candidateStrategy !== "lexical";
  if (
    response.retrievalProfile?.key !== configuration.profileKey ||
    response.retrievalProfile?.lexicalEnabled !== expectedLexical
  ) {
    throw new Error(
      `${configuration.id}: runtime profile mismatch; expected ${configuration.profileKey}/${expectedLexical}, got ${response.retrievalProfile?.key}/${response.retrievalProfile?.lexicalEnabled}`,
    );
  }
  const expectsReranker = configuration.metadata.reranker?.enabled === true;
  const actualReranker = response.diagnostics?.reranked === true || response.diagnostics?.rerankerFallbackUsed === true;
  if (expectsReranker !== actualReranker) {
    throw new Error(`${configuration.id}: reranker runtime mismatch`);
  }
  if (!expectedDense && Number(response.diagnostics?.denseCandidates || 0) !== 0) {
    throw new Error(`${configuration.id}: lexical configuration unexpectedly invoked dense retrieval`);
  }
  if (expectedDense && Number(response.diagnostics?.denseCandidates || 0) === 0) {
    throw new Error(`${configuration.id}: dense configuration produced no dense candidates`);
  }
}

function selectLexicalLeg(results) {
  const summaries = results.map((result) => ({
    id: result.configuration.id,
    baseId: result.configuration.baseId || result.configuration.id,
    profileKey: result.configuration.profileKey,
    metadata: result.configuration.metadata,
    summary: result.summary,
    parameterHash: hash(result.configuration.metadata),
    resourceProfile: resourceProfile(result.configuration.metadata),
  }));
  const bestHit10 = Math.max(...summaries.map((item) => item.summary.hit_at_10));
  const bestRecall = Math.max(...summaries.map((item) => item.summary.candidate_recall));
  const eligible = summaries.filter(
    (item) => item.summary.hit_at_10 >= bestHit10 - 0.02 && item.summary.candidate_recall >= bestRecall - 0.02,
  );
  eligible.sort(compareSelectionCandidates);
  if (!eligible[0]) throw new Error("DEV lexical selection produced no eligible candidate");
  return { bestHit10, bestRecall, eligible, selection: eligible[0] };
}

function selectFusion(results) {
  const summaries = results.map((result) => ({
    id: result.configuration.id,
    baseId: result.configuration.baseId || result.configuration.id,
    profileKey: result.configuration.profileKey,
    metadata: result.configuration.metadata,
    summary: result.summary,
    parameterHash: hash(result.configuration.metadata),
    resourceProfile: resourceProfile(result.configuration.metadata),
  }));
  const bestHit10 = Math.max(...summaries.map((item) => item.summary.hit_at_10));
  const bestRecall = Math.max(...summaries.map((item) => item.summary.candidate_recall));
  const eligible = summaries.filter(
    (item) => item.summary.hit_at_10 >= bestHit10 - 0.02 && item.summary.candidate_recall >= bestRecall - 0.02,
  );
  eligible.sort(compareSelectionCandidates);
  if (!eligible[0]) throw new Error("DEV fusion selection produced no eligible candidate");
  return { bestHit10, bestRecall, eligible, selection: eligible[0], attempted: summaries };
}

function bindSelectionHash(selection) {
  return {
    ...selection,
    selectionHash: hash({ id: selection.id, metadata: selection.metadata, summary: selection.summary }),
  };
}

function summarizeAttempt(result) {
  return {
    id: result.configuration.id,
    baseId: result.configuration.baseId || result.configuration.id,
    stage: result.configuration.stage,
    profileKey: result.configuration.profileKey,
    metadata: result.configuration.metadata,
    parameterHash: hash(result.configuration.metadata),
    resourceProfile: resourceProfile(result.configuration.metadata),
    summary: result.summary,
  };
}

function compareSelectionCandidates(left, right) {
  const mrrDelta = right.summary.mrr - left.summary.mrr;
  if (Math.abs(mrrDelta) >= 0.02) return mrrDelta;
  return (
    resourceProfile(left.metadata).cost - resourceProfile(right.metadata).cost ||
    resourceProfile(left.metadata).complexity - resourceProfile(right.metadata).complexity ||
    left.summary.latency_p50_ms - right.summary.latency_p50_ms ||
    mrrDelta ||
    left.id.localeCompare(right.id)
  );
}

function resourceProfile(metadata) {
  const lexical = metadata.lexicalStrategy || null;
  const fusion = metadata.fusionStrategy || null;
  return {
    queryEmbeddingRequired: metadata.candidateStrategy !== "lexical",
    denseIndexRequired: metadata.candidateStrategy !== "lexical",
    rerankerRequired: metadata.reranker?.enabled === true,
    cost: (metadata.candidateStrategy !== "lexical" ? 2 : 1) + (metadata.reranker?.enabled ? 2 : 0),
    complexity:
      (lexical === "pg-fts" ? 1 : lexical === "structured" ? 2 : lexical === "bm25" ? 3 : lexical === "bm25f" ? 4 : 0) +
      (fusion === "legacy-weighted-rank" ? 1 : fusion === "rrf" ? 2 : fusion === "dbsf" ? 3 : 0),
  };
}

function errorCode(error) {
  return error?.code || (typeof error?.message === "string" ? error.message.split(":", 1)[0] : "benchmark_error");
}

function errorClass(error) {
  return error?.name || "Error";
}

function splitAssignmentsByPartition(split) {
  const result = new Map();
  for (const assignment of split.assignments) {
    if (assignment.split !== DEV_SPLIT) continue;
    const rows = result.get(assignment.partition.toLowerCase()) || [];
    rows.push(assignment);
    result.set(assignment.partition.toLowerCase(), rows);
  }
  return result;
}

function candidateOverlap(stages, qrels, identityResolver) {
  const relevant = new Set(qrels.filter((qrel) => qrel.grade > 0).map((qrel) => qrel.document_id));
  const dense = relevantFromResults(stages?.denseCandidates, relevant, identityResolver);
  const lexical = relevantFromResults(stages?.lexicalCandidates, relevant, identityResolver);
  return {
    relevant_dense_only: [...dense].filter((id) => !lexical.has(id)),
    relevant_lexical_only: [...lexical].filter((id) => !dense.has(id)),
    relevant_both: [...dense].filter((id) => lexical.has(id)),
    relevant_neither: [...relevant].filter((id) => !dense.has(id) && !lexical.has(id)),
  };
}

function relevantFromResults(results, relevant, identityResolver) {
  const found = new Set();
  for (const result of Array.isArray(results) ? results : []) {
    const documentId = identityResolver.resolve(result);
    if (documentId && relevant.has(documentId)) found.add(documentId);
  }
  return found;
}

function candidateRecall(overlap, qrels) {
  const positiveCount = qrels.filter((qrel) => qrel.grade > 0).length;
  if (!positiveCount) return 0;
  return (
    (overlap.relevant_dense_only.length + overlap.relevant_lexical_only.length + overlap.relevant_both.length) /
    positiveCount
  );
}

function countOverlap(rows, key) {
  return rows.reduce((sum, row) => sum + row.candidate_overlap[key].length, 0);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function renderReport(report) {
  const lines = [
    "# Retrieval Benchmark v2.1 DEV Selection",
    "",
    "Quality run over the frozen DEV split only; HOLDOUT was not read or scored.",
    "",
    `Split: ${report.split.devCount} DEV / ${report.split.holdoutCount} HOLDOUT (${report.split.checksumSha256})`,
    `Models: ${report.runtime.embeddingModel} (${report.runtime.embeddingDimension}d), ${report.runtime.rerankerModel}`,
    "",
    "| Configuration | Hit@10 | MRR | Candidate recall | p50 ms |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const attempt of report.attemptedConfigurations) {
    const summary = attempt.summary;
    lines.push(
      `| ${attempt.id} | ${pct(summary.hit_at_10)} | ${summary.mrr.toFixed(4)} | ${pct(summary.candidate_recall)} | ${Math.round(summary.latency_p50_ms)} |`,
    );
  }
  lines.push(
    "",
    `Selected lexical leg: **${report.selected.lexicalLeg?.id || "pending"}**`,
    `Selected fusion: **${report.selected.fusion?.id || "pending"}**`,
    "",
  );
  return `${lines.join("\n")}\n`;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

export function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function writeJson(directory, relativePath, value) {
  const target = path.join(directory, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function pollJob(apiUrl, jobId, timeoutMs = 30 * 60 * 1000) {
  const started = Date.now();
  for (;;) {
    const job = await request(apiUrl, "GET", `/jobs/indexing/${jobId}`);
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() - started > timeoutMs) throw new Error(`index job ${jobId} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export async function deleteWorkspace(apiUrl, workspaceId) {
  try {
    await request(apiUrl, "DELETE", `/knowledge-bases/${encodeURIComponent(workspaceId)}`);
    return;
  } catch {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      await prisma.knowledgeBase.update({
        where: { id: workspaceId },
        data: { activeIndexVersionId: null, activeServingRevisionId: null },
      });
      await prisma.workspaceVectorPlacement.updateMany({
        where: { knowledgeBaseId: workspaceId },
        data: { servingRevisionId: null, activeIndexBuildId: null },
      });
      await prisma.workspaceServingManifestEntry.deleteMany({
        where: { workspaceServingRevision: { knowledgeBaseId: workspaceId } },
      });
      await prisma.knowledgeBase.delete({ where: { id: workspaceId } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

export async function request(apiUrl, method, route, body) {
  const headers = { "Content-Type": "application/json" };
  const apiKey = process.env.INFO_WARDEN_API_KEY || process.env.CONTEXTFORGE_API_KEY || process.env.ADMIN_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${apiUrl}${route}`, {
    method,
    headers: body === undefined ? { ...headers, "Content-Type": undefined } : headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  if (!response.ok)
    throw new Error(`${method} ${route} -> HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  return payload;
}
