import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createEvalPackDocumentLoader } from "../lib/eval-pack-documents.mjs";

export const PARTITIONS = ["en", "ru", "mixed"];
export const PARTITION_LABELS = { en: "EN", ru: "RU", mixed: "MIXED" };
export const MODES = [
  { key: "dense", label: "dense-only", lexical: false, reranker: false },
  { key: "hybrid", label: "hybrid", lexical: true, reranker: false },
  { key: "hybrid-reranker", label: "hybrid + reranker", lexical: true, reranker: true },
];
export const UNSUPPORTED_MODES = [
  { key: "lexical-only", label: "lexical-only", reason: "runtime has no product-supported zero-dense contract" },
];

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function packDirectory(repoRoot, partition) {
  return path.resolve(repoRoot, "fixtures/eval/benchmark-v2", `benchmark-${partition}`);
}

export function loadPartition(repoRoot, partition, options = {}) {
  if (!PARTITIONS.includes(partition)) throw new Error(`unsupported partition: ${partition}`);
  const queryIds = options.queryIds ? new Set(options.queryIds) : null;
  if (queryIds?.size === 0) throw new Error(`${partition}: query selection cannot be empty`);
  const dir = packDirectory(repoRoot, partition);
  const manifest = readJson(path.join(dir, "manifest.json"));
  const semanticReview = readJson(path.join(dir, "semantic-review-manifest.json"));
  const questions = readJsonl(
    path.join(dir, manifest.questionsPath),
    queryIds ? { field: "id", values: queryIds } : null,
  );
  const qrelsBytes = fs.readFileSync(path.join(dir, "qrels.jsonl"));
  const qrels = parseJsonl(qrelsBytes, `${partition} qrels`, queryIds ? { field: "query_id", values: queryIds } : null);
  const reviewBytes = fs.readFileSync(path.join(dir, "semantic-review.jsonl"));
  const reviews = parseJsonl(
    reviewBytes,
    `${partition} semantic review`,
    queryIds ? { field: "queryId", values: queryIds } : null,
  );
  const loader = createEvalPackDocumentLoader(dir);

  if (
    manifest.semanticReview?.status !== "frozen-independent-review" ||
    manifest.semanticReview?.qualityResultsObserved !== false ||
    semanticReview.status !== "frozen-independent-review" ||
    semanticReview.independentReviewStatus !== "passed" ||
    semanticReview.qualityResultsObserved !== false ||
    semanticReview.noModelOrRetrievalEvidenceUsed !== true
  ) {
    throw new Error(`${partition}: semantic review is not marked pre-results`);
  }
  if (semanticReview.reviewRowsSha256 !== sha256(reviewBytes)) {
    throw new Error(`${partition}: semantic review checksum mismatch`);
  }
  if (manifest.qrels.sha256 !== sha256(qrelsBytes)) {
    throw new Error(`${partition}: qrels checksum mismatch`);
  }
  if (queryIds) {
    if (questions.length !== queryIds.size || reviews.length !== queryIds.size) {
      throw new Error(`${partition}: selected semantic review coverage mismatch`);
    }
  } else if (questions.length !== semanticReview.queryCount || reviews.length !== semanticReview.reviewedQueryCount) {
    throw new Error(`${partition}: semantic review coverage mismatch`);
  }
  const reviewsByQuery = new Map(reviews.map((review) => [review.queryId, review]));
  for (const question of questions) {
    const review = reviewsByQuery.get(question.id);
    if (!review?.reviewedPrimaryBucket) {
      throw new Error(`${partition}: missing reviewed semantic label for ${question.id}`);
    }
  }
  const documents = manifest.documents.map((document) => loader.loadDocument(document));
  const documentsSha256 = checksumDocumentFiles(dir, manifest.documents);
  const documentIds = new Set(documents.map((document) => document.id));
  const questionIds = new Set(questions.map((question) => question.id));
  const qrelsByQuery = new Map();
  for (const qrel of qrels) {
    if (!questionIds.has(qrel.query_id) || !documentIds.has(qrel.document_id)) {
      throw new Error(`${partition}: qrel references unknown identity`);
    }
    const rows = qrelsByQuery.get(qrel.query_id) || [];
    rows.push({ document_id: qrel.document_id, grade: qrel.grade, judgment_status: qrel.judgment_status });
    qrelsByQuery.set(qrel.query_id, rows);
  }
  return {
    partition,
    label: PARTITION_LABELS[partition],
    dir,
    manifest,
    semanticReview,
    questions,
    reviews,
    reviewsByQuery,
    qrels,
    qrelsByQuery,
    documents,
    checksums: {
      manifest: sha256(fs.readFileSync(path.join(dir, "manifest.json"))),
      questions: sha256(fs.readFileSync(path.join(dir, manifest.questionsPath))),
      qrels: sha256(qrelsBytes),
      semanticReview: sha256(reviewBytes),
      documents: documentsSha256,
    },
  };
}

