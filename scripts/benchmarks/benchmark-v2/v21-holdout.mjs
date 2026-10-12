import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { aggregate, loadPartition } from "./contract.mjs";
import { validateV21Harness } from "./v21-matrix.mjs";
import { deleteWorkspace, prepareWorkspace, request, runConfiguration, safeName, writeJson } from "./v21-dev.mjs";

const HOLDOUT_SPLIT = "HOLDOUT";
const REPETITIONS = 3;
const OUTPUT_RELATIVE = "fixtures/eval/benchmark-v2/reports/v2.1-holdout";
const WORKSPACE_ROOT_RELATIVE = ".contextforge/benchmarks/benchmark-v2.1-holdout";

export async function runV21Holdout(repoRoot, options = {}) {
  const apiUrl = options.apiUrl || process.env.INFO_WARDEN_API_URL || "http://localhost:3000";
  const outputDir = path.resolve(repoRoot, options.output || OUTPUT_RELATIVE);
  const workRoot = path.resolve(repoRoot, WORKSPACE_ROOT_RELATIVE);
  const { split, matrix, configurations: frozenConfigurations } = await validateV21Harness(repoRoot);
  const devReport = await readJson(
    path.resolve(repoRoot, "fixtures/eval/benchmark-v2/reports/v2.1-dev/benchmark-v21-dev-summary.json"),
  );
  const fusionReport = await readJson(
    path.resolve(repoRoot, "fixtures/eval/benchmark-v2/reports/v2.1-dev/controlled-fusion-selection.json"),
  );
  const configurations = buildHoldoutConfigurations(devReport, fusionReport);
  assertFrozenConfigurationContract(devReport, fusionReport, matrix, frozenConfigurations, configurations);
  const splitByPartition = holdoutAssignmentsByPartition(split);
  const packs = new Map();
  for (const partition of ["en", "ru", "mixed"]) {
    const assignments = splitByPartition.get(partition) || [];
    if (!assignments.length) throw new Error(`frozen HOLDOUT split has no assignments for ${partition}`);
    packs.set(partition, loadPartition(repoRoot, partition, { queryIds: assignments.map((row) => row.queryId) }));
  }

  if (await exists(outputDir)) {
    throw new Error(`refusing to overwrite existing HOLDOUT evidence: ${path.relative(repoRoot, outputDir)}`);
  }
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
    embeddingBaseUrl: process.env.EMBEDDING_BASE_URL || null,
    rerankerBaseUrl: process.env.RERANKER_BASE_URL || null,
  };
  runtime.modelVerification = await verifyModelIdentity(runtime);

  const report = {
    formatVersion: "infowarden-benchmark-v21-holdout-report.v1",
    qualityRun: true,
    split: {
      path: "fixtures/eval/benchmark-v2/metadata/v2.1-split.json",
      checksumSha256: split.splitChecksumSha256,
      assignmentCount: split.assignments.length,
      devCount: split.counts.DEV,
      holdoutCount: split.counts.HOLDOUT,
      executedSplit: HOLDOUT_SPLIT,
    },
    methodology: {
      matrixChecksumSha256: matrix.matrixChecksumSha256,
      configurationChecksumSha256: devReport.methodology.configurationChecksumSha256,
      selectedFromDevCandidate: devReport.completedAt,
      tuningPerformed: false,
      historicalV2PerQueryHoldoutRead: false,
      repetitions: REPETITIONS,
    },
    runtime,
    configurations: configurations.map((configuration) => ({
      id: configuration.id,
      metadata: configuration.metadata,
      parameterHash: configuration.parameterHash,
      resourceProfile: resourceProfile(configuration.metadata),
    })),
    workspaces: [],
    attemptedConfigurations: [],
  };

  const workspaces = new Map();
  try {
    for (const partition of ["en", "ru", "mixed"]) {
      const pack = packs.get(partition);
      const assignments = splitByPartition.get(partition) || [];
      const workspace = await prepareWorkspace(apiUrl, workRoot, pack, assignments, "HOLDOUT");
      workspaces.set(partition, workspace);
      report.workspaces.push({
        partition: pack.label,
        workspaceId: workspace.id,
        sourceId: workspace.sourceId,
        indexJobId: workspace.indexJobId,
        indexBuildDurationMs: workspace.indexBuildDurationMs,
        documentCount: pack.documents.length,
        holdoutQueryCount: assignments.length,
        resourceObservation: await observeResources(apiUrl, workspace.id),
      });
    }

    for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
      const repetitionDir = path.join(outputDir, "repetitions", `repetition-${repetition}`);
      for (const configuration of configurations) {
        const result = await runConfiguration({
          apiUrl,
          packs,
          splitByPartition,
          workspaces,
          configuration,
          outputDir: repetitionDir,
          stage: "HOLDOUT",
        });
        result.rows = result.rows.map((row) => ({ ...row, repetition }));
        result.repetition = repetition;
        result.split = HOLDOUT_SPLIT;
        await writeJson(repetitionDir, `runs/${safeName(configuration.id)}.json`, result);
      }
    }

    for (const configuration of configurations) {
      const rows = [];
      for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
        const file = await readJson(
          path.join(outputDir, "repetitions", `repetition-${repetition}`, "runs", `${safeName(configuration.id)}.json`),
        );
        rows.push(...file.rows);
      }
      const summary = summarizeRows(rows);
      const result = {
        formatVersion: "infowarden-benchmark-v21-holdout-run.v1",
        configuration,
        split: HOLDOUT_SPLIT,
        repetitions: REPETITIONS,
        summary,
        rows,
      };
      await writeJson(outputDir, `runs/${safeName(configuration.id)}.json`, result);
      report.attemptedConfigurations.push({
        id: configuration.id,
        metadata: configuration.metadata,
        parameterHash: configuration.parameterHash,
        resourceProfile: resourceProfile(configuration.metadata),
        summary,
        providerCallAccounting: providerCallAccounting(configuration.metadata, rows, report.workspaces),
      });
    }

    report.completedAt = new Date().toISOString();
    await writeJson(outputDir, "benchmark-v21-holdout-summary.json", report);
    await fs.writeFile(path.join(outputDir, "report.md"), renderReport(report));
    console.log(`benchmark-v2.1 HOLDOUT report: ${path.relative(repoRoot, outputDir)}`);
  } finally {
    for (const workspace of workspaces.values()) {
      await deleteWorkspace(apiUrl, workspace.id).catch((error) => {
        console.error(`warning: failed to delete benchmark workspace ${workspace.id}: ${error.message}`);
      });
    }
  }
}

