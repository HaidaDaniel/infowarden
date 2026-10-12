# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EN | dense-only | 0.7083 | 0.8417 | 0.9500 | 0.9833 | 0.7974 | 0.8426 | 30.639703999999938 | 38.66793099999995 |
| EN | hybrid | 0.6833 | 0.8250 | 0.9500 | 0.9833 | 0.7781 | 0.8278 | 214.67713600000025 | 242.66228000000046 |
| EN | hybrid + reranker | 0.7333 | 0.8750 | 0.9333 | 0.9833 | 0.8141 | 0.8553 | 405.949698000004 | 484.411626000001 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
