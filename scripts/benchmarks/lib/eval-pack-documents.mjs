import fs from "node:fs";
import path from "node:path";

export class EvalPackDocumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvalPackDocumentError";
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new EvalPackDocumentError(`${label} must be a non-empty string`);
  }
}

function resolveInsidePack(packDir, relativePath) {
  assertNonEmptyString(relativePath, "document.path");
  const resolved = path.resolve(packDir, relativePath);
  if (!resolved.startsWith(`${packDir}${path.sep}`)) {
    throw new EvalPackDocumentError(`document path escapes the dataset pack: ${relativePath}`);
  }
  return resolved;
}

function parseShard(shardPath) {
  const records = new Map();
  const lines = fs.readFileSync(shardPath, "utf8").split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new EvalPackDocumentError(`invalid JSONL in ${shardPath} line ${index + 1}: ${error.message}`);
    }

    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new EvalPackDocumentError(`record in ${shardPath} line ${index + 1} must be an object`);
    }
    assertNonEmptyString(record.id, `record id in ${shardPath} line ${index + 1}`);
    if (records.has(record.id)) {
      throw new EvalPackDocumentError(`duplicate record id in ${shardPath}: ${record.id}`);
    }
    records.set(record.id, record);
  }

  return records;
}

function documentText(record, label) {
  if (typeof record === "string") {
    if (record.trim() === "") {
      throw new EvalPackDocumentError(`${label}.text must be a non-empty string`);
    }
    return record;
  }
  if (!record || typeof record !== "object") {
    throw new EvalPackDocumentError(`${label} record is malformed`);
  }
  assertNonEmptyString(record.text, `${label}.text`);
  return record.text;
}

export function createEvalPackDocumentLoader(packDir) {
  const resolvedPackDir = path.resolve(packDir);
  const shardCache = new Map();

  function loadDocument(manifestDocument) {
    if (!manifestDocument || typeof manifestDocument !== "object") {
      throw new EvalPackDocumentError("manifest document must be an object");
    }
    assertNonEmptyString(manifestDocument.id, "manifest document.id");
    const documentPath = resolveInsidePack(resolvedPackDir, manifestDocument.path);
    if (!fs.existsSync(documentPath)) {
      throw new EvalPackDocumentError(`document file missing: ${manifestDocument.path}`);
    }

    if (manifestDocument.recordId === undefined) {
      return {
        id: manifestDocument.id,
        path: documentPath,
        text: documentText(fs.readFileSync(documentPath, "utf8"), manifestDocument.id),
        recordId: undefined,
      };
    }

    assertNonEmptyString(manifestDocument.recordId, `${manifestDocument.id}.recordId`);
    if (manifestDocument.recordId !== manifestDocument.id) {
      throw new EvalPackDocumentError(
        `manifest document id does not match recordId: ${manifestDocument.id} != ${manifestDocument.recordId}`,
      );
    }

    let records = shardCache.get(documentPath);
    if (!records) {
      records = parseShard(documentPath);
      shardCache.set(documentPath, records);
    }
    const record = records.get(manifestDocument.recordId);
    if (!record) {
      throw new EvalPackDocumentError(
        `record ${manifestDocument.recordId} not found in shard ${manifestDocument.path}`,
      );
    }
    if (record.id !== manifestDocument.id) {
      throw new EvalPackDocumentError(
        `record identity mismatch in ${manifestDocument.path}: ${record.id} != ${manifestDocument.id}`,
      );
    }

    return {
      id: manifestDocument.id,
      path: documentPath,
      text: documentText(record, manifestDocument.id),
      recordId: record.id,
    };
  }

  return { loadDocument, shardCache };
}
