# Deployment boundary

The Compose production example is a self-hosted starting point. Review its
required environment variables before use. Keep databases and providers private;
expose API/MCP/Studio only through authenticated TLS ingress. Back up PostgreSQL
and managed uploads; preserve external-source reconnect information and provider
secret references. Qdrant can be rebuilt from canonical state. Redis is not
canonical durable state. Verify recovery before relying on a deployment.

Use `MCP_PROFILE=read` for retrieval consumers, `agent` for bounded memory writes,
and `operator` only for administration. `all` is a compatibility/debug profile.
Stable `CONTEXTFORGE_*` names and storage paths remain compatibility identifiers.

## Persistent local development

Install Node 22–24, pnpm 10.30.3, Bash and Docker Compose v2; start Docker first.
Use Linux/macOS or WSL2. From the repository root:

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm dev:cpu
```

Review `.env` before starting. Development defaults disable authentication and
are for local use. The CPU preset starts local embedding and reranker services;
initial image/model downloads need Internet access. Keep an answer LLM optional.
The isolated `pnpm demo` uses temporary state and tears down its own services.

## Compose deployment preparation

Copy needed values into a private production environment file outside the
checkout. Set new `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `QDRANT_API_KEY`,
`ADMIN_API_KEY`, narrow `CORS_ORIGIN`, a matching `DATABASE_URL`, and
`EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION`,
`EMBEDDING_API_KEY` for an operator-managed embedding endpoint. Container
URLs must be reachable from the Compose network; localhost inside a container
is not the host. Replace every `__REQUIRED_*` placeholder; do not reuse sample
credentials. Review ports, persistent volumes and TLS ingress before startup.

```bash
docker compose --env-file /secure/infowarden.env -f docker-compose.production.yml config --quiet
docker compose --env-file /secure/infowarden.env -f docker-compose.production.yml build
docker compose --env-file /secure/infowarden.env -f docker-compose.production.yml up -d postgres redis qdrant
docker compose --env-file /secure/infowarden.env -f docker-compose.production.yml --profile migrate run --rm api-migrate
docker compose --env-file /secure/infowarden.env -f docker-compose.production.yml up -d api mcp studio
```

The config check validates Compose syntax, not secret quality or operational
readiness. Check `/health/full`, authenticated retrieval and recovery from
backups. Resource limits and benchmark latency do not establish production
capacity, high availability or service-level guarantees.
