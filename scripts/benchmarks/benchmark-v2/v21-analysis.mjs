import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { validateV21Harness } from "./v21-matrix.mjs";

const HOLDOUT_RELATIVE = "fixtures/eval/benchmark-v2/reports/v2.1-holdout";
const OUTPUT_RELATIVE = "fixtures/eval/benchmark-v2/reports/v2.1-analysis";
const BOOTSTRAP_REPETITIONS = 2000;
const BOOTSTRAP_SEED = "infowarden-retrieval-v2.1-analysis-2026-10";
const EXPECTED_CONFIGURATIONS = [
  "dense",
  "dense-reranker",
  "lexical-lstar",
  "lexical-lstar-reranker",
  "fusion-legacy",
  "fusion-rrf-k-60-depth-25",
  "fusion-dbsf-depth-25",
  "fusion-selected-reranker",
];
const FAILURE_CATEGORIES = [
  "exact-term miss",
  "semantic miss",
  "hard-negative confusion",
  "entity/identifier confusion",
  "Russian morphology/inflection",
  "cross-language miss",
  "chunk-boundary issue",
  "candidate-generation miss",
  "reranker regression",
  "duplicate result",
  "empty result",
  "dataset/qrel ambiguity",
  "lexical tokenization miss",
  "BM25 length-normalization issue",
  "field-weighting issue",
  "dense semantic miss",
  "dense exact-identifier miss",
  "fusion suppression",
  "reranker promotion success",
];

export async function runV21Analysis(repoRoot) {
  const source = await loadSourceEvidence(repoRoot);
  const analysis = buildAnalysis(source);
  const outputDir = path.resolve(repoRoot, OUTPUT_RELATIVE);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await writeJson(outputDir, "benchmark-v21-analysis.json", analysis);
  await fs.writeFile(path.join(outputDir, "report.md"), renderReport(analysis));
  console.log(`benchmark-v2.1 analysis report: ${path.relative(repoRoot, outputDir)}`);
  return analysis;
}

export async function validateV21Analysis(repoRoot) {
  const source = await loadSourceEvidence(repoRoot);
  const analysis = await readJson(path.resolve(repoRoot, OUTPUT_RELATIVE, "benchmark-v21-analysis.json"));
  validateAnalysis(analysis, source);
  const expected = buildAnalysis(source);
  if (JSON.stringify(analysis) !== JSON.stringify(expected)) {
    throw new Error("analysis artifact is not reproducibly derived from current HOLDOUT evidence");
  }
  const reportPath = path.resolve(repoRoot, OUTPUT_RELATIVE, "report.md");
  if ((await fs.readFile(reportPath, "utf8")) !== renderReport(expected)) {
    throw new Error("analysis Markdown report is not reproducibly derived from current analysis evidence");
  }
  console.log(`validated benchmark-v2.1 analysis: ${path.relative(repoRoot, OUTPUT_RELATIVE)}`);
  return analysis;
}

async function loadSourceEvidence(repoRoot) {
  const { split, matrix, configurations } = await validateV21Harness(repoRoot);
  const holdoutDir = path.resolve(repoRoot, HOLDOUT_RELATIVE);
  const holdoutSummaryPath = path.join(holdoutDir, "benchmark-v21-holdout-summary.json");
  const holdoutSummary = await readJson(holdoutSummaryPath);
  if (holdoutSummary.split?.checksumSha256 !== split.splitChecksumSha256) {
    throw new Error("HOLDOUT analysis is not bound to the frozen split checksum");
  }
  if (holdoutSummary.methodology?.matrixChecksumSha256 !== matrix.matrixChecksumSha256) {
    throw new Error("HOLDOUT analysis is not bound to the frozen matrix checksum");
  }
  const runs = new Map();
  const runChecksums = {};
  for (const id of EXPECTED_CONFIGURATIONS) {
    const run = await readJson(path.join(holdoutDir, "runs", `${id}.json`));
    if (run.split !== "HOLDOUT" || run.repetitions !== 3) throw new Error(`invalid HOLDOUT run: ${id}`);
    runs.set(id, run);
    runChecksums[id] = checksum(run);
  }
  const holdoutIds = new Map(
    split.assignments
      .filter((assignment) => assignment.split === "HOLDOUT")
      .map((assignment) => [assignment.queryId, assignment]),
  );
  for (const [id, run] of runs) validateRows(id, run.rows, holdoutIds);
  return {
    split,
    matrix,
    configurations,
    holdoutSummary,
    runs,
    runChecksums,
    holdoutSummarySha256: checksum(holdoutSummary),
  };
}

