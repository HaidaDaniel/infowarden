# Deployment Guide

This guide covers the production deployment sequence for the Meridian
platform.

## Topology

One deployment serves all workspaces. Data services (PostgreSQL, Redis,
Qdrant, managed uploads) live on a private network. The API, MCP adapter, and
Studio UI bind to loopback and are exposed only through the host reverse
proxy, which terminates TLS.

## Deployment order

1. Build and tag immutable images for API, MCP, and Studio.
2. Start or verify PostgreSQL, Redis, and Qdrant on the private network.
3. Run the one-shot migration image:
   `docker compose -f docker-compose.production.yml --profile migrate run --rm api-migrate`.
4. Start the API and verify `/health` before starting MCP and Studio.
5. Confirm `/health/full` is `healthy` before declaring the deployment live.

The migration step must complete before the API starts. Starting the API
against an unmigrated schema is treated as a failed deployment, not a retry
case.

## Rollback

Rollback is image-tag based. Keep the previous API and MCP image tags, stop
the new app containers, point the image variables back to the previous tags,
and recreate the app services. Database migrations are forward-only; a
rollback never rewinds the schema. Test any rollback on a restored backup,
never on the only production database.

## Environment requirements

Production refuses to start when API auth is disabled, the admin key is a
sentinel value, or CORS is a wildcard. Required values include the database
password, the admin API key, a narrow CORS origin, the Qdrant API key, and
the embedding provider endpoint, model, and dimension.

## Smoke after deploy

After every deployment, run the health endpoints and one bounded retrieval
call against a known workspace. A deployment is not "done" until retrieval
returns expected content with correct provenance, not merely until the API
responds.
