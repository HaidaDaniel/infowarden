# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RU | dense-only | 0.5833 | 0.7500 | 0.8750 | 0.9583 | 0.6965 | 0.7595 | 32.832728999999745 | 42.141141999999945 |
| RU | hybrid | 0.5750 | 0.7417 | 0.8750 | 0.9583 | 0.6898 | 0.7543 | 96.36832700000014 | 124.93243699999948 |
| RU | hybrid + reranker | 0.6417 | 0.8083 | 0.8833 | 0.9583 | 0.7436 | 0.7955 | 400.4426390000008 | 565.4264279999989 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
