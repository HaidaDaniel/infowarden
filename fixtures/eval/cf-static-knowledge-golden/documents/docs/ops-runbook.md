# Operations Runbook

This runbook covers the daily operating procedure for the Meridian platform
stack: API, indexer workers, PostgreSQL, Redis, and the Qdrant serving layer.

## On-call rotation

On-call follows a weekly rotation. The primary on-call engineer owns the
incident channel; the secondary on-call is paged only for tier-2 escalations.
Tier-1 issues are expected to be resolved within 30 minutes of the first alert.
A tier-2 escalation is required when an incident is still open after 30
minutes, when customer-facing retrieval is degraded for more than 15 minutes,
or when the primary on-call is unreachable. The escalation path is always:
primary on-call -> secondary on-call -> platform lead.

## Standard restart procedure

Restart the API only after the database and queue are confirmed healthy.
Check `/health/full` before and after the restart. A clean restart must show
`database`, `redis`, `qdrant`, and `embeddings` all `up`. If the embeddings
check is `not_configured`, do not mark the restart complete; the retrieval
path will fail closed.

## Job queue stalls

Indexing jobs are processed by a bounded worker pool. A stalled queue is
diagnosed by job age, not by CPU. If jobs are older than 10 minutes and no
worker is draining, restart the worker container first; restarting the API
does not restart the indexing workers.

## Retrieval degradation checklist

When search quality degrades, verify in this order: active serving revision,
embedding provider health, Qdrant collection coverage, and then profile
weighting. Never delete Qdrant collections to clear a degradation; the
collection is rebuildable from canonical PostgreSQL state.

## Change windows

Production changes run in the 06:00-10:00 UTC window. A change without a
rollback note is not approved. Rollback is image-tag based: keep the previous
API and MCP image tags and recreate the app services on the previous tags.
