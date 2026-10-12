#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createEvalPackDocumentLoader } from "./lib/eval-pack-documents.mjs";

const repoRoot = process.cwd();
const packDir = path.resolve(repoRoot, process.argv[2] || "fixtures/eval/cf-smoke-mini");
const manifestPath = path.join(packDir, "manifest.json");
const baselinePath = path.join(packDir, "baseline.json");

function fail(message) {
  console.error(`eval pack validation failed: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`invalid JSON at ${path.relative(repoRoot, filePath)}: ${error.message}`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
}

function resolveInsidePack(relativePath, label) {
  assertString(relativePath, label);
  const resolved = path.resolve(packDir, relativePath);
  if (!resolved.startsWith(`${packDir}${path.sep}`)) {
    fail(`${label} escapes the dataset pack: ${relativePath}`);
  }
  return resolved;
}

if (!fs.existsSync(manifestPath)) {
  fail(`manifest not found at ${path.relative(repoRoot, manifestPath)}`);
}

const manifest = readJson(manifestPath);
for (const key of ["id", "version", "tier", "documentsPath", "questionsPath"]) {
  assertString(manifest[key], `manifest.${key}`);
}

if (!Array.isArray(manifest.languages) || manifest.languages.length === 0) {
  fail("manifest.languages must be a non-empty array");
}
if (!Array.isArray(manifest.documents) || manifest.documents.length === 0) {
  fail("manifest.documents must be a non-empty array");
}

if (!fs.existsSync(baselinePath)) {
  fail("baseline.json is required for deterministic retrieval quality gates");
}
const baseline = readJson(baselinePath);
for (const key of ["id", "datasetId", "datasetVersion", "environmentClass"]) {
  assertString(baseline[key], `baseline.${key}`);
}
if (baseline.datasetId !== manifest.id || baseline.datasetVersion !== manifest.version) {
  fail("baseline dataset identity must match manifest id/version");
}
if (!baseline.profiles || typeof baseline.profiles !== "object") {
  fail("baseline.profiles must be an object");
}
for (const [profileKey, profile] of Object.entries(baseline.profiles)) {
  assertString(profileKey, "baseline profile key");
  for (const key of [
    "minQuestionCount",
    "minHitAtK",
    "minHitAt3",
    "minMrr",
    "maxEmptyResultRate",
    "maxDuplicateRate",
    "maxLatencyMsP95",
  ]) {
    if (typeof profile[key] !== "number") {
      fail(`baseline profile ${profileKey}.${key} must be a number`);
    }
  }
}
const approvalsPath = path.join(packDir, baseline.acceptedRegressionsPath || "approved-regressions.json");
if (!fs.existsSync(approvalsPath)) {
  fail("approved regressions file is required even when empty");
}
const approvals = readJson(approvalsPath);
if (!Array.isArray(approvals.acceptedRegressions)) {
  fail("approved regressions file must contain acceptedRegressions array");
}
for (const [index, approval] of approvals.acceptedRegressions.entries()) {
  for (const key of [
    "baselineId",
    "datasetId",
    "datasetVersion",
    "profileKey",
    "metric",
    "configHash",
    "reason",
    "reviewer",
    "approvedAt",
  ]) {
    assertString(approval[key], `approvedRegressions[${index}].${key}`);
  }
  if (approval.baselineId !== baseline.id) {
    fail(`approvedRegressions[${index}].baselineId must match baseline.id`);
  }
  if (approval.datasetId !== baseline.datasetId || approval.datasetVersion !== baseline.datasetVersion) {
    fail(`approvedRegressions[${index}] dataset identity must match baseline`);
  }
}

const documentIds = new Set();
const documentTextById = new Map();
const documentLoader = createEvalPackDocumentLoader(packDir);
for (const [index, document] of manifest.documents.entries()) {
  assertString(document.id, `manifest.documents[${index}].id`);
  assertString(document.path, `manifest.documents[${index}].path`);
  assertString(document.sourceType, `manifest.documents[${index}].sourceType`);
  assertString(document.language, `manifest.documents[${index}].language`);
  if (documentIds.has(document.id)) {
    fail(`duplicate document id: ${document.id}`);
  }
  documentIds.add(document.id);

  let loadedDocument;
  try {
    loadedDocument = documentLoader.loadDocument(document);
  } catch (error) {
    fail(`manifest.documents[${index}] ${error.message}`);
  }
  const text = loadedDocument.text;
  if (text.trim().length < 20) {
    fail(`document is too small to be useful: ${document.path}`);
  }
  documentTextById.set(document.id, text);
}

const questionsPath = resolveInsidePack(manifest.questionsPath, "manifest.questionsPath");
if (!fs.existsSync(questionsPath)) {
  fail(`questions file missing: ${manifest.questionsPath}`);
}

const questionIds = new Set();
const lines = fs.readFileSync(questionsPath, "utf8").split(/\r?\n/).filter(Boolean);
if (lines.length < 10) {
  fail("questions.jsonl must contain at least 10 questions");
}

for (const [lineIndex, line] of lines.entries()) {
  let question;
  try {
    question = JSON.parse(line);
  } catch (error) {
    fail(`invalid JSONL on questions line ${lineIndex + 1}: ${error.message}`);
  }

  assertString(question.id, `questions[${lineIndex}].id`);
  assertString(question.text, `questions[${lineIndex}].text`);
  if (questionIds.has(question.id)) {
    fail(`duplicate question id: ${question.id}`);
  }
  questionIds.add(question.id);

  if (!Array.isArray(question.expectedDocumentIds) || question.expectedDocumentIds.length === 0) {
    fail(`question ${question.id} must include expectedDocumentIds`);
  }
  for (const documentId of question.expectedDocumentIds) {
    if (!documentIds.has(documentId)) {
      fail(`question ${question.id} references unknown document id ${documentId}`);
    }
  }

  if (question.expectedChunkHints !== undefined && !Array.isArray(question.expectedChunkHints)) {
    fail(`question ${question.id} expectedChunkHints must be an array when present`);
  }
  for (const [hintIndex, hint] of (question.expectedChunkHints || []).entries()) {
    assertString(hint.documentId, `question ${question.id} expectedChunkHints[${hintIndex}].documentId`);
    assertString(hint.contains, `question ${question.id} expectedChunkHints[${hintIndex}].contains`);
    if (!documentIds.has(hint.documentId)) {
      fail(`question ${question.id} chunk hint references unknown document id ${hint.documentId}`);
    }
    const documentText = documentTextById.get(hint.documentId) || "";
    if (!documentText.includes(hint.contains)) {
      fail(`question ${question.id} chunk hint text not found in ${hint.documentId}: ${hint.contains}`);
    }
  }

  if (!Array.isArray(question.tags) || question.tags.length === 0) {
    fail(`question ${question.id} must include tags`);
  }
}

console.log(
  `validated eval pack ${manifest.id}@${manifest.version}: ${manifest.documents.length} docs, ${lines.length} questions`,
);
