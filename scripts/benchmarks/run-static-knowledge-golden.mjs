#!/usr/bin/env node
// Static-knowledge golden set benchmark for public v0.1 (task 0138).
//
// Drives a live Context Forge deployment with the committed sanitized pack
// fixtures/eval/cf-static-knowledge-golden:
//   1. creates a benchmark workspace,
//   2. imports the pack as three persistent sources (local_folder docs,
//      managed upload book archive, obsidian_vault notes),
//   3. indexes all sources and records build duration,
//   4. installs the golden hybrid retrieval profiles,
//   5. imports the reviewed questions with fixed labels,
//   6. runs dense (default profile), hybrid, and hybrid+reranker eval runs,
//   7. writes raw results under .contextforge/benchmarks/ (git-ignored) and
//      a sanitized aggregate report.
//
// Usage:
//   node scripts/benchmarks/run-static-knowledge-golden.mjs [options]
//
// Options:
//   --api-url <url>     default http://localhost:3000
//   --api-key <key>     or CONTEXTFORGE_API_KEY / ADMIN_API_KEY env
//   --pack <dir>        default fixtures/eval/cf-static-knowledge-golden
//   --out <dir>         default .contextforge/benchmarks/static-knowledge-golden/<utc>
//   --topk <n>          default 5 (must match baseline.json topK)
//   --keep-workspace    do not delete the benchmark workspace on exit
//
// The script never writes private content: labels come from the committed
// pack, and the report contains ids, paths, and metrics only.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));
const apiUrl = args["api-url"] || "http://localhost:3000";
const apiKey = args["api-key"] || process.env.CONTEXTFORGE_API_KEY || process.env.ADMIN_API_KEY || "";
const packDir = path.resolve(repoRoot, args.pack || "fixtures/eval/cf-static-knowledge-golden");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(repoRoot, args.out || `.contextforge/benchmarks/static-knowledge-golden/${stamp}`);
const topK = Number(args.topk || 5);
const keepWorkspace = Boolean(args["keep-workspace"]);

const HYBRID_METADATA = {
  hybridSearch: true,
  lexicalTopK: 5,
  denseTopK: 8,
  denseWeight: 0.6,
  lexicalWeight: 0.4,
};

const MODES = [
  { key: "default", label: "dense", profileKey: "default", rerank: { enabled: false } },
  { key: "golden-hybrid", label: "hybrid", profileKey: "golden-hybrid", rerank: { enabled: false } },
  {
    key: "golden-hybrid-rerank",
    label: "hybrid+reranker",
    profileKey: "golden-hybrid-rerank",
    rerank: { enabled: true },
  },
];

let workspaceId = "";
let zipPath = "";

main().catch((error) => {
  console.error("static-knowledge golden benchmark failed:", error.message || error);
  process.exitCode = 1;
});

