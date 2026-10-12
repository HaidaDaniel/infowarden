# Onboarding Notes

Practical notes for a new engineer setting up the local environment.

## Local stack

`pnpm dev` starts PostgreSQL, Redis, Qdrant, the local CPU embedding
provider, the API, and the Studio UI. It is fail-closed by default: if a
required port is busy, it lists the owning processes and exits instead of
killing them. Only opt into cleanup when you understand what would be
stopped.

## First workspace

Create one workspace and do not create one per document set. A local-folder
source pointing at a Markdown directory is the fastest path to a first
retrieval. Indexing runs as a job; watch it complete before searching.

## Port map

- API: 3000
- MCP HTTP: 3003
- Studio: 5173
- Qdrant HTTP: 6333
- Local embedding (TEI): 8080
- Local reranker: 8081

If two tools claim the same port, trust `ps`/`docker compose ps` over the
error message; the error names the port, not always the owner.

## Embeddings are the bottleneck

The first run downloads model artifacts and is slow. Subsequent runs start
in seconds. If retrieval "works" locally but is slow, check whether the
embedding provider is the CPU baseline or an external endpoint, and whether
the reranker is enabled for the profile you are using.
