# Troubleshooting Retrieval

This page maps common retrieval symptoms to the checks that resolve them.

## Empty results

Empty results mean the retrieval path returned no candidates. Check in this
order: (1) the workspace is `available`, not `unavailable` or `unindexed`;
(2) the active serving revision covers the source you expect; (3) the query
filters are not excluding everything; (4) the embedding provider is reachable.
An empty result is a signal, not an error to bypass with a broader query.

## Stale content

Stale content means the source changed but no refresh produced a new serving
revision. Trigger a refresh and wait for the new revision to become active
before re-querying. Old content disappears only after a successful refresh;
it does not disappear at the moment the file changes.

## Slow responses

Slow responses are usually provider latency, not indexing. Check the
embedding provider and reranker latency first. If the reranker is the slow
stage and results are acceptable without it, disabling the reranker for that
profile is a supported mitigation; it is not a fix for a broken provider.

## Provider outage

When the active index's embedding provider is down, the workspace is reported
`unavailable` and retrieval fails closed. Source records, revisions, and the
Qdrant collection remain intact. Restoring the provider makes the workspace
available again without any data migration.

## Wrong document ranked first

A wrong-first result is a ranking problem. Compare the lexical and dense
candidates in a trace before changing profile weights. If the expected chunk
is present but ranked low, weighting is the lever; if it is absent, the
problem is candidate generation, not ranking.

## Duplicate results

Duplicate results usually indicate a near-duplicate chunk pair or a chunk
boundary problem. Inspect the chunk boundaries around the duplicated text
before assuming an index defect.