async function main() {
  const manifest = readJson(path.join(packDir, "manifest.json"));
  const baseline = readJson(path.join(packDir, "baseline.json"));
  const questions = readQuestions(path.join(packDir, manifest.questionsPath));
  if (topK !== baseline.topK) {
    throw new Error(`--topk ${topK} does not match baseline topK ${baseline.topK}`);
  }

  await fsp.mkdir(outDir, { recursive: true });
  const report = {
    dataset: { id: manifest.id, version: manifest.version },
    startedAt: new Date().toISOString(),
    environment: {
      api: apiUrl,
      node: process.version,
      pack: path.relative(repoRoot, packDir),
    },
    corpus: {
      documents: manifest.documents.length,
      questions: questions.length,
      sourceClasses: manifest.sourceClasses,
      bytes: corpusBytes(manifest),
    },
    sources: [],
    indexing: [],
    runs: {},
    perQuestion: {},
  };

  // 1. Workspace.
  const workspace = await api("POST", "/knowledge-bases", {
    name: `Static Knowledge Golden ${stamp}`,
    slug: `static-knowledge-golden-${stamp}`,
    description: "Sanitized static-knowledge golden set benchmark (task 0138)",
    workspaceKind: "benchmarks",
  });
  workspaceId = workspace.id;
  report.workspace = { id: workspaceId, slug: workspace.slug };
  log(`workspace created: ${workspaceId}`);

  try {
    // 2. Sources.
    const docsSource = await api("POST", "/sources", {
      knowledgeBaseId: workspaceId,
      type: "local_folder",
      uri: path.join(packDir, "documents", "docs"),
      includeRules: ["**/*.md"],
      excludeRules: [],
    });
    report.sources.push(sourceRecord("markdown_docs", "local_folder", docsSource));
    log(`docs source: ${docsSource.id}`);

    const vaultSource = await api("POST", "/sources", {
      knowledgeBaseId: workspaceId,
      type: "obsidian_vault",
      uri: path.join(packDir, "documents", "vault"),
      includeRules: ["**/*.md"],
      excludeRules: [],
    });
    report.sources.push(sourceRecord("obsidian_notes", "obsidian_vault", vaultSource));
    log(`vault source: ${vaultSource.id}`);

    const bookFiles = manifest.documents
      .filter((document) => document.sourceClass === "book_reference")
      .map((document) => ({
        id: document.id,
        file: path.join(packDir, document.path),
        name: path.basename(document.path),
      }));
    zipPath = path.join(outDir, "book-archive.zip");
    await fsp.mkdir(path.dirname(zipPath), { recursive: true });
    // -j stores flat basenames so the extracted archive has a clean top level.
    const zipArgs = ["-q", "-j", zipPath, ...bookFiles.map((file) => file.file)];
    const zipResult = spawnSync("zip", zipArgs, { cwd: repoRoot, encoding: "utf8" });
    if (zipResult.status !== 0) {
      throw new Error(`failed to create book archive: ${zipResult.stderr || zipResult.stdout}`);
    }
    const upload = await uploadSource(workspaceId, zipPath, "Book Reference Archive");
    const bookSource = upload.source;
    if (!bookSource?.id) {
      throw new Error(`book upload did not return a source: ${JSON.stringify(upload).slice(0, 300)}`);
    }
    report.sources.push(sourceRecord("book_reference", "upload", bookSource));
    report.bookUpload = {
      uploadId: upload.upload?.id,
      archiveFormat: upload.upload?.archiveFormat,
      fileCount: upload.upload?.fileCount,
    };
    log(`book upload source: ${bookSource.id}`);

    // 3. Index each source.
    const allSources = [
      { class: "markdown_docs", source: docsSource },
      { class: "book_reference", source: bookSource },
      { class: "obsidian_notes", source: vaultSource },
    ];
    for (const entry of allSources) {
      const finished = await indexSourceWithRetry(entry);
      report.indexing.push({
        sourceClass: entry.class,
        sourceId: entry.source.id,
        jobId: finished.job.id,
        attempts: finished.attempts,
        status: finished.job.status,
        durationMs: finished.durationMs,
        stats: summarizeIndexStats(finished.job.stats),
      });
      log(`indexed ${entry.class} in ${finished.durationMs}ms (attempts=${finished.attempts})`);
    }

    // 4. Golden hybrid profiles.
    await applyGoldenProfiles(workspaceId, stamp);
    log("golden hybrid profiles applied");

    // 5. Probe runtime document paths, then import questions with fixed labels.
    const runtimePathByDocId = await probeRuntimePaths(manifest);
    const unresolved = manifest.documents.filter((document) => !runtimePathByDocId.has(document.id));
    if (unresolved.length > 0) {
      log(
        `warning: runtime path unresolved for ${unresolved.length} document(s): ${unresolved.map((d) => d.id).join(", ")}`,
      );
    }
    const imported = await importQuestions(workspaceId, manifest, questions, runtimePathByDocId);
    report.questionsImported = imported;
    log(`imported ${imported} questions`);

    // 6. Eval runs per mode.
    for (const mode of MODES) {
      const run = await api("POST", `/workspaces/${workspaceId}/eval/runs`, {
        name: `static-knowledge-golden ${mode.label}`,
        datasetId: manifest.id,
        datasetVersion: manifest.version,
        profileKey: mode.profileKey,
        topK,
        rerank: mode.rerank,
      });
      report.runs[mode.key] = run;
      report.perQuestion[mode.key] = perQuestionSummary(manifest, questions, run);
      log(
        `run ${mode.label}: hit@K=${run.metrics.hitAtK} hit@3=${run.metrics.hitAt3} mrr=${run.metrics.mrr} ` +
          `empty=${run.metrics.emptyResultRate} dup=${run.metrics.duplicateRate} p95=${run.metrics.latencyMs?.p95}ms`,
      );
    }

    // 7. Persist raw results and sanitized aggregate report.
    await fsp.mkdir(path.join(outDir, "runs"), { recursive: true });
    for (const mode of MODES) {
      await fsp.writeFile(
        path.join(outDir, "runs", `${mode.key}.json`),
        JSON.stringify(report.runs[mode.key], null, 2),
      );
    }
    await fsp.writeFile(
      path.join(outDir, "corpus.json"),
      JSON.stringify({ manifest, runtimePathByDocId: Object.fromEntries(runtimePathByDocId) }, null, 2),
    );
    await fsp.writeFile(path.join(outDir, "benchmark-summary.json"), JSON.stringify(report, null, 2));

    const reportPath = path.join(outDir, "report.md");
    await fsp.writeFile(reportPath, renderReport(report, manifest, baseline));
    log(`raw results: ${path.relative(repoRoot, outDir)}`);
    log(`aggregate report: ${path.relative(repoRoot, reportPath)}`);
    printReport(path.relative(repoRoot, reportPath), report);
  } finally {
    if (!keepWorkspace && workspaceId) {
      await cleanupWorkspace(workspaceId);
    } else if (keepWorkspace && workspaceId) {
      log(`keeping workspace ${workspaceId}`);
    }
  }
}