function checksumDocumentFiles(packDir, manifestDocuments) {
  const files = new Map();
  for (const document of manifestDocuments) {
    const relativePath = String(document.path || "");
    const documentPath = path.resolve(packDir, relativePath);
    if (!documentPath.startsWith(`${path.resolve(packDir)}${path.sep}`)) {
      throw new Error(`document path escapes the dataset pack: ${relativePath}`);
    }
    if (!files.has(relativePath)) {
      files.set(relativePath, fs.readFileSync(documentPath));
    }
  }

  const hash = crypto.createHash("sha256");
  for (const [relativePath, bytes] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(String(bytes.length));
    hash.update("\0");
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export function createBenchmarkIdentityResolver(pack) {
  const partition = String(pack?.partition || "").toLowerCase();
  if (!PARTITIONS.includes(partition)) {
    throw new Error(`unsupported benchmark identity partition: ${partition}`);
  }

  const pathToDocumentId = new Map();
  for (const document of pack.documents || []) {
    if (!document?.id) throw new Error(`${partition}: benchmark document id is missing`);
    const materializedPath = `${partition}/${document.id}.md`;
    if (pathToDocumentId.has(materializedPath)) {
      throw new Error(`${partition}: duplicate materialized benchmark path: ${materializedPath}`);
    }
    pathToDocumentId.set(materializedPath, document.id);
  }

  return {
    pathPattern: `${partition}/<frozen-document-id>.md`,
    resolve(result) {
      const candidates = [result?.path, result?.metadata?.path]
        .filter((value) => typeof value === "string" && value.trim() !== "")
        .map(normalizeMaterializedPath);
      if (candidates.some((candidate) => candidate === null)) return null;
      const uniqueCandidates = new Set(candidates);
      if (uniqueCandidates.size > 1) return null;
      const candidate = candidates[0];
      return pathToDocumentId.get(candidate) || null;
    },
    expectedPath(documentId) {
      if (!pathToDocumentId.has(`${partition}/${documentId}.md`)) {
        throw new Error(`${partition}: unknown frozen document id: ${documentId}`);
      }
      return `${partition}/${documentId}.md`;
    },
  };
}

function normalizeMaterializedPath(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(raw)) {
    return null;
  }
  const normalized = raw.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized.split("/").includes("..") ? null : normalized;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath, selection = null) {
  return parseJsonl(fs.readFileSync(filePath), filePath, selection);
}

function parseJsonl(bytes, label, selection = null) {
  return bytes
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      if (selection && !lineContainsSelectedString(line, selection.field, selection.values)) return null;
      try {
        const row = JSON.parse(line);
        if (selection && !selection.values.has(row?.[selection.field])) return null;
        return row;
      } catch (error) {
        throw new Error(`${label} line ${index + 1} is invalid JSON: ${error.message}`);
      }
    })
    .filter((row) => row !== null);
}

function lineContainsSelectedString(line, field, values) {
  const fieldPattern = `"${String(field).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`;
  const match = line.match(new RegExp(fieldPattern));
  if (!match) return false;
  try {
    return values.has(JSON.parse(match[1]));
  } catch {
    return false;
  }
}

export function modeDefinitions(env = process.env) {
  return MODES.map((mode) => ({
    ...mode,
    profileKey:
      mode.key === "dense" ? env.BENCHMARK_V2_DENSE_PROFILE || "default" : env.BENCHMARK_V2_HYBRID_PROFILE || null,
    rerank: mode.reranker ? { enabled: true } : { enabled: false },
  }));
}

export function validateModeDefinitions(modes, { live = false } = {}) {
  const errors = [];
  for (const mode of modes) {
    if (!mode.profileKey && live) {
      errors.push(`${mode.key}: BENCHMARK_V2_HYBRID_PROFILE must identify a runtime profile`);
    }
    if (mode.key === "dense" && mode.lexical) errors.push("dense mode cannot enable lexical retrieval");
    if (mode.key !== "dense" && !mode.lexical) errors.push(`${mode.key}: hybrid mode must enable lexical retrieval`);
  }
  return errors;
}

