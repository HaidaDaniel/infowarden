# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

Runtime evidence: `e1a01e33d6e7c8d65cb9530ce890887b2233d3d8`, local Qwen
0.6B providers, embedding dimension 1024, Node `v24.21.0`. Host provenance:
Linux `x64`, kernel `6.8.0-142-generic`, 4 CPUs, AMD Ryzen 3 3200G with
Radeon Vega Graphics, 8,201,256,960 bytes of host memory. Each of the 9 partition/mode
runs recorded 10 deterministic warm-up query requests, excluded from latency;
90 warm-up requests were issued for this repetition. Full sanitized per-query
records are in `per-query.jsonl` (1560 JSONL records; SHA-256 `531a44a36ff9789f0586196311559818f983c2bb68fc4401ecfc0397fce53f23`; no source text or credentials).
Provider-call provenance: repetition 1 recorded 2405 calls including 205 one-time cold provider/index setup calls; this repetition recorded 2200 calls after cache reuse.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EN | dense-only | 0.7083 | 0.8417 | 0.9417 | 0.9417 | 0.7906 | 0.8279 | 34.93801399999984 | 64.52989200000002 |
| EN | hybrid | 0.6750 | 0.8250 | 0.9417 | 0.9417 | 0.7703 | 0.8126 | 558.7736549999972 | 658.7261930000022 |
| EN | hybrid + reranker | 0.7250 | 0.8667 | 0.9083 | 0.9333 | 0.7988 | 0.8319 | 782.7137010000006 | 936.6991479999997 |
| RU | dense-only | 0.5833 | 0.7500 | 0.8667 | 0.8667 | 0.6826 | 0.7282 | 33.224210000014864 | 50.39731400000164 |
| RU | hybrid | 0.5833 | 0.7417 | 0.8667 | 0.8667 | 0.6815 | 0.7272 | 245.07652600001893 | 314.5717799999984 |
| RU | hybrid + reranker | 0.6250 | 0.7917 | 0.8667 | 0.8667 | 0.7197 | 0.7566 | 515.1958229999873 | 753.3687370000116 |
| MIXED | dense-only | 0.5679 | 0.7893 | 0.8679 | 0.8750 | 0.6869 | 0.7339 | 34.38278899999568 | 49.76740100001916 |
| MIXED | hybrid | 0.5500 | 0.7786 | 0.8679 | 0.8750 | 0.6760 | 0.7257 | 372.89409600000363 | 643.7453760000062 |
| MIXED | hybrid + reranker | 0.5964 | 0.8179 | 0.8750 | 0.8786 | 0.7136 | 0.7553 | 668.7212489999947 | 927.8127200000454 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