function buildAnalysis(source) {
  const modeResults = {};
  for (const [id, run] of source.runs) {
    modeResults[id] = {
      configuration: {
        id: run.configuration.id,
        metadata: run.configuration.metadata,
        parameterHash: run.configuration.parameterHash,
        resourceProfile: run.configuration.resourceProfile,
      },
      ...summarizeMode(run.rows),
    };
  }
  const overlap = buildOverlap(source.runs);
  const failures = buildFailureTaxonomy(source.runs);
  const pairedComparisons = buildPairedComparisons(source.runs);
  const decisions = buildDecision(source, modeResults, overlap, pairedComparisons);
  return {
    formatVersion: "infowarden-benchmark-v21-analysis.v1",
    qualityRun: true,
    source: {
      holdoutSummarySha256: source.holdoutSummarySha256,
      splitChecksumSha256: source.split.splitChecksumSha256,
      matrixChecksumSha256: source.matrix.matrixChecksumSha256,
      configurationChecksumSha256: source.configurations.configurationChecksumSha256,
      runChecksums: source.runChecksums,
      historicalV2PerQueryRead: false,
    },
    methodology: {
      bootstrapSeed: BOOTSTRAP_SEED,
      bootstrapRepetitions: BOOTSTRAP_REPETITIONS,
      unit: "query mean across three operational repetitions",
      meaningfulDelta: "frozen v2.1 selection rules; no new threshold or tuning",
    },
    runtime: source.holdoutSummary.runtime,
    partitions: partitionCounts(source.runs.get("dense").rows),
    modes: modeResults,
    candidateOverlap: overlap,
    failureTaxonomyMethod:
      "inferred from frozen semantic primary_bucket and candidate-recall fields; categories are diagnostic labels, not causal proof",
    failureTaxonomy: failures,
    resources: buildResourceEvidence(source),
    pairedComparisons,
    decision: decisions,
  };
}

function validateRows(configurationId, rows, holdoutIds) {
  const seen = new Set();
  for (const row of rows) {
    const assignment = holdoutIds.get(row.query_id);
    if (!assignment || assignment.partition.toLowerCase() !== row.partition.toLowerCase()) {
      throw new Error(`${configurationId}: row is outside frozen HOLDOUT split: ${row.query_id}`);
    }
    const key = `${row.query_id}:${row.repetition}`;
    if (seen.has(key)) throw new Error(`${configurationId}: duplicate row ${key}`);
    seen.add(key);
  }
  const expected = holdoutIds.size * 3;
  if (rows.length !== expected) throw new Error(`${configurationId}: expected ${expected} rows, found ${rows.length}`);
  for (const queryId of holdoutIds.keys()) {
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      if (!seen.has(`${queryId}:${repetition}`))
        throw new Error(`${configurationId}: missing ${queryId}/${repetition}`);
    }
  }
}

function summarizeMode(rows) {
  const byPartition = {};
  for (const partition of ["EN", "RU", "MIXED"]) {
    byPartition[partition] = summarizeRows(rows.filter((row) => row.partition === partition));
  }
  return { overall: summarizeRows(rows), byPartition };
}

