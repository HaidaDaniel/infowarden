# Chapter 6: Operating Vector Indexes

Operating a vector index means treating it as derived state. The source of
truth is the canonical store; the vector collection is a rebuildable
projection of it. Every operational decision follows from that asymmetry.

Rebuild is the standard recovery. When a collection is lost, corrupt, or
built with the wrong model, the operation is: build a candidate collection
from canonical chunks, validate it (counts, source-revision coverage, labeled
probes), then cut over. Validation before cutover is what prevents a broken
candidate from becoming the serving index.

Rollback exists because cutover is a risk. The previous collection is
retained for a bounded window after cutover, and a rollback restores it
without re-indexing. Rollback is the reason the retention window is a
configuration, not an optimization: shrinking it makes rollback cheaper and
safer.

Provider outages are handled by failing closed. If the embedding provider
that the active index requires is unavailable, retrieval for that workspace
stops returning results rather than silently switching models. This protects
index identity: a 384-dimension index is not reinterpretated by a 1024-
dimension model "to keep things working."

Unload removes serving vectors while keeping canonical state; load rebuilds
serving coverage from the active manifest. These are resource operations,
not data operations, and neither one changes what the index contains, only
whether it is in memory on a backend.
