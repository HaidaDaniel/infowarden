import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PARTITIONS, loadPartition } from "./contract.mjs";

export const V21_SPLIT_SEED = "infowarden-retrieval-v2.1-2026-10";
export const V21_SPLIT_FORMAT = "infowarden-benchmark-v21-split.v1";
export const V21_SPLIT_PATH = path.join("fixtures", "eval", "benchmark-v2", "metadata", "v2.1-split.json");

const SPLIT_RATIO = 0.6;
const ALGORITHM =
  "sha256(upstream-revision|language|query-id|seed), sorted within partition/semantic stratum, round(60%) per stratum";

export async function materializeV21Split(repoRoot) {
  const packs = PARTITIONS.map((partition) => loadPartition(repoRoot, partition));
  const manifest = withChecksum(buildSplitManifest(packs));
  const outputPath = path.resolve(repoRoot, V21_SPLIT_PATH);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, serializeManifest(manifest));
  validateManifest(manifest, packs);
  console.log(`materialized benchmark-v2.1 split: ${path.relative(repoRoot, outputPath)}`);
}

export async function validateV21Split(repoRoot) {
  const splitPath = path.resolve(repoRoot, V21_SPLIT_PATH);
  const manifest = await readManifest(splitPath);
  const packs = PARTITIONS.map((partition) => loadPartition(repoRoot, partition));
  validateManifest(manifest, packs);
  console.log(`validated benchmark-v2.1 split: ${path.relative(repoRoot, splitPath)}`);
  return manifest;
}

function buildSplitManifest(packs) {
  const assignments = [];
  const source = [];

  for (const pack of packs) {
    source.push({
      partition: pack.label,
      datasetId: pack.manifest.id,
      version: pack.manifest.version,
      queryCount: pack.questions.length,
      manifestSha256: pack.checksums.manifest,
      questionsSha256: pack.checksums.questions,
      qrelsSha256: pack.checksums.qrels,
      semanticReviewSha256: pack.checksums.semanticReview,
      documentsSha256: pack.checksums.documents,
    });

    const rows = pack.questions.map((question) => makeAssignment(pack, question));
    const byStratum = new Map();
    for (const row of rows) {
      const group = byStratum.get(row.stratum) || [];
      group.push(row);
      byStratum.set(row.stratum, group);
    }

    for (const group of byStratum.values()) {
      group.sort(compareAssignments);
      const devCount = developmentCount(group.length);
      group.forEach((row, index) => {
        assignments.push({
          partition: row.partition,
          queryId: row.queryId,
          language: row.language,
          reviewedPrimaryBucket: row.reviewedPrimaryBucket,
          crossLanguageCategory: row.crossLanguageCategory,
          morphologyCategory: row.morphologyCategory,
          hardNegativeCoverage: row.hardNegativeCoverage,
          stratum: row.stratum,
          hash: row.hash,
          split: index < devCount ? "DEV" : "HOLDOUT",
        });
      });
    }
  }

  assignments.sort(
    (left, right) =>
      left.partition.localeCompare(right.partition) ||
      left.hash.localeCompare(right.hash) ||
      left.queryId.localeCompare(right.queryId),
  );

  return {
    formatVersion: V21_SPLIT_FORMAT,
    seed: V21_SPLIT_SEED,
    algorithm: ALGORITHM,
    ratio: { dev: SPLIT_RATIO, holdout: 1 - SPLIT_RATIO },
    source,
    counts: summarizeCounts(assignments),
    assignments,
  };
}

