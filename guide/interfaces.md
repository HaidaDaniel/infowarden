# Interfaces and source lifecycle

The API owns ingestion, indexing, retrieval, memory and vector lifecycle.
Swagger at `/api/docs` and `/api/docs-json` is the running REST reference.
Workspace endpoints accept workspace IDs/slugs; `/knowledge-bases` remains a
compatibility surface. `/health` is liveness and `/health/full` reports database,
Redis, Qdrant and embedding provider health. Provider outages preserve canonical
state and report workspace unavailability.

Supported source types are `local_folder`, `git_repo`, `obsidian_vault`, `upload`
and `url`. Managed uploads support bounded ZIPs and text-layer PDF, DOCX and
HTML extraction. External sources are read-only. URL access follows bounded
crawl, robots/same-host and SSRF controls; private-network access is denied by
default. Refresh can be manual, scheduled, webhook-driven or opt-in folder watch.

The lifecycle is scan/import, immutable source revision, deterministic parsing
and chunking, canonical PostgreSQL rows, vector materialization, validated serving
revision, retrieval, and retryable superseded-index cleanup. After a successful
refresh, deleted source content leaves the active serving revision. Back up
canonical state and managed uploads before testing recovery.

## MCP consumers

Set `CONTEXTFORGE_BACKEND_URL` to the API. Build the adapter with
`pnpm --filter mcp-server build`, then use `node apps/mcp-server/dist/index.js`
for stdio, or add `--http` for HTTP. Integration config examples are under
`examples/integrations`; replace checkout and endpoint placeholders before use.

| Profile          | Intended use                                                            |
| ---------------- | ----------------------------------------------------------------------- |
| `read` (default) | `retrieve_context`, `read_document`, `search_memory`, `list_workspaces` |
| `agent`          | Read tools plus deliberate bounded memory writes/updates/archive        |
| `operator`       | Diagnostics, lifecycle and vector administration                        |
| `all`            | Compatibility/debug and optional answer generation                      |

Profile membership is enforced on listing and invocation. Durable memory stores
caller-written facts, decisions and session summaries; it does not automatically
summarize agent sessions. Hard deletion is an operator capability.

## Retrieval and answers

`default` selects dense retrieval, `lexical` selects BM25 and `hybrid` selects
BM25 plus legacy fusion. Advanced persisted profile identities remain available.
Responses carry source/revision/path provenance and bounded context. Debug traces
are opt-in. `chunks` needs no answer provider; `rag_answer` performs one bounded
provider-backed synthesis with citation validation. Lexical reranking is unsupported.
Studio is an administrative REST client and exposes broader controls than the
ordinary MCP consumer. It does not expand the consumer capability boundary.
