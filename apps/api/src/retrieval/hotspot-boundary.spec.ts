import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function lineCount(relativePath: string) {
  return read(relativePath).split(/\r?\n/).length;
}

describe("hotspot ownership boundaries", () => {
  it("keeps API hotspots below the pre-LLM size ceiling", () => {
    expect(lineCount("apps/api/src/retrieval/retrieval.service.ts")).toBeLessThanOrEqual(1450);
    expect(lineCount("apps/api/src/jobs/local-folder-indexer.ts")).toBeLessThanOrEqual(650);
  });

  it("keeps extracted retrieval helpers independent from the orchestrator", () => {
    expect(read("apps/api/src/retrieval/retrieval-context-packaging.ts")).not.toContain("retrieval.service");
    expect(read("apps/api/src/retrieval/retrieval.types.ts")).not.toContain("retrieval.service");
  });

  it("keeps indexing rollback independent from the local folder orchestrator", () => {
    expect(read("apps/api/src/jobs/indexing-rollback.ts")).not.toContain("local-folder-indexer");
  });
});