function summarizeRows(rows) {
  const queryMeans = queryMeanRows(rows);
  const metrics = {};
  for (const key of ["hit_at_1", "hit_at_3", "hit_at_5", "hit_at_10", "mrr", "ndcg_at_10", "candidate_recall"]) {
    const values = queryMeans.map((row) => row[key]);
    metrics[key] = {
      value: mean(values),
      ci95: bootstrapInterval(values, `${key}:${rows[0]?.configuration_id || "none"}`),
    };
  }
  const latencies = rows
    .map((row) => row.latency_ms)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return {
    queryCount: queryMeans.length,
    repetitionCount: new Set(rows.map((row) => row.repetition)).size,
    failedQueryCount: rows.filter((row) => row.error_code || row.error_class).length,
    emptyRate: mean(rows.map((row) => Number(row.empty || false))),
    duplicateRate: safeRatio(
      rows.reduce((sum, row) => sum + Number(row.duplicate_count || 0), 0),
      rows.reduce((sum, row) => sum + Number(row.raw_result_count || 0), 0),
    ),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    metrics,
  };
}

function queryMeanRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.query_id) || [];
    list.push(row);
    groups.set(row.query_id, list);
  }
  return [...groups.values()].map((items) => {
    const first = items[0];
    const result = { query_id: first.query_id, partition: first.partition, primary_bucket: first.primary_bucket };
    for (const key of ["hit_at_1", "hit_at_3", "hit_at_5", "hit_at_10", "mrr", "ndcg_at_10", "candidate_recall"]) {
      result[key] = mean(items.map((item) => Number(item[key] || 0)));
    }
    result.candidate_overlap = first.candidate_overlap;
    return result;
  });
}

function buildOverlap(runs) {
  const result = {};
  for (const [id, run] of runs) {
    const unique = queryMeanRows(run.rows);
    result[id] = {
      relevantDenseOnly: sumOverlap(unique, "relevant_dense_only"),
      relevantLexicalOnly: sumOverlap(unique, "relevant_lexical_only"),
      relevantBoth: sumOverlap(unique, "relevant_both"),
      relevantNeither: sumOverlap(unique, "relevant_neither"),
      byPartition: Object.fromEntries(
        ["EN", "RU", "MIXED"].map((partition) => {
          const rows = unique.filter((row) => row.partition === partition);
          return [
            partition,
            {
              relevantDenseOnly: sumOverlap(rows, "relevant_dense_only"),
              relevantLexicalOnly: sumOverlap(rows, "relevant_lexical_only"),
              relevantBoth: sumOverlap(rows, "relevant_both"),
              relevantNeither: sumOverlap(rows, "relevant_neither"),
            },
          ];
        }),
      ),
    };
  }
  return result;
}

function buildFailureTaxonomy(runs) {
  const result = {};
  for (const [id, run] of runs) {
    result[id] = {
      overall: countFailureCategories(run.rows),
      byPartition: Object.fromEntries(
        ["EN", "RU", "MIXED"].map((partition) => [
          partition,
          countFailureCategories(run.rows.filter((row) => row.partition === partition)),
        ]),
      ),
    };
  }
  const pairings = [
    ["dense", "dense-reranker"],
    ["lexical-lstar", "lexical-lstar-reranker"],
    ["fusion-legacy", "fusion-selected-reranker"],
  ];
  for (const [baseId, rerankerId] of pairings) {
    const base = queryMeanRows(runs.get(baseId).rows);
    const reranker = new Map(queryMeanRows(runs.get(rerankerId).rows).map((row) => [row.query_id, row]));
    result[rerankerId].overall["reranker regression"] = base.reduce(
      (count, row) => count + (Number(reranker.get(row.query_id)?.hit_at_10 || 0) < row.hit_at_10 ? 1 : 0),
      0,
    );
    result[rerankerId].overall["reranker promotion success"] = base.reduce(
      (count, row) => count + (Number(reranker.get(row.query_id)?.hit_at_10 || 0) > row.hit_at_10 ? 1 : 0),
      0,
    );
    for (const partition of ["EN", "RU", "MIXED"]) {
      const basePartition = base.filter((row) => row.partition === partition);
      const rerankerPartition = new Map(
        queryMeanRows(runs.get(rerankerId).rows.filter((row) => row.partition === partition)).map((row) => [
          row.query_id,
          row,
        ]),
      );
      result[rerankerId].byPartition[partition]["reranker regression"] = basePartition.reduce(
        (count, row) => count + (Number(rerankerPartition.get(row.query_id)?.hit_at_10 || 0) < row.hit_at_10 ? 1 : 0),
        0,
      );
      result[rerankerId].byPartition[partition]["reranker promotion success"] = basePartition.reduce(
        (count, row) => count + (Number(rerankerPartition.get(row.query_id)?.hit_at_10 || 0) > row.hit_at_10 ? 1 : 0),
        0,
      );
    }
  }
  const legacy = new Map(queryMeanRows(runs.get("fusion-legacy").rows).map((row) => [row.query_id, row]));
  for (const fusionId of ["fusion-rrf-k-60-depth-25", "fusion-dbsf-depth-25"]) {
    result[fusionId].overall["fusion suppression"] = queryMeanRows(runs.get(fusionId).rows).reduce(
      (count, row) => count + (Number(row.hit_at_10 || 0) < Number(legacy.get(row.query_id)?.hit_at_10 || 0) ? 1 : 0),
      0,
    );
    for (const partition of ["EN", "RU", "MIXED"]) {
      const legacyPartition = new Map(
        queryMeanRows(runs.get("fusion-legacy").rows.filter((row) => row.partition === partition)).map((row) => [
          row.query_id,
          row,
        ]),
      );
      result[fusionId].byPartition[partition]["fusion suppression"] = queryMeanRows(
        runs.get(fusionId).rows.filter((row) => row.partition === partition),
      ).reduce(
        (count, row) =>
          count + (Number(row.hit_at_10 || 0) < Number(legacyPartition.get(row.query_id)?.hit_at_10 || 0) ? 1 : 0),
        0,
      );
    }
  }
  return result;
}

