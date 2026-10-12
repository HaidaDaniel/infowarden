# Chapter 4: Reranking

Reranking takes a bounded candidate set produced by the first stage and
re-orders it with a more expensive model. The standard design is a
cross-encoder: instead of scoring the query and each document independently,
it scores the query-document pair together, which captures interactions that
bi-encoder embeddings miss.

The cost is latency. A cross-encoder scores every candidate it is given, so
reranking time grows with the candidate limit. Rerankers are therefore always
bounded: a small top-N (commonly 20 to 50 candidates) enters the reranker,
and everything outside that window keeps its first-stage order.

Reranking is a comparison, not a default. It helps when the first stage
retrieves the right chunks but ranks them wrong. It hurts when the first
stage misses the right chunk entirely: no reranker can rank a document it
never received. And it degrades gracefully in one specific way that must be
configured explicitly: if the reranker provider is unavailable, the system
must either fail closed or fall back to first-stage order. A silent fallback
that is not surfaced in the response is a bug, not a feature.

A useful reranker metric is the rank delta: for each expected document, the
difference between its first-stage rank and its post-rerank rank. If the
delta is consistently negative (expected documents move down), the reranker
model is mismatched to the corpus and the fix is the model, not the weights.
