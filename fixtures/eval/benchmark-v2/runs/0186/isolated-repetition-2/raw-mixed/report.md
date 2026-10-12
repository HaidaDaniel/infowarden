# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| MIXED | dense-only | 0.5714 | 0.7929 | 0.8786 | 0.9429 | 0.7013 | 0.7603 | 33.10958699999992 | 42.16779300000053 |
| MIXED | hybrid | 0.5571 | 0.7821 | 0.8786 | 0.9429 | 0.6913 | 0.7527 | 205.6067550000007 | 367.7797469999932 |
| MIXED | hybrid + reranker | 0.6071 | 0.8214 | 0.8964 | 0.9429 | 0.7303 | 0.7828 | 503.34651499999745 | 653.0691569999908 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