// The public DELETE refuses a workspace that still owns sources, index
// versions, reports, or jobs, so cleanup scopes a Prisma delete to exactly
// the workspace id this run created (same precedent as smoke cleanup).
async function cleanupWorkspace(workspaceId) {
  try {
    await api("DELETE", `/knowledge-bases/${workspaceId}`);
    log(`workspace ${workspaceId} deleted`);
    return;
  } catch {
    // fall through to scoped Prisma cleanup
  }
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
    log(`workspace ${workspaceId} deleted (prisma)`);
  } catch (error) {
    log(`warning: workspace cleanup failed: ${error.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

// --- API helpers ---

async function api(method, urlPath, body, isForm = false) {
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let payload;
  if (body !== undefined) {
    if (isForm) {
      payload = body;
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  const response = await fetch(`${apiUrl}${urlPath}`, { method, headers, body: payload });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${urlPath} -> HTTP ${response.status}: ${typeof data === "string" ? data.slice(0, 400) : JSON.stringify(data).slice(0, 400)}`,
    );
  }
  return data;
}

async function uploadSource(workspaceId, filePath, sourceName) {
  const form = new FormData();
  form.append("file", new Blob([await fsp.readFile(filePath)]), path.basename(filePath));
  form.append("sourceName", sourceName);
  const response = await fetch(`${apiUrl}/workspaces/${workspaceId}/sources/upload`, {
    method: "POST",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    body: form,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`upload source -> HTTP ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data;
}

// The runtime marks embedding transport failures as retryable, but indexing
// jobs fail on the first preflight error. Re-enqueue a bounded number of times
// for transient preflight failures only.
async function indexSourceWithRetry(entry, { maxAttempts = 4, backoffMs = 5000 } = {}) {
  let last = undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const job = await api("POST", "/jobs/indexing", {
      knowledgeBaseId: workspaceId,
      sourceId: entry.source.id,
      type: "scan_source",
    });
    const finished = await pollJob(job.id);
    if (finished.status === "succeeded") {
      return { job: finished, attempts: attempt, durationMs: Date.now() - startedAt };
    }
    last = { job: finished, attempts: attempt, durationMs: Date.now() - startedAt };
    if (!isTransientIndexFailure(finished) || attempt === maxAttempts) {
      break;
    }
    log(`indexing ${entry.class} attempt ${attempt} failed transiently; retrying in ${backoffMs}ms`);
    await sleep(backoffMs);
  }
  throw new Error(
    `indexing ${entry.class} failed (${last.job.status}) after ${last.attempts} attempt(s): ` +
      `stats=${JSON.stringify(last.job.stats || {})} logs=${JSON.stringify(last.job.logs || []).slice(0, 800)}`,
  );
}

function isTransientIndexFailure(job) {
  const logs = Array.isArray(job.logs) ? job.logs : [];
  return logs.some(
    (entry) =>
      entry.level === "error" &&
      typeof entry.data?.code === "string" &&
      /^(embedding_|reranker_)?(connection|timeout|dns|tls|unreachable|overloaded)/.test(entry.data.code),
  );
}

async function pollJob(jobId, { timeoutMs = 15 * 60 * 1000, intervalMs = 2000 } = {}) {
  const startedAt = Date.now();
  for (;;) {
    const job = await api("GET", `/jobs/indexing/${jobId}`);
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return job;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`job ${jobId} timed out after ${timeoutMs}ms (last status ${job.status})`);
    }
    await sleep(intervalMs);
  }
}

async function applyGoldenProfiles(workspaceId, stamp) {
  const manifest = {
    formatVersion: "workspace-export-manifest.v1",
    workspace: {
      slug: `static-knowledge-golden-${stamp}`,
      name: `Static Knowledge Golden ${stamp}`,
      description: "Sanitized static-knowledge golden set benchmark (task 0138)",
      kind: "benchmarks",
      defaultIndexProfile: "default",
      defaultRetrievalProfile: "default",
    },
    sources: [],
    retrievalProfiles: [
      {
        id: "golden-hybrid-profile",
        key: "golden-hybrid",
        name: "Golden Hybrid",
        intent: "general_search",
        denseTopK: HYBRID_METADATA.denseTopK,
        neighborBefore: 0,
        neighborAfter: 0,
        grouping: "document",
        recencyBoost: false,
        metadata: { ...HYBRID_METADATA },
      },
      {
        id: "golden-hybrid-rerank-profile",
        key: "golden-hybrid-rerank",
        name: "Golden Hybrid (rerank run)",
        intent: "general_search",
        denseTopK: HYBRID_METADATA.denseTopK,
        neighborBefore: 0,
        neighborAfter: 0,
        grouping: "document",
        recencyBoost: false,
        metadata: { ...HYBRID_METADATA },
      },
    ],
    memoryEntries: [],
    indexVersions: [],
  };
  const response = await api("POST", "/workspaces/import-manifest/apply", {
    manifest,
    targetWorkspace: { id: workspaceId, updateExisting: true },
    enqueueReindex: false,
  });
  if (response.applied !== true || response.restored?.retrievalProfiles !== 2) {
    throw new Error(`golden profiles not applied: ${JSON.stringify(response).slice(0, 400)}`);
  }
}

// Probe each document with its H1 title and record the runtime path of the
// top hit whose path contains the document file stem. Labels stay fixed: the
// probe only resolves path identity, never expected answers.
async function probeRuntimePaths(manifest) {
  const runtimePathByDocId = new Map();
  for (const document of manifest.documents) {
    const stem = path.basename(document.path, path.extname(document.path));
    const title = documentTitle(document.id, document.path);
    if (!title) continue;
    try {
      const search = await api("POST", `/workspaces/${workspaceId}/search`, {
        query: title,
        topK: 5,
      });
      const results = (search.results || []).filter((result) => typeof result.path === "string");
      const match =
        results.find((result) => result.path.toLowerCase().includes(stem.toLowerCase())) ||
        (results.length > 0 &&
          results.every((result) => !result.path.toLowerCase().includes(stem.toLowerCase())) &&
          results[0]);
      if (match && match.path.toLowerCase().includes(stem.toLowerCase())) {
        runtimePathByDocId.set(document.id, match.path);
      }
    } catch (error) {
      log(`warning: probe failed for ${document.id}: ${error.message}`);
    }
  }
  return runtimePathByDocId;
}

// Manifest document paths are pack-relative, so resolve against packDir.
function documentTitle(documentId, documentPath) {
  try {
    const text = fs.readFileSync(path.join(packDir, documentPath), "utf8");
    const match = text.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

async function importQuestions(workspaceId, manifest, questions, runtimePathByDocId) {
  let imported = 0;
  for (const question of questions) {
    const labels = new Set(question.expectedDocumentIds);
    for (const documentId of question.expectedDocumentIds) {
      const runtimePath = runtimePathByDocId.get(documentId);
      if (runtimePath) labels.add(runtimePath);
    }
    await api("POST", `/workspaces/${workspaceId}/eval/questions`, {
      text: question.text,
      expectedDocumentIds: [...labels],
      expectedChunkIds: [],
      metadata: {
        ...(question.metadata || {}),
        fixtureQuestionId: question.id,
        datasetId: manifest.id,
        datasetVersion: manifest.version,
        fixedLabels: true,
        labelsSource: `${manifest.id}@${manifest.version}`,
        expectedChunkHints: question.expectedChunkHints || [],
        tags: question.tags || [],
      },
    });
    imported += 1;
  }
  return imported;
}

// --- Reporting ---

function perQuestionSummary(manifest, questions, run) {
  const results = run.results || [];
  const rows = [];
  for (const result of results) {
    const metadata = result.metadata || {};
    const scores = result.scores || {};
    // Result metadata carries the question text (not the fixture id), so map
    // back to the committed fixture question by its reviewed text.
    const question =
      questions.find((entry) => entry.text === metadata.questionText) ||
      questions.find((entry) => entry.id === metadata.fixtureQuestionId) ||
      {};
    const fixtureId = question.id ?? null;
    const topResults = metadata.topResults || [];
    const hit = scores.hitAtK === 1;
    rows.push({
      questionId: fixtureId,
      sourceClass: question.metadata?.sourceClass,
      tags: question.tags || [],
      hitAtK: hit ? 1 : 0,
      hitAt3: scores.hitAt3 ?? 0,
      rank: scores.reciprocalRank ? Math.round(1 / scores.reciprocalRank) : null,
      resultCount: scores.resultCount ?? 0,
      latencyMs: metadata.latencyMs ?? null,
      topPath: topResults[0]?.path ?? null,
      topSources: topResults[0]?.metadata?.retrievalSources ?? [],
      expectedDocumentIds: question.expectedDocumentIds || [],
      retrievedPaths: metadata.retrievedPaths || [],
    });
  }
  return rows;
}

function renderReport(report, manifest, baseline) {
  const lines = [];
  lines.push(`# Static Knowledge Golden Set — Aggregate Report`);
  lines.push("");
  lines.push(`Dataset: \`${report.dataset.id}@${report.dataset.version}\``);
  lines.push(`Generated: ${report.startedAt} (UTC)`);
  lines.push("");
  lines.push("## Scope and sanitization");
  lines.push("");
  lines.push("Sanitized synthetic corpus only: no private source text, private paths, personal");
  lines.push("questions, or provider credentials. Labels are reviewed fixture labels, never derived");
  lines.push("from retrieval output. Raw per-run JSON is stored under git-ignored");
  lines.push("`.contextforge/benchmarks/` and is not committed.");
  lines.push("");
  lines.push("## Environment and corpus");
  lines.push("");
  lines.push(`- API: ${report.environment.api} (Node ${report.environment.node})`);
  const index = firstRunConfig(report);
  lines.push(`- Embedding: ${index?.embeddingModel ?? "n/a"} (${index?.embeddingDimension ?? "n/a"} dimensions)`);
  lines.push(
    `- Reranker: ${index?.reranker ? `${index.reranker.providerName || "configured"} (enabled in rerank run)` : "not configured"}`,
  );
  lines.push(`- Serving revision: ${index?.servingRevisionId ?? "n/a"} (manifest ${index?.manifestHash ?? "n/a"})`);
  lines.push(
    `- Vector backend: ${index?.vectorBackendId ?? "n/a"} / collection ${index?.vectorCollectionName ?? "n/a"}`,
  );
  lines.push(
    `- Corpus: ${report.corpus.documents} documents, ${report.corpus.questions} questions, ${(report.corpus.bytes / 1024).toFixed(1)} KiB`,
  );
  lines.push(`- Source classes: ${report.corpus.sourceClasses.join(", ")}`);
  lines.push("");
  lines.push("## Index build duration");
  lines.push("");
  lines.push("| Source class | Source type | Duration (ms) | Documents | Chunks |");
  lines.push("| ------------ | ----------- | ------------- | --------- | ------ |");
  const docsByClass = {};
  for (const document of manifest.documents) {
    docsByClass[document.sourceClass] = (docsByClass[document.sourceClass] ?? 0) + 1;
  }
  for (const entry of report.indexing) {
    const docs = entry.stats?.documents ?? docsByClass[entry.sourceClass] ?? "n/a";
    lines.push(
      `| ${entry.sourceClass} | ${sourceTypeByClass(entry.sourceClass)} | ${entry.durationMs} | ${docs} | ${entry.stats?.chunks ?? "n/a"} |`,
    );
  }
  lines.push("");
  lines.push("## Channel comparison");
  lines.push("");
  lines.push("The runtime supports dense (default profile, lexical disabled), hybrid (weighted rank");
  lines.push("fusion), and hybrid+reranker (cross-encoder on the first-stage candidate set). A pure");
  lines.push("lexical-only channel is not expressible: profile metadata falls back to the default");
  lines.push("dense weight when zero, and the dense candidate limit is clamped to at least one, so");
  lines.push("every search includes the dense stage. Lexical contribution is observable inside the");
  lines.push("hybrid channel via per-candidate retrieval-source provenance.");
  lines.push("");
  lines.push(
    `| Mode | Profile | Rerank | Questions | Hit@K (top${report.runs["default"]?.metrics?.topK ?? topK}) | Hit@3 | MRR | Empty rate | Duplicate rate | p50 (ms) | p95 (ms) |`,
  );
  lines.push(
    "| ---- | ------- | ------ | --------- | ---------- | ----- | --- | ---------- | -------------- | -------- | -------- |",
  );
  for (const mode of MODES) {
    const metrics = report.runs[mode.key]?.metrics || {};
    lines.push(
      `| ${mode.label} | ${mode.profileKey} | ${mode.rerank.enabled ? "yes" : "no"} | ${metrics.questionCount ?? "n/a"} | ${fmt(metrics.hitAtK)} | ${fmt(metrics.hitAt3)} | ${fmt(metrics.mrr)} | ${fmt(metrics.emptyResultRate)} | ${fmt(metrics.duplicateRate)} | ${metrics.latencyMs?.p50 ?? "n/a"} | ${metrics.latencyMs?.p95 ?? "n/a"} |`,
    );
  }
  lines.push("");
  lines.push("## Baseline gates");
  lines.push("");
  lines.push(
    `Baseline: \`${baseline.id}\` (environment class \`${baseline.environmentClass}\`), topK ${baseline.topK}.`,
  );
  lines.push("");
  lines.push(
    `The baseline is the release gate for the \`${baseline.environmentClass}\` environment class. This run executed under the embedding profile recorded in the environment section above; if that profile differs from the baseline's, read the gate result below as a cross-environment reference, not a same-environment release check.`,
  );
  lines.push("");
  for (const mode of MODES) {
    const metrics = report.runs[mode.key]?.metrics || {};
    const profile = baseline.profiles[mode.key] || {};
    const checks = [
      ["questionCount", metrics.questionCount, profile.minQuestionCount, "min"],
      ["hitAtK", metrics.hitAtK, profile.minHitAtK, "min"],
      ["hitAt3", metrics.hitAt3, profile.minHitAt3, "min"],
      ["mrr", metrics.mrr, profile.minMrr, "min"],
      ["emptyResultRate", metrics.emptyResultRate, profile.maxEmptyResultRate, "max"],
      ["duplicateRate", metrics.duplicateRate, profile.maxDuplicateRate, "max"],
      ["latencyMs.p95", metrics.latencyMs?.p95, profile.maxLatencyMsP95, "max"],
    ];
    const failed = checks.filter(([, actual, bound, kind]) => {
      if (typeof actual !== "number" || typeof bound !== "number") return false;
      return kind === "min" ? actual < bound : actual > bound;
    });
    const failText = failed
      .map(([name, actual, bound, kind]) => `${name}=${fmt(actual)} ${kind === "min" ? "<" : ">"} ${bound}`)
      .join(", ");
    const status = failed.length === 0 ? "PASS" : `FAIL (${failText})`;
    lines.push(`- ${mode.label}: ${status}`);
  }
  lines.push("");
  lines.push("## Per-question results (sanitized: ids and paths only)");
  lines.push("");
  for (const mode of MODES) {
    lines.push(`### ${mode.label} (${mode.profileKey})`);
    lines.push("");
    lines.push("| Question | Class | Hit@K | Rank | Top-1 path | Top-1 channel |");
    lines.push("| -------- | ----- | ----- | ---- | ---------- | ------------- |");
    for (const row of report.perQuestion[mode.key] || []) {
      lines.push(
        `| ${row.questionId} | ${row.sourceClass} | ${row.hitAtK} | ${row.rank ?? "-"} | ${row.topPath ?? "-"} | ${row.topSources.join("+") || "-"} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Failure analysis input");
  lines.push("");
  lines.push("Questions with hit@K=0 in any mode, for the reviewed qualitative taxonomy (exact-term");
  lines.push("failure, semantic mismatch, cross-document question, multilingual weakness, chunk");
  lines.push("boundary, reranker degradation, stale revision, missing source, duplicate/empty):");
  lines.push("");
  const misses = collectMisses(report);
  if (misses.length === 0) {
    lines.push("None — all questions hit in all modes.");
  } else {
    lines.push("| Question | Missed in | Result count | Note |");
    lines.push("| -------- | --------- | ------------ | ---- |");
    for (const miss of misses) {
      lines.push(`| ${miss.questionId} | ${miss.modes.join(", ")} | ${miss.resultCount} | ${miss.note} |`);
    }
  }
  lines.push("");
  lines.push("## Conclusion boundary");
  lines.push("");
  lines.push("This report measures retrieval quality over stable/warm persistent knowledge. It does");
  lines.push("not measure, and must not be read as measuring, coding-agent productivity. Active-");
  lines.push("repository coding outcomes belong to tasks 0159/0160.");
  lines.push("");
  return lines.join("\n");
}

function collectMisses(report) {
  const byQuestion = new Map();
  for (const mode of MODES) {
    for (const row of report.perQuestion[mode.key] || []) {
      if (row.hitAtK !== 0) continue;
      const entry = byQuestion.get(row.questionId) || {
        questionId: row.questionId,
        modes: [],
        resultCount: row.resultCount,
        note: "",
      };
      entry.modes.push(mode.label);
      if (row.resultCount === 0) entry.note = "empty result";
      else if (entry.note === "") entry.note = row.resultCount < 3 ? "few results" : "expected doc outside top-K";
      byQuestion.set(row.questionId, entry);
    }
  }
  return [...byQuestion.values()];
}

function firstRunConfig(report) {
  const run = report.runs[MODES[0].key];
  const config = run?.metrics?.config;
  if (!config) return undefined;
  return {
    embeddingModel: config.providers?.embedding?.model,
    embeddingDimension: config.providers?.embedding?.dimension,
    reranker: config.providers?.reranker,
    servingRevisionId: config.serving?.servingRevisionId,
    manifestHash: config.serving?.manifestHash,
    vectorBackendId: config.serving?.vectorBackendId,
    vectorCollectionName: config.serving?.vectorCollectionName,
  };
}

function sourceTypeByClass(sourceClass) {
  if (sourceClass === "markdown_docs") return "local_folder";
  if (sourceClass === "book_reference") return "upload (zip)";
  if (sourceClass === "obsidian_notes") return "obsidian_vault";
  return sourceClass;
}

function printReport(reportPath, report) {
  console.log("");
  console.log("=== Static knowledge golden set summary ===");
  for (const mode of MODES) {
    const metrics = report.runs[mode.key]?.metrics || {};
    console.log(
      `${mode.label.padEnd(16)} hit@K=${fmt(metrics.hitAtK)} hit@3=${fmt(metrics.hitAt3)} mrr=${fmt(metrics.mrr)} ` +
        `empty=${fmt(metrics.emptyResultRate)} dup=${fmt(metrics.duplicateRate)} p95=${metrics.latencyMs?.p95 ?? "n/a"}ms`,
    );
  }
  console.log(`report: ${reportPath}`);
}

// --- Utilities ---

function sourceRecord(sourceClass, sourceType, source) {
  return {
    sourceClass,
    sourceType,
    sourceId: source.id,
    name: source.name,
  };
}

function summarizeIndexStats(stats) {
  if (!stats || typeof stats !== "object") return {};
  return {
    documents: stats.documents ?? stats.documentCount ?? stats.filesProcessed ?? undefined,
    chunks: stats.chunks ?? stats.chunkCount ?? stats.chunksCreated ?? undefined,
  };
}

function corpusBytes(manifest) {
  let total = 0;
  for (const document of manifest.documents) {
    try {
      total += fs.statSync(path.join(packDir, document.path)).size;
    } catch {
      // counted as 0; validator ensures the file exists
    }
  }
  return total;
}

function fmt(value) {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readQuestions(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? rawArgs[index + 1] ?? true;
    if (inlineValue === undefined && rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--")) {
      index += 1;
    }
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  console.log(`[static-knowledge-golden] ${message}`);
}