function makeAssignment(pack, question) {
  const review = pack.reviewsByQuery.get(question.id);
  if (!review?.reviewedPrimaryBucket) {
    throw new Error(`${pack.label}: missing reviewed bucket for ${question.id}`);
  }
  const language = String(question.metadata?.language || pack.manifest.languages[0] || "unknown");
  const crossLanguageCategory = firstValue(
    question.metadata?.crossLanguageCategory,
    question.metadata?.crossLanguageDirection,
    question.metadata?.languagePair,
    question.metadata?.crossLanguage,
  );
  const morphologyCategory = firstValue(
    question.metadata?.morphologyCategory,
    question.metadata?.morphology,
    review.morphologyCategory,
    review.reviewedPrimaryBucket === "morphology_inflection" ? "morphology_inflection" : undefined,
  );
  const hardNegativeCount = Array.isArray(review.reviewedHardNegativeIds)
    ? review.reviewedHardNegativeIds.length
    : Array.isArray(question.negativeDocumentIds)
      ? question.negativeDocumentIds.length
      : 0;
  const hardNegativeCoverage = hardNegativeCount >= 2 ? "ge2" : "lt2";
  const stratum = [
    pack.label,
    language,
    review.reviewedPrimaryBucket,
    crossLanguageCategory || "none",
    morphologyCategory || "none",
    hardNegativeCoverage,
  ].join("|");
  const revision = String(pack.manifest.upstream?.revision || pack.manifest.version);
  const hashInput = `${revision}|${language}|${question.id}|${V21_SPLIT_SEED}`;

  return {
    partition: pack.label,
    queryId: question.id,
    language,
    reviewedPrimaryBucket: review.reviewedPrimaryBucket,
    crossLanguageCategory: crossLanguageCategory || null,
    morphologyCategory: morphologyCategory || null,
    hardNegativeCoverage,
    stratum,
    hash: crypto.createHash("sha256").update(hashInput).digest("hex"),
  };
}

function validateManifest(manifest, packs) {
  if (manifest.formatVersion !== V21_SPLIT_FORMAT) throw new Error("unsupported v2.1 split format");
  if (manifest.seed !== V21_SPLIT_SEED || manifest.algorithm !== ALGORITHM) {
    throw new Error("v2.1 split methodology identity mismatch");
  }
  if (manifest.ratio?.dev !== SPLIT_RATIO || manifest.ratio?.holdout !== 1 - SPLIT_RATIO) {
    throw new Error("v2.1 split ratio mismatch");
  }
  const storedChecksum = manifest.splitChecksumSha256;
  if (!storedChecksum) throw new Error("v2.1 split checksum is missing");
  const withoutChecksum = { ...manifest };
  delete withoutChecksum.splitChecksumSha256;
  if (sha256(canonicalBody(withoutChecksum)) !== storedChecksum) {
    throw new Error("v2.1 split checksum mismatch");
  }

  const expected = buildSplitManifest(packs);
  if (JSON.stringify(manifest.source) !== JSON.stringify(expected.source)) {
    throw new Error("v2.1 split source checksum mismatch");
  }
  if (JSON.stringify(manifest.counts) !== JSON.stringify(expected.counts)) {
    throw new Error("v2.1 split counts mismatch");
  }
  if (JSON.stringify(manifest.assignments) !== JSON.stringify(expected.assignments)) {
    throw new Error("v2.1 split assignments mismatch");
  }

  const seen = new Set();
  for (const assignment of manifest.assignments || []) {
    const key = `${assignment.partition}|${assignment.queryId}`;
    if (seen.has(key)) throw new Error(`duplicate v2.1 split assignment: ${key}`);
    if (assignment.split !== "DEV" && assignment.split !== "HOLDOUT") {
      throw new Error(`invalid v2.1 split assignment: ${key}`);
    }
    seen.add(key);
  }
  if (seen.size !== packs.reduce((sum, pack) => sum + pack.questions.length, 0)) {
    throw new Error("v2.1 split does not cover every frozen query exactly once");
  }
}

async function readManifest(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`v2.1 split manifest is missing: ${filePath}; ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`v2.1 split manifest is invalid JSON: ${error.message}`);
  }
}

function summarizeCounts(assignments) {
  const counts = { DEV: 0, HOLDOUT: 0, byPartition: {} };
  for (const assignment of assignments) {
    counts[assignment.split] += 1;
    const partition = counts.byPartition[assignment.partition] || { DEV: 0, HOLDOUT: 0 };
    partition[assignment.split] += 1;
    counts.byPartition[assignment.partition] = partition;
  }
  return counts;
}

function developmentCount(size) {
  if (size <= 1) return size;
  return Math.min(size - 1, Math.max(1, Math.round(size * SPLIT_RATIO)));
}

function compareAssignments(left, right) {
  return left.hash.localeCompare(right.hash) || left.queryId.localeCompare(right.queryId);
}

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || null;
}

function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function canonicalBody(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function withChecksum(manifest) {
  return { ...manifest, splitChecksumSha256: sha256(canonicalBody(manifest)) };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
