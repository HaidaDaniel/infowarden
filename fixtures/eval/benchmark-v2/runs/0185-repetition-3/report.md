# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

Runtime evidence: `e1a01e33d6e7c8d65cb9530ce890887b2233d3d8`, local Qwen
0.6B providers, embedding dimension 1024, Node `v24.21.0`. Host provenance:
Linux `x64`, kernel `6.8.0-142-generic`, 4 CPUs, AMD Ryzen 3 3200G with
Radeon Vega Graphics, 8,201,256,960 bytes of host memory. Each of the 9 partition/mode
runs recorded 10 deterministic warm-up query requests, excluded from latency;
90 warm-up requests were issued for this repetition. Full sanitized per-query
records are in `per-query.jsonl` (1560 JSONL records; SHA-256 `58435d25ca5a1c526bea2327ace8f96d47e215acd0a3442255aeeb69703fabcf`; no source text or credentials).
Provider-call provenance: repetition 1 recorded 2405 calls including 205 one-time cold provider/index setup calls; this repetition recorded 2200 calls after cache reuse.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EN | dense-only | 0.7083 | 0.8417 | 0.9417 | 0.9417 | 0.7906 | 0.8279 | 32.68929500000013 | 60.44723099999999 |
| EN | hybrid | 0.6750 | 0.8250 | 0.9417 | 0.9417 | 0.7703 | 0.8126 | 560.5961019999959 | 651.9596230000025 |
| EN | hybrid + reranker | 0.7250 | 0.8667 | 0.9083 | 0.9333 | 0.7988 | 0.8319 | 772.6108700000041 | 919.0067819999967 |
| RU | dense-only | 0.5833 | 0.7500 | 0.8667 | 0.8667 | 0.6826 | 0.7282 | 30.85890500000096 | 40.171478000003844 |
| RU | hybrid | 0.5833 | 0.7417 | 0.8667 | 0.8667 | 0.6815 | 0.7272 | 244.97276899998542 | 349.1313539999828 |
| RU | hybrid + reranker | 0.6250 | 0.7917 | 0.8667 | 0.8667 | 0.7197 | 0.7566 | 509.00417599998764 | 764.6024749999924 |
| MIXED | dense-only | 0.5679 | 0.7893 | 0.8679 | 0.8750 | 0.6869 | 0.7339 | 33.22506299999077 | 42.25848199997563 |
| MIXED | hybrid | 0.5500 | 0.7786 | 0.8679 | 0.8750 | 0.6760 | 0.7257 | 363.3764910000027 | 638.3699660000275 |
| MIXED | hybrid + reranker | 0.5964 | 0.8179 | 0.8750 | 0.8786 | 0.7136 | 0.7553 | 681.4038990000263 | 922.1459559999639 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
