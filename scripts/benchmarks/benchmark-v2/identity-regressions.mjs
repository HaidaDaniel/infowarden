import assert from "node:assert/strict";
import { collapseResults, createBenchmarkIdentityResolver } from "./contract.mjs";

const pack = {
  partition: "EN",
  documents: [{ id: "frozen-alpha" }, { id: "frozen-beta" }],
};
const resolver = createBenchmarkIdentityResolver(pack);

assert.equal(resolver.pathPattern, "en/<frozen-document-id>.md");
assert.equal(resolver.resolve({ path: "en/frozen-alpha.md", documentId: "runtime-hash" }), "frozen-alpha");
assert.equal(resolver.resolve({ path: "./en/frozen-beta.md", documentId: "runtime-hash-2" }), "frozen-beta");
assert.equal(resolver.resolve({ path: "en/unknown.md", documentId: "runtime-unknown" }), null);
assert.equal(resolver.resolve({ path: "frozen-alpha.md", documentId: "runtime-basename-only" }), null);
assert.equal(
  resolver.resolve({ metadata: { path: "en/frozen-alpha.md" }, documentId: "runtime-metadata-path" }),
  "frozen-alpha",
);
assert.equal(resolver.resolve({ path: "/en/frozen-alpha.md", documentId: "runtime-absolute" }), null);
assert.equal(resolver.resolve({ path: "en/../en/frozen-alpha.md", documentId: "runtime-traversal" }), null);
assert.equal(
  resolver.resolve({
    path: "en/frozen-alpha.md",
    metadata: { path: "en/frozen-beta.md" },
    documentId: "runtime-conflict",
  }),
  null,
);

const collapsed = collapseResults(
  [
    { documentId: "runtime-alpha", chunkId: "chunk-1", path: "en/frozen-alpha.md", score: 0.8 },
    { documentId: "runtime-alpha", chunkId: "chunk-2", path: "en/frozen-alpha.md", score: 0.7 },
    { documentId: "runtime-unknown", chunkId: "chunk-3", path: "en/not-in-pack.md", score: 0.99 },
  ],
  { resolveDocumentId: resolver.resolve },
);

assert.equal(collapsed.documents.length, 1);
assert.equal(collapsed.documents[0].documentId, "frozen-alpha");
assert.equal(collapsed.documents[0].runtimeDocumentId, "runtime-alpha");
assert.equal(collapsed.duplicateCount, 1);
assert.equal(collapsed.unidentifiedCount, 1);

assert.throws(
  () => createBenchmarkIdentityResolver({ partition: "EN", documents: [{ id: "same" }, { id: "same" }] }),
  /duplicate materialized benchmark path/,
);

console.log("benchmark-v2 identity regressions: 11/11 PASS");