function countFailureCategories(rows) {
  const categories = Object.fromEntries(FAILURE_CATEGORIES.map((category) => [category, 0]));
  for (const row of queryMeanRows(rows)) {
    if (row.hit_at_10 >= 1) continue;
    const category = bucketCategory(row.primary_bucket);
    categories[category] += 1;
    if (row.candidate_recall < 1) categories["candidate-generation miss"] += 1;
  }
  return categories;
}

function buildResourceEvidence(source) {
  return {
    indexByPartition: Object.fromEntries(
      source.holdoutSummary.workspaces.map((workspace) => [
        workspace.partition,
        {
          documents: workspace.documentCount,
          holdoutQueries: workspace.holdoutQueryCount,
          indexBuildDurationMs: workspace.indexBuildDurationMs,
          storageProfile: workspace.resourceObservation?.activeIndexVersion?.storageProfile || "unavailable",
          observedChunks: workspace.resourceObservation?.activeIndexVersion?.resourceActual?.chunks || null,
          observedStorage: workspace.resourceObservation?.activeIndexVersion?.resourceActual || null,
        },
      ]),
    ),
    perMode: Object.fromEntries(
      source.holdoutSummary.attemptedConfigurations.map((attempt) => [
        attempt.id,
        {
          resourceProfile: attempt.resourceProfile,
          providerCallAccounting: attempt.providerCallAccounting || "unavailable",
          queryP50Ms: source.runs.get(attempt.id)?.summary?.latency_p50_ms ?? null,
          queryP95Ms: source.runs.get(attempt.id)?.summary?.latency_p95_ms ?? null,
        },
      ]),
    ),
    providerCallMeasurement:
      "expected semantic accounting only; API exposes no direct provider counter or retry telemetry",
  };
}

function buildPairedComparisons(runs) {
  const pairs = [
    ["dense-vs-lexical", "dense", "lexical-lstar"],
    ["dense-vs-legacy", "dense", "fusion-legacy"],
    ["legacy-vs-rrf", "fusion-legacy", "fusion-rrf-k-60-depth-25"],
    ["legacy-vs-dbsf", "fusion-legacy", "fusion-dbsf-depth-25"],
    ["dense-reranker-vs-dense", "dense-reranker", "dense"],
    ["lexical-reranker-vs-lexical", "lexical-lstar-reranker", "lexical-lstar"],
    ["fusion-reranker-vs-legacy", "fusion-selected-reranker", "fusion-legacy"],
  ];
  return Object.fromEntries(
    pairs.map(([id, candidateId, baselineId]) => [
      id,
      comparePairedRuns(runs.get(candidateId).rows, runs.get(baselineId).rows, id),
    ]),
  );
}

