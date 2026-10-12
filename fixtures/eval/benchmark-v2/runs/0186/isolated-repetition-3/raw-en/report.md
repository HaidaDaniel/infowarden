# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EN | dense-only | 0.7083 | 0.8417 | 0.9500 | 0.9833 | 0.7974 | 0.8426 | 30.02912900000001 | 39.19664700000021 |
| EN | hybrid | 0.6833 | 0.8250 | 0.9500 | 0.9833 | 0.7781 | 0.8278 | 213.91536000000087 | 241.11083700000017 |
| EN | hybrid + reranker | 0.7333 | 0.8750 | 0.9333 | 0.9833 | 0.8141 | 0.8553 | 403.5383130000009 | 478.10037400000147 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
