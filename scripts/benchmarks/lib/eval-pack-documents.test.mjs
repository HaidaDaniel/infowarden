import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createEvalPackDocumentLoader, EvalPackDocumentError } from "./eval-pack-documents.mjs";

function withPack(files, manifestDocument) {
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "infowarden-eval-pack-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(packDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  const loader = createEvalPackDocumentLoader(packDir);
  return () => loader.loadDocument(manifestDocument);
}

test("loads a legacy standalone document", () => {
  const load = withPack(
    { "documents/foo.md": "A standalone legacy document." },
    {
      id: "foo",
      path: "documents/foo.md",
    },
  );
  assert.equal(load().text, "A standalone legacy document.");
});

test("loads one exact record from a sharded JSONL document", () => {
  const load = withPack(
    {
      "documents/shard.jsonl": [
        JSON.stringify({ id: "foo", text: "The selected record text." }),
        JSON.stringify({ id: "other", text: "A different record." }),
      ].join("\n"),
    },
    { id: "foo", path: "documents/shard.jsonl", recordId: "foo" },
  );
  assert.equal(load().text, "The selected record text.");
});

function assertLoaderFails(files, document, pattern) {
  const load = withPack(files, document);
  assert.throws(load, (error) => error instanceof EvalPackDocumentError && pattern.test(error.message));
}

test("fails when the requested sharded record is missing", () => {
  assertLoaderFails(
    { "documents/shard.jsonl": '{"id":"other","text":"Other text."}' },
    {
      id: "foo",
      path: "documents/shard.jsonl",
      recordId: "foo",
    },
    /record foo not found/,
  );
});

test("fails on duplicate record ids in a shard", () => {
  assertLoaderFails(
    { "documents/shard.jsonl": ['{"id":"foo","text":"First text."}', '{"id":"foo","text":"Second text."}'].join("\n") },
    { id: "foo", path: "documents/shard.jsonl", recordId: "foo" },
    /duplicate record id/,
  );
});

test("fails on malformed JSONL", () => {
  assertLoaderFails(
    { "documents/shard.jsonl": '{"id":"foo","text":"Text."}\nnot-json' },
    {
      id: "foo",
      path: "documents/shard.jsonl",
      recordId: "foo",
    },
    /invalid JSONL/,
  );
});

test("fails on empty record text", () => {
  assertLoaderFails(
    { "documents/shard.jsonl": '{"id":"foo","text":"  "}' },
    {
      id: "foo",
      path: "documents/shard.jsonl",
      recordId: "foo",
    },
    /text must be a non-empty string/,
  );
});

test("fails when manifest id and record identity differ", () => {
  assertLoaderFails(
    { "documents/shard.jsonl": '{"id":"bar","text":"Record text."}' },
    {
      id: "foo",
      path: "documents/shard.jsonl",
      recordId: "bar",
    },
    /does not match recordId/,
  );
});