export function canonicalDocumentId(result) {
  const metadata = result?.metadata && typeof result.metadata === "object" ? result.metadata : {};
  return result?.documentId || metadata.documentId || metadata.sourceDocumentId || null;
}

export function collapseResults(results, options = {}) {
  const byDocument = new Map();
  let duplicateCount = 0;
  let unidentifiedCount = 0;
  for (const [rawRank, result] of results.entries()) {
    const documentId = options.resolveDocumentId ? options.resolveDocumentId(result) : canonicalDocumentId(result);
    if (!documentId) {
      unidentifiedCount += 1;
      continue;
    }
    const candidate = {
      ...result,
      documentId,
      runtimeDocumentId: canonicalDocumentId(result),
      _rawRank: rawRank,
    };
    const existing = byDocument.get(documentId);
    if (!existing) {
      byDocument.set(documentId, candidate);
    } else {
      duplicateCount += 1;
      if (compareResults(candidate, existing) < 0) byDocument.set(documentId, candidate);
    }
  }
  const documents = [...byDocument.values()].sort(compareResults).map((result) => {
    const sanitized = { ...result };
    sanitized.raw_rank = sanitized._rawRank;
    delete sanitized._rawRank;
    return sanitized;
  });
  return { documents, duplicateCount, unidentifiedCount };
}

export function scoreQuery(question, rankedResults, qrelsByQuery, topK = 10) {
  const judgments = new Map((qrelsByQuery.get(question.id) || []).map((row) => [row.document_id, row.grade]));
  const rankedIds = rankedResults.map((result) => result.documentId);
  const firstRelevant = rankedIds.findIndex((id) => (judgments.get(id) || 0) > 0);
  const top = rankedResults.slice(0, topK);
  const grades = top.map((result) => judgments.get(result.documentId) || 0);
  const ideal = [...judgments.values()]
    .filter((grade) => grade > 0)
    .sort((a, b) => b - a)
    .slice(0, topK);
  return {
    hit_at_1: firstRelevant === 0 ? 1 : 0,
    hit_at_3: firstRelevant >= 0 && firstRelevant < 3 ? 1 : 0,
    hit_at_5: firstRelevant >= 0 && firstRelevant < 5 ? 1 : 0,
    hit_at_10: firstRelevant >= 0 && firstRelevant < 10 ? 1 : 0,
    mrr: firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0,
    ndcg_at_10: ndcg(grades, ideal),
    result_count: rankedResults.length,
    empty: rankedResults.length === 0,
    raw_result_count: rankedResults.length,
    duplicate_count: 0,
    unidentified_count: 0,
    first_relevant_rank: firstRelevant >= 0 ? firstRelevant + 1 : null,
  };
}

function compareResults(left, right) {
  const scoreDelta = (Number(right.score) || 0) - (Number(left.score) || 0);
  if (scoreDelta !== 0) return scoreDelta;
  if (left._rawRank !== right._rawRank) return left._rawRank - right._rawRank;
  const documentDelta = String(left.documentId || "").localeCompare(String(right.documentId || ""));
  if (documentDelta !== 0) return documentDelta;
  return String(left.chunkId || "").localeCompare(String(right.chunkId || ""));
}

function ndcg(actual, ideal) {
  const dcg = actual.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const idcg = ideal.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  return idcg ? dcg / idcg : 0;
}

export function aggregate(rows, latencies) {
  const count = rows.length || 1;
  const mean = (key) => rows.reduce((sum, row) => sum + row[key], 0) / count;
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (percent) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1)] : null;
  return {
    questionCount: rows.length,
    failed_query_count: rows.filter((row) => row.error_code || row.error_class).length,
    hit_at_1: mean("hit_at_1"),
    hit_at_3: mean("hit_at_3"),
    hit_at_5: mean("hit_at_5"),
    hit_at_10: mean("hit_at_10"),
    mrr: mean("mrr"),
    ndcg_at_10: mean("ndcg_at_10"),
    empty_rate: mean("empty"),
    duplicate_rate:
      rows.reduce((sum, row) => sum + row.duplicate_count, 0) /
      Math.max(
        1,
        rows.reduce((sum, row) => sum + row.raw_result_count, 0),
      ),
    latency_p50_ms: percentile(50),
    latency_p95_ms: percentile(95),
    latencyMs: { p50: percentile(50), p95: percentile(95) },
  };
}