function buildHoldoutConfigurations(devReport, fusionReport) {
  const selectedLexical = devReport.selected?.lexicalLeg;
  const selectedFusion = devReport.selected?.fusion;
  if (!selectedLexical || !selectedFusion) throw new Error("0200 report has no selected lexical leg/fusion");
  const rerankerPairs = new Map((devReport.selected.rerankerPairs || []).map((item) => [item.id, item]));
  const fusionAttempts = fusionReport.attempted || [];
  const bestByBaseId = (baseId) => {
    const candidates = fusionAttempts.filter((item) => item.baseId === baseId);
    candidates.sort((left, right) => right.summary.mrr - left.summary.mrr || left.id.localeCompare(right.id));
    if (!candidates[0]) throw new Error(`0200 report has no frozen ${baseId} configuration`);
    return candidates[0];
  };
  const dense = rerankerPairs.get("dense");
  const denseReranker = rerankerPairs.get("dense-reranker");
  const lexical = rerankerPairs.get("lexical-lstar");
  const lexicalReranker = rerankerPairs.get("lexical-lstar-reranker");
  const selectedFusionPair = rerankerPairs.get("fusion-selected-reranker");
  for (const [name, value] of Object.entries({ dense, denseReranker, lexical, lexicalReranker, selectedFusionPair })) {
    if (!value) throw new Error(`0200 report is missing frozen reranker pair: ${name}`);
  }
  const controls = [selectedFusion, bestByBaseId("fusion-rrf"), bestByBaseId("fusion-dbsf")];
  const unique = new Map();
  for (const item of [dense, denseReranker, lexical, lexicalReranker, ...controls, selectedFusionPair]) {
    const metadata = item.metadata;
    const key = hash(metadata);
    if (!unique.has(key)) {
      unique.set(key, {
        id: item.id,
        profileKey: `v21-holdout-${safeName(item.id)}`,
        metadata,
        parameterHash: item.parameterHash || hash(metadata),
      });
    }
  }
  return [...unique.values()];
}

function assertFrozenConfigurationContract(devReport, fusionReport, matrix, frozenConfigurations, configurations) {
  if (devReport.methodology?.matrixChecksumSha256 !== matrix.matrixChecksumSha256) {
    throw new Error("0200 DEV report matrix checksum does not match the frozen v2.1 matrix");
  }
  if (devReport.methodology?.configurationChecksumSha256 !== frozenConfigurations.configurationChecksumSha256) {
    throw new Error("0200 DEV report configuration checksum is not bound to the frozen v2.1 configuration metadata");
  }
  for (const item of [
    devReport.selected?.lexicalLeg,
    devReport.selected?.fusion,
    ...(devReport.selected?.rerankerPairs || []),
    fusionReport.selection,
    ...(fusionReport.attempted || []),
  ]) {
    if (item) assertParameterHash(item);
  }
  for (const configuration of configurations) {
    if (configuration.parameterHash !== hash(configuration.metadata)) {
      throw new Error(`HOLDOUT configuration hash mismatch: ${configuration.id}`);
    }
  }
}

function assertParameterHash(item) {
  if (item.parameterHash !== hash(item.metadata)) {
    throw new Error(`frozen DEV parameter hash mismatch: ${item.id || item.baseId || "unknown"}`);
  }
}

