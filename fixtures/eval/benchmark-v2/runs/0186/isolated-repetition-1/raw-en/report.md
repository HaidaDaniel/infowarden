# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EN | dense-only | 0.7083 | 0.8417 | 0.9500 | 0.9833 | 0.7974 | 0.8426 | 30.88854500000025 | 36.56286999999975 |
| EN | hybrid | 0.6833 | 0.8250 | 0.9500 | 0.9833 | 0.7781 | 0.8278 | 214.44281000000046 | 248.53488599999946 |
| EN | hybrid + reranker | 0.7333 | 0.8750 | 0.9333 | 0.9833 | 0.8141 | 0.8553 | 404.5985890000011 | 476.56339599999774 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
