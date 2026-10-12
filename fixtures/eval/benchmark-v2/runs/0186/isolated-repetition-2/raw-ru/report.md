# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RU | dense-only | 0.5833 | 0.7500 | 0.8750 | 0.9583 | 0.6965 | 0.7595 | 32.23862199999985 | 43.16817200000014 |
| RU | hybrid | 0.5750 | 0.7417 | 0.8750 | 0.9583 | 0.6898 | 0.7543 | 95.75331699999879 | 131.71326800000134 |
| RU | hybrid + reranker | 0.6417 | 0.8083 | 0.8833 | 0.9583 | 0.7436 | 0.7955 | 403.33854599999904 | 575.7917069999967 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