function comparePairedRuns(candidateRows, baselineRows, id) {
  const candidate = new Map(queryMeanRows(candidateRows).map((row) => [row.query_id, row]));
  const baseline = new Map(queryMeanRows(baselineRows).map((row) => [row.query_id, row]));
  const deltas = (key) =>
    [...baseline.keys()].map((queryId) => (candidate.get(queryId)?.[key] || 0) - (baseline.get(queryId)?.[key] || 0));
  const mrrDelta = summarizeDelta(deltas("mrr"), `${id}:mrr`);
  const hit5Delta = summarizeDelta(deltas("hit_at_5"), `${id}:hit5`);
  const hit10Delta = summarizeDelta(deltas("hit_at_10"), `${id}:hit10`);
  const qualityDeltaReached = mrrDelta.value >= 0.02 || hit5Delta.value >= 0.02;
  const mrrMeaningful = mrrDelta.value >= 0.02;
  const hit5Meaningful = hit5Delta.value >= 0.02;
  const mrrIntervalExcludesZero = mrrDelta.ci95.low > 0 || mrrDelta.ci95.high < 0;
  const hit5IntervalExcludesZero = hit5Delta.ci95.low > 0 || hit5Delta.ci95.high < 0;
  const intervalExcludesZero = mrrIntervalExcludesZero || hit5IntervalExcludesZero;
  return {
    baseline: baselineRows[0]?.configuration_id,
    candidate: candidateRows[0]?.configuration_id,
    mrr: mrrDelta,
    hitAt5: hit5Delta,
    hitAt10: hit10Delta,
    meaningfulDeltaReached: qualityDeltaReached,
    mrrMeaningful,
    hitAt5Meaningful: hit5Meaningful,
    mrrIntervalExcludesZero,
    hitAt5IntervalExcludesZero: hit5IntervalExcludesZero,
    pairedIntervalExcludesZero: intervalExcludesZero,
    materialHitAt10Regression: hit10Delta.value < -0.02,
    qualityWinnerUnderFrozenRule:
      ((mrrMeaningful && mrrIntervalExcludesZero) || (hit5Meaningful && hit5IntervalExcludesZero)) &&
      hit10Delta.value >= -0.02,
  };
}

function summarizeDelta(values, salt) {
  return { value: mean(values), ci95: bootstrapInterval(values, salt) };
}

