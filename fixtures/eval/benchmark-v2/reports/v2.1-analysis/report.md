# Retrieval Benchmark v2.1 HOLDOUT analysis

This report analyzes the immutable HOLDOUT evidence only. It does not tune, relabel, or rerun retrieval.
Failure taxonomy limitation: inferred from frozen semantic primary_bucket and candidate-recall fields; categories are diagnostic labels, not causal proof.

Split checksum: 34b11d2ab26eb26086a88fc13685704e9ca46dbf93ad0eaf02ae7be9c37862b3
Bootstrap: 2000 query-level resamples, seed `infowarden-retrieval-v2.1-analysis-2026-10`

## Overall results

| Mode | Hit@10 | MRR | nDCG@10 | candidate recall | p50 ms | p95 ms | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dense | 93.8% | 0.7047 | 0.7592 | 99.5% | 197 | 248 | 0 |
| dense-reranker | 88.9% | 0.7244 | 0.7617 | 99.5% | 2500 | 3019 | 0 |
| lexical-lstar | 71.2% | 0.3328 | 0.4169 | 79.8% | 1040 | 2178 | 0 |
| lexical-lstar-reranker | 8.2% | 0.0599 | 0.0500 | 79.8% | 2504 | 3300 | 0 |
| fusion-legacy | 94.2% | 0.6896 | 0.7477 | 99.5% | 1125 | 2335 | 0 |
| fusion-rrf-k-60-depth-25 | 91.8% | 0.4885 | 0.5868 | 99.5% | 1057 | 2220 | 0 |
| fusion-dbsf-depth-25 | 92.3% | 0.5425 | 0.6308 | 99.5% | 1083 | 2315 | 0 |
| fusion-selected-reranker | 91.8% | 0.7357 | 0.7781 | 99.5% | 2537 | 3141 | 0 |

## Product decision

recommend dense as the v0.1 default under the frozen paired-delta rule and lower latency; keep hybrid-legacy as a compatibility and explicit profile option, with reranking opt-in.

Legacy outcome: **KEEP BUT NON-DEFAULT**. Runtime changed by this analysis: **no**.

The controlled fusion comparison keeps the DEV-selected BM25 lexical leg constant across legacy, RRF, and DBSF. Candidate-overlap and failure-taxonomy details are machine-readable in `benchmark-v21-analysis.json`.
