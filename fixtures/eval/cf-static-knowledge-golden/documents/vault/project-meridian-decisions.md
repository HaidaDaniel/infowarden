# Project Meridian — Decision Log

Decisions are numbered, immutable once accepted, and superseded only by a
new decision that names the one it replaces.

## D-001 — Single deployment, many workspaces

One running deployment serves all workspaces. We rejected per-workspace
stacks because the operational cost grows with the number of document sets
and the benefit was never demonstrated. Workspaces share PostgreSQL, Redis,
and Qdrant; isolation is logical, through serving revisions and collection
naming.

## D-002 — Qdrant is a cache, not truth

Qdrant is a rebuildable serving layer. Canonical state is PostgreSQL plus
managed uploads. Any design that treats a Qdrant collection as the system of
record is rejected by default and must be re-proposed with a recovery story.

## D-003 — Refresh is explicit

Source truth changes do not automatically change serving state. A refresh
creates an immutable revision and a validated serving manifest. Automatic
refresh exists for webhook-triggered sources but is opt-in per source.

## D-004 — Retrieval profiles are per workspace

Retrieval profiles (weighting, candidate limits, rerank) are stored per
workspace and applied by key. A global default profile exists, but a
workspace's stored profile always wins when the key matches.

## D-005 — Memory writes are caller-supplied

Durable memory stores text the caller supplies. The platform never generates
session-summary text on the caller's behalf. This keeps the memory contract
auditable: what was stored is exactly what was sent.

## D-006 — Answer generation is optional

The retrieval plane works without any answer LLM. Generated answers are an
explicit, bounded, single-call capability. The default agent-facing surface
does not include a generated-answer tool.
