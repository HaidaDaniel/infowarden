import crypto from "node:crypto";
import fs from "node:fs";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

for (const partition of ["en", "ru", "mixed"]) {
  const dir = `fixtures/eval/benchmark-v2/benchmark-${partition}`;
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
  const reviewManifest = JSON.parse(fs.readFileSync(`${dir}/semantic-review-manifest.json`, "utf8"));
  const questions = fs.readFileSync(`${dir}/questions.jsonl`, "utf8").trim().split("\n").map(JSON.parse);
  const qrelsBytes = fs.readFileSync(`${dir}/qrels.jsonl`);
  const qrels = qrelsBytes.toString("utf8").trim().split("\n").map(JSON.parse);
  const reviewBytes = fs.readFileSync(`${dir}/semantic-review.jsonl`);
  const reviews = reviewBytes.toString("utf8").trim().split("\n").map(JSON.parse);
  const questionIds = new Set(questions.map((question) => question.id));
  const documentIds = new Set(manifest.documents.map((document) => document.id));
  const reviewIds = new Set();
  const qrelKeys = new Set();

  if (manifest.documents.length !== manifest.benchmarkContract.corpusCount) {
    throw new Error(`${partition}: declared document count mismatch`);
  }
  if (questions.length !== manifest.benchmarkContract.queryCount) {
    throw new Error(`${partition}: declared question count mismatch`);
  }
  if (new Set(manifest.documents.map((document) => document.id)).size !== manifest.documents.length) {
    throw new Error(`${partition}: duplicate manifest document identity`);
  }

  if (manifest.semanticReview.status !== "frozen-independent-review") {
    throw new Error(`${partition}: semantic review is not frozen after independent review`);
  }
  if (reviewManifest.status !== "frozen-independent-review" || reviewManifest.independentReviewStatus !== "passed") {
    throw new Error(`${partition}: semantic review manifest is not frozen after independent review`);
  }
  if (
    manifest.semanticReview.reviewRowsSha256 !== hash(reviewBytes) ||
    reviewManifest.reviewRowsSha256 !== hash(reviewBytes)
  ) {
    throw new Error(`${partition}: semantic review checksum mismatch`);
  }
  if (manifest.qrels.sha256 !== hash(qrelsBytes)) {
    throw new Error(`${partition}: qrels checksum mismatch`);
  }
  if (manifest.qrels.recordCount !== qrels.length) {
    throw new Error(`${partition}: declared qrel count mismatch`);
  }
  if (questions.length !== reviews.length || new Set(reviews.map((row) => row.queryId)).size !== questions.length) {
    throw new Error(`${partition}: review coverage mismatch`);
  }
  for (const qrel of qrels) {
    const qrelKey = `${qrel.query_id}\u0000${qrel.document_id}`;
    if (qrelKeys.has(qrelKey)) {
      throw new Error(`${partition}: duplicate qrel identity`);
    }
    qrelKeys.add(qrelKey);
    if (!questionIds.has(qrel.query_id) || !documentIds.has(qrel.document_id)) {
      throw new Error(`${partition}: qrel references an unknown identity`);
    }
  }
  for (const question of questions) {
    if (new Set(question.expectedDocumentIds).size !== question.expectedDocumentIds.length) {
      throw new Error(`${partition}: duplicate expected document identity for ${question.id}`);
    }
    if (new Set(question.negativeDocumentIds).size !== question.negativeDocumentIds.length) {
      throw new Error(`${partition}: duplicate negative document identity for ${question.id}`);
    }
    for (const documentId of [...question.expectedDocumentIds, ...question.negativeDocumentIds]) {
      if (!documentIds.has(documentId)) {
        throw new Error(`${partition}: question references an unknown document`);
      }
    }
  }
  for (const row of reviews) {
    if (reviewIds.has(row.queryId) || !questionIds.has(row.queryId)) {
      throw new Error(`${partition}: duplicate or unknown semantic review identity`);
    }
    reviewIds.add(row.queryId);
  }
  for (const row of reviews.filter((review) => review.reviewedPrimaryBucket === "morphology_inflection")) {
    if (!row.morphologyEvidence?.formPairs?.length) {
      throw new Error(`${partition}: morphology evidence missing for ${row.queryId}`);
    }
  }
  console.log(
    `${partition}: ${manifest.documents.length} docs, ${questions.length} questions, ${qrels.length} qrels, ${reviews.length} review rows`,
  );
}
