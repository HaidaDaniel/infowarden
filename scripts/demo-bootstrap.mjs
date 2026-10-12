import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const requireFromMcp = createRequire(new URL("../apps/mcp-server/package.json", import.meta.url));
const { Client } = requireFromMcp("@modelcontextprotocol/sdk/client");
const { StreamableHTTPClientTransport } = requireFromMcp("@modelcontextprotocol/sdk/client/streamableHttp.js");

const apiUrl = process.env.DEMO_API_URL;
const mcpUrl = process.env.DEMO_MCP_URL;
const mcpKey = process.env.DEMO_MCP_KEY;
const fixtureRoot = process.env.DEMO_FIXTURE_ROOT;
const timeoutMs = Number(process.env.DEMO_TIMEOUT_SECONDS || 240) * 1000;

if (!apiUrl || !mcpUrl || !mcpKey || !fixtureRoot) throw new Error("demo runtime environment is incomplete");

async function api(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok)
    throw new Error(`API ${options.method || "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${details}` : ""}`);
}

function collectText(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectText(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectText(item, output));
  return output;
}

function hasProvenance(value) {
  return /source|revision|path|line/i.test(collectText(value).join("\n"));
}

async function waitForJob(jobId, label) {
  const deadline = Date.now() + timeoutMs;
  let detail;
  while (Date.now() < deadline) {
    detail = await api(`/jobs/indexing/${jobId}`);
    process.stdout.write(`-- ${label}: ${detail.status}\n`);
    if (detail.status === "succeeded") return detail;
    if (detail.status === "failed") throw new Error(`${label} failed: ${JSON.stringify(detail)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${label} exceeded bounded timeout of ${timeoutMs / 1000}s: ${JSON.stringify(detail)}`);
}

async function bootstrapWorkspace(slug, name, sourcePath) {
  const result = await api("/jobs/indexing/bootstrap", {
    method: "POST",
    body: JSON.stringify({
      knowledgeBase: { slug, name, description: "Sanitized InfoWarden public demo workspace" },
      source: { type: "local_folder", uri: sourcePath, includeRules: ["**/*.md"], excludeRules: ["**/.DS_Store"] },
      job: { type: "scan_source" },
    }),
  });
  assert(result.knowledgeBase?.slug === slug, `workspace ${slug} was not created or reused`);
  assert(result.source?.id && result.job?.id, `workspace ${slug} bootstrap returned incomplete state`);
  const job = await waitForJob(result.job.id, `${slug} initial indexing`);
  return { ...result, job };
}

const backendHealth = await api("/vector-backends/health/refresh", { method: "POST", body: "{}" });
assert(
  backendHealth.some(
    (backend) =>
      backend.name === "default-qdrant" && backend.healthMetadata?.healthy && backend.healthMetadata?.compatible,
  ),
  "default-qdrant did not become healthy and compatible",
  JSON.stringify(backendHealth),
);
process.stdout.write("Vector backend: default-qdrant healthy and compatible\n");

function searchHas(response, marker) {
  return (response.results || []).some((item) => collectText(item).some((text) => text.includes(marker)));
}

const alphaSlug = "infowarden-demo-alpha";
const betaSlug = "infowarden-demo-beta";
const alpha = await bootstrapWorkspace(alphaSlug, "InfoWarden Demo — Stable Knowledge", `${fixtureRoot}/alpha`);
await bootstrapWorkspace(betaSlug, "InfoWarden Demo — Isolated Reference", `${fixtureRoot}/beta`);

const alphaSearch = await api(`/workspaces/${alphaSlug}/search`, {
  method: "POST",
  body: JSON.stringify({ query: "source truth and rebuildable Qdrant serving state", topK: 5 }),
});
assert(alphaSearch.results?.length, "REST retrieval returned no alpha results");
assert(hasProvenance(alphaSearch.results), "REST retrieval did not expose provenance metadata");
process.stdout.write(`REST retrieval: ${alphaSearch.results.length} result(s), provenance present\n`);

const betaSearch = await api(`/workspaces/${betaSlug}/search`, {
  method: "POST",
  body: JSON.stringify({ query: "durable agent memory boundary", topK: 5 }),
});
assert(betaSearch.results?.length, "REST retrieval returned no beta results");
assert(!searchHas(betaSearch, "OLD_REFRESH_MARKER"), "workspace isolation check saw alpha marker in beta");
process.stdout.write(`Workspace isolation: ${alphaSlug} and ${betaSlug} returned separate source collections\n`);

const contextPackage = await api(`/workspaces/${alphaSlug}/context-package`, {
  method: "POST",
  body: JSON.stringify({ query: "retrieval provenance and source revisions", topK: 5, tokenBudget: 1200 }),
});
assert(
  contextPackage.groups?.length && hasProvenance(contextPackage),
  "context package lacked provenance-bearing groups",
);
process.stdout.write(`Context package: ${contextPackage.groups.length} group(s), bounded provenance present\n`);

const decisionFile = `${fixtureRoot}/alpha/decisions.md`;
const oldMarker = "OLD_REFRESH_MARKER";
const newMarker = "NEW_REFRESH_MARKER";
const originalDecision = readFileSync(decisionFile, "utf8");
try {
  writeFileSync(decisionFile, originalDecision.replace(oldMarker, newMarker), "utf8");
  const refresh = await api(`/workspaces/${alphaSlug}/sources/${alpha.source.id}/refresh`, {
    method: "POST",
    body: JSON.stringify({ mode: "incremental", reason: "public demo source truth refresh" }),
  });
  assert(refresh.job?.id, "source refresh did not return a job id");
  await waitForJob(refresh.job.id, "alpha source refresh");

  const oldSearch = await api(`/workspaces/${alphaSlug}/search`, {
    method: "POST",
    body: JSON.stringify({ query: oldMarker, topK: 5, pathPrefix: "decisions.md" }),
  });
  const newSearch = await api(`/workspaces/${alphaSlug}/search`, {
    method: "POST",
    body: JSON.stringify({ query: newMarker, topK: 5, pathPrefix: "decisions.md" }),
  });
  assert(!searchHas(oldSearch, oldMarker), "old source marker remained after refresh");
  assert(searchHas(newSearch, newMarker), "new source marker was not searchable after refresh");
  process.stdout.write("Source refresh: old marker absent, new marker searchable\n");
} finally {
  writeFileSync(decisionFile, originalDecision, "utf8");
}

const qdrantUrl = process.env.QDRANT_HTTP_URL;
const collection = await fetch(`${qdrantUrl}/collections/kb-${alpha.knowledgeBase.id}`);
assert(collection.ok, "Qdrant serving collection was not created");
process.stdout.write("Qdrant: serving collection present and treated as rebuildable state\n");

const client = new Client({ name: "infowarden-demo-client", version: "0.1.0" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
  requestInit: { headers: { Authorization: `Bearer ${mcpKey}` } },
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  assert(toolNames.includes("list_workspaces") && toolNames.includes("retrieve_context"), "MCP read tools missing");
  const listed = await client.callTool({ name: "list_workspaces", arguments: {} });
  const retrieved = await client.callTool({
    name: "retrieve_context",
    arguments: { workspaceId: alphaSlug, query: "source revisions and provenance", topK: 3, tokenBudget: 1000 },
  });
  assert(collectText(listed).join("\n").includes(alphaSlug), "MCP list_workspaces did not show alpha workspace");
  assert(hasProvenance(retrieved), "MCP retrieve_context did not show provenance");
  process.stdout.write("MCP read flow: list_workspaces and retrieve_context passed with provenance\n");
} finally {
  await client.close();
}

process.stdout.write(
  `${JSON.stringify(
    {
      workspaces: [alphaSlug, betaSlug],
      embedding: { provider: "local CPU TEI", model: "BAAI/bge-small-en-v1.5", dimensions: 384 },
      retrieval: { restResults: alphaSearch.results.length, provenance: true },
      refresh: { oldMarkerAbsent: true, newMarkerPresent: true },
      mcp: { tools: ["list_workspaces", "retrieve_context"] },
      qdrant: "rebuildable serving state",
    },
    null,
    2,
  )}\n`,
);