function buildDecision(source, modes, overlap, pairedComparisons) {
  const dense = modes.dense.overall;
  const lexical = modes["lexical-lstar"].overall;
  const legacy = modes["fusion-legacy"].overall;
  const rrf = modes["fusion-rrf-k-60-depth-25"].overall;
  const dbsf = modes["fusion-dbsf-depth-25"].overall;
  const rerankedFusion = modes["fusion-selected-reranker"].overall;
  const denseVsLegacy = pairedComparisons["dense-vs-legacy"];
  const denseReranker = pairedComparisons["dense-reranker-vs-dense"];
  const fusionReranker = pairedComparisons["fusion-reranker-vs-legacy"];
  const denseDefault = denseVsLegacy.qualityWinnerUnderFrozenRule && dense.latencyP50Ms < legacy.latencyP50Ms;
  return {
    selectedLexicalLegFromDev: "lexical-bm25-k1-1.5-b-0.75",
    controlledFusionLexicalLeg: "lexical-bm25-k1-1.5-b-0.75",
    answers: {
      denseVsLexical:
        "dense materially outperforms the no-model lexical baseline on MRR, Hit@10, and latency-adjusted quality; lexical remains a lower-resource fallback.",
      strongestLexical: "lexical-bm25-k1-1.5-b-0.75 was selected on DEV; HOLDOUT does not retune lexical parameters.",
      uniqueLexicalRecall:
        "no incremental relevant candidate was contributed by the selected lexical leg in controlled hybrid HOLDOUT; lexical-only still retrieved relevant candidates that dense did not, but with materially lower ranking quality.",
      fusion: `legacy-weighted-rank remains stronger than the selected RRF and DBSF controls on HOLDOUT; no fusion replacement is justified (${rrf.metrics.mrr.value.toFixed(4)} RRF MRR, ${dbsf.metrics.mrr.value.toFixed(4)} DBSF MRR versus ${legacy.metrics.mrr.value.toFixed(4)} legacy MRR).`,
      reranker:
        "reranking improves MRR for dense and selected fusion but lowers Hit@10 and adds substantial latency; lexical reranking is not attractive in this evidence.",
      lowResource:
        "lexical-only avoids query embeddings but has materially lower quality and remains a fallback rather than the default.",
      default: denseDefault
        ? "recommend dense as the v0.1 default under the frozen paired-delta rule and lower latency; keep hybrid-legacy as a compatibility and explicit profile option, with reranking opt-in."
        : "do not change the current default: the frozen paired-delta rule did not establish a safe dense replacement; keep hybrid-legacy as a compatibility and explicit profile option.",
    },
    frozenRule: {
      meaningfulMrrDelta: 0.02,
      meaningfulHitAt5Delta: 0.02,
      pairedInterval: "95% bootstrap interval for per-query candidate-minus-baseline deltas must exclude zero",
      materialHitAt10Regression: 0.02,
      denseVsLegacyQualityWinner: denseVsLegacy.qualityWinnerUnderFrozenRule,
      denseRerankerQualityWinner: denseReranker.qualityWinnerUnderFrozenRule,
      fusionRerankerQualityWinner: fusionReranker.qualityWinnerUnderFrozenRule,
      denseDefaultRecommendation: denseDefault,
      ruleAppliedToRecommendation: true,
    },
    evidence: {
      denseMrr: dense.metrics.mrr,
      lexicalMrr: lexical.metrics.mrr,
      legacyMrr: legacy.metrics.mrr,
      rrfMrr: rrf.metrics.mrr,
      dbsfMrr: dbsf.metrics.mrr,
      selectedFusionRerankerMrr: rerankedFusion.metrics.mrr,
      lexicalOnlyRelevantCandidates: overlap["lexical-lstar"].relevantLexicalOnly,
      controlledHybridLexicalOnlyRelevantCandidates: overlap["fusion-legacy"].relevantLexicalOnly,
      controlledFusion: ["fusion-legacy", "fusion-rrf-k-60-depth-25", "fusion-dbsf-depth-25"],
      holdoutChecksum: source.split.splitChecksumSha256,
    },
    legacyOutcome: "KEEP BUT NON-DEFAULT",
    runtimeChanged: false,
  };
}

function bucketCategory(bucket) {
  if (bucket === "exact_term_identifier") return "exact-term miss";
  if (bucket === "morphology_inflection") return "Russian morphology/inflection";
  if (String(bucket).startsWith("cross_language")) return "cross-language miss";
  if (bucket === "mixed_distractor") return "hard-negative confusion";
  if (bucket === "entity_disambiguation") return "entity/identifier confusion";
  return "semantic miss";
}

function partitionCounts(rows) {
  return Object.fromEntries(
    ["EN", "RU", "MIXED"].map((partition) => [
      partition,
      new Set(rows.filter((row) => row.partition === partition).map((row) => row.query_id)).size,
    ]),
  );
}

function sumOverlap(rows, key) {
  return rows.reduce((sum, row) => sum + (row.candidate_overlap?.[key]?.length || 0), 0);
}

function bootstrapInterval(values, salt) {
  if (!values.length) return { low: 0, high: 0 };
  const random = seededRandom(`${BOOTSTRAP_SEED}:${salt}`);
  const samples = [];
  for (let iteration = 0; iteration < BOOTSTRAP_REPETITIONS; iteration += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[Math.floor(random() * values.length)];
    samples.push(total / values.length);
  }
  samples.sort((left, right) => left - right);
  return { low: samples[Math.floor(samples.length * 0.025)], high: samples[Math.floor(samples.length * 0.975)] };
}