function holdoutAssignmentsByPartition(split) {
  const result = new Map();
  for (const assignment of split.assignments) {
    if (assignment.split !== HOLDOUT_SPLIT) continue;
    const key = assignment.partition.toLowerCase();
    const rows = result.get(key) || [];
    rows.push(assignment);
    result.set(key, rows);
  }
  return result;
}

function summarizeRows(rows) {
  const summary = aggregate(rows, rows.map((row) => row.latency_ms).filter(Number.isFinite));
  summary.candidate_recall = mean(rows.map((row) => row.candidate_recall));
  summary.relevant_dense_only = countOverlap(rows, "relevant_dense_only");
  summary.relevant_lexical_only = countOverlap(rows, "relevant_lexical_only");
  summary.relevant_both = countOverlap(rows, "relevant_both");
  summary.relevant_neither = countOverlap(rows, "relevant_neither");
  summary.repetitionCount = new Set(rows.map((row) => row.repetition)).size;
  return summary;
}

function countOverlap(rows, key) {
  return rows.reduce((sum, row) => sum + (row.candidate_overlap?.[key]?.length || 0), 0);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function verifyModelIdentity(runtime) {
  if (runtime.embeddingModel !== "qwen3-embedding-0.6b" || runtime.embeddingDimension !== 1024) {
    throw new Error("HOLDOUT requires qwen3-embedding-0.6b at 1024 dimensions");
  }
  if (runtime.rerankerModel !== "qwen3-reranker-0.6b") {
    throw new Error("HOLDOUT requires qwen3-reranker-0.6b");
  }
  const embedding = await queryModelEndpoint(runtime.embeddingBaseUrl, runtime.embeddingModel);
  const reranker = await queryModelEndpoint(runtime.rerankerBaseUrl, runtime.rerankerModel);
  return { embedding, reranker };
}

async function queryModelEndpoint(baseUrl, expectedModel) {
  if (!baseUrl) throw new Error(`model endpoint is required to verify ${expectedModel}`);
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/$/, "");
  url.pathname = `${basePath.endsWith("/v1") ? basePath : `${basePath}/v1`}/models`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`model endpoint ${url} returned HTTP ${response.status}`);
  const payload = await response.json();
  const advertised = [
    ...(Array.isArray(payload.models) ? payload.models : []),
    ...(Array.isArray(payload.data) ? payload.data : []),
  ].flatMap((model) => [model?.id, model?.name, model?.model, ...(Array.isArray(model?.aliases) ? model.aliases : [])]);
  if (!advertised.includes(expectedModel)) {
    throw new Error(`model endpoint ${url} does not advertise ${expectedModel}`);
  }
  return { url: String(url), expectedModel, advertisedModels: [...new Set(advertised.filter(Boolean))] };
}

async function observeResources(apiUrl, workspaceId) {
  const value = await request(apiUrl, "GET", `/workspaces/${encodeURIComponent(workspaceId)}/resources`);
  return {
    lifecycle: value.lifecycle || null,
    estimate: value.estimate || null,
    resources: value.resources || null,
    activeIndexVersion: value.activeIndexVersion
      ? {
          id: value.activeIndexVersion.id || null,
          storageProfile: value.activeIndexVersion.storageProfile || null,
          storageConfig: value.activeIndexVersion.storageConfig || null,
          resourceActual: value.activeIndexVersion.resourceActual || null,
        }
      : null,
  };
}

function providerCallAccounting(metadata, rows, workspaces) {
  const queryCount = rows.length;
  const dense = metadata.candidateStrategy !== "lexical";
  const reranker = metadata.reranker?.enabled === true;
  const indexingChunks = workspaces.reduce(
    (total, workspace) =>
      total + Number(workspace.resourceObservation?.activeIndexVersion?.resourceActual?.chunks || 0),
    0,
  );
  return {
    queryEmbeddingCallsExpected: dense ? queryCount : 0,
    rerankerCallsExpected: reranker ? queryCount : 0,
    indexingEmbeddingCallsExpected: indexingChunks,
    accountingBasis:
      "derived from frozen mode semantics and observed indexed chunk counts; API exposes no provider counter",
  };
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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function renderReport(report) {
  const lines = [
    "# Retrieval Benchmark v2.1 HOLDOUT",
    "",
    "Quality run over the immutable HOLDOUT split; no tuning or winner changes were performed.",
    "",
    `Split: ${report.split.holdoutCount} HOLDOUT / ${report.split.devCount} DEV (${report.split.checksumSha256})`,
    `Repetitions: ${report.methodology.repetitions}`,
    `Models: ${report.runtime.embeddingModel} (${report.runtime.embeddingDimension}d), ${report.runtime.rerankerModel}`,
    "",
    "| Configuration | Hit@10 | MRR | Candidate recall | p50 ms | Failed |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const attempt of report.attemptedConfigurations) {
    const summary = attempt.summary;
    lines.push(
      `| ${attempt.id} | ${(summary.hit_at_10 * 100).toFixed(1)}% | ${summary.mrr.toFixed(4)} | ${(summary.candidate_recall * 100).toFixed(1)}% | ${Math.round(summary.latency_p50_ms)} | ${summary.failed_query_count} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
