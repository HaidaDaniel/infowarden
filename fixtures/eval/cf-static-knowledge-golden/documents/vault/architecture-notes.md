# Architecture Notes

Loose notes on how the pieces fit together. See the decision log for the
binding versions of anything stated here.

## Workspace model

A workspace is the unit of retrieval. It owns sources, an active serving
revision, one vector placement, and retrieval profiles. The list and detail
surfaces report each workspace as `available`, `unavailable`, or
`unindexed` based on whether its active index's provider is reachable and
whether a serving revision exists.

## Serving revisions

A serving revision is an immutable snapshot of which source revisions are
served and what their manifests are. Retrieval resolves exactly one serving
revision per request. A refresh that changes sources produces a new revision;
the old one keeps serving until the new one is validated and active.

## Placement

Each workspace has one active vector placement (one backend, one collection
name derived from the workspace). Placement is stable by default; moving a
workspace between backends is an explicit operator operation with
validation, not an automatic balance.

## What "unavailable" means

An `unavailable` workspace is a provider problem, not a data problem. Its
PostgreSQL rows, source content, active index reference, and Qdrant
collection are all intact. Starting the matching embedding provider returns
the workspace to `available` without migration.

## Bounded expansion

Retrieval can expand around a hit (neighbors before/after) to provide
context, bounded by the profile. Expansion is a presentation concern; it
never changes which revision or backend served the hit.