function seededRandom(seed) {
  let state = crypto.createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function validateAnalysis(analysis, source) {
  if (analysis.formatVersion !== "infowarden-benchmark-v21-analysis.v1" || analysis.qualityRun !== true) {
    throw new Error("unsupported v2.1 analysis format");
  }
  if (
    analysis.source?.splitChecksumSha256 !== source.split.splitChecksumSha256 ||
    analysis.source?.matrixChecksumSha256 !== source.matrix.matrixChecksumSha256 ||
    analysis.source?.holdoutSummarySha256 !== source.holdoutSummarySha256 ||
    analysis.source?.configurationChecksumSha256 !== source.configurations.configurationChecksumSha256 ||
    JSON.stringify(analysis.source?.runChecksums) !== JSON.stringify(source.runChecksums)
  ) {
    throw new Error("analysis source checksums do not match current frozen evidence");
  }
  if (
    analysis.methodology?.bootstrapSeed !== BOOTSTRAP_SEED ||
    analysis.methodology.bootstrapRepetitions !== BOOTSTRAP_REPETITIONS
  ) {
    throw new Error("analysis methodology identity mismatch");
  }
  if (JSON.stringify(Object.keys(analysis.modes).sort()) !== JSON.stringify([...EXPECTED_CONFIGURATIONS].sort())) {
    throw new Error("analysis mode set mismatch");
  }
  for (const [id, mode] of Object.entries(analysis.modes)) {
    if (mode.configuration?.parameterHash !== parameterHash(mode.configuration.metadata)) {
      throw new Error(`analysis configuration hash mismatch: ${id}`);
    }
  }
  if (!analysis.pairedComparisons || !analysis.resources?.indexByPartition || !analysis.resources?.perMode) {
    throw new Error("analysis is missing paired comparisons or resource evidence");
  }
  if (!String(analysis.failureTaxonomyMethod || "").includes("not causal proof")) {
    throw new Error("analysis does not disclose the inferred taxonomy limitation");
  }
  if (analysis.decision?.runtimeChanged !== false || !analysis.decision?.legacyOutcome) {
    throw new Error("analysis product decision is incomplete or claims runtime mutation");
  }
}

function renderReport(analysis) {
  const lines = [
    "# Retrieval Benchmark v2.1 HOLDOUT analysis",
    "",
    "This report analyzes the immutable HOLDOUT evidence only. It does not tune, relabel, or rerun retrieval.",
    `Failure taxonomy limitation: ${analysis.failureTaxonomyMethod}.`,
    "",
    `Split checksum: ${analysis.source.splitChecksumSha256}`,
    `Bootstrap: ${analysis.methodology.bootstrapRepetitions} query-level resamples, seed \`${analysis.methodology.bootstrapSeed}\``,
    "",
    "## Overall results",
    "",
    "| Mode | Hit@10 | MRR | nDCG@10 | candidate recall | p50 ms | p95 ms | failed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [id, result] of Object.entries(analysis.modes)) {
    const summary = result.overall;
    lines.push(
      `| ${id} | ${pct(summary.metrics.hit_at_10.value)} | ${summary.metrics.mrr.value.toFixed(4)} | ${summary.metrics.ndcg_at_10.value.toFixed(4)} | ${pct(summary.metrics.candidate_recall.value)} | ${Math.round(summary.latencyP50Ms)} | ${Math.round(summary.latencyP95Ms)} | ${summary.failedQueryCount} |`,
    );
  }
  lines.push(
    "",
    "## Product decision",
    "",
    analysis.decision.answers.default,
    "",
    `Legacy outcome: **${analysis.decision.legacyOutcome}**. Runtime changed by this analysis: **no**.`,
    "",
    "The controlled fusion comparison keeps the DEV-selected BM25 lexical leg constant across legacy, RRF, and DBSF. Candidate-overlap and failure-taxonomy details are machine-readable in `benchmark-v21-analysis.json`.",
    "",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function safeRatio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function percentile(values, percent) {
  return values.length ? values[Math.min(values.length - 1, Math.ceil((percent / 100) * values.length) - 1)] : null;
}

function checksum(value) {
  return crypto
    .createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest("hex");
}

function parameterHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(directory, relativePath, value) {
  const target = path.join(directory, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}
