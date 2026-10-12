# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| MIXED | dense-only | 0.5714 | 0.7929 | 0.8786 | 0.9429 | 0.7013 | 0.7603 | 33.21573499999977 | 41.505967000000055 |
| MIXED | hybrid | 0.5571 | 0.7821 | 0.8786 | 0.9429 | 0.6913 | 0.7527 | 212.9724499999993 | 365.6363190000011 |
| MIXED | hybrid + reranker | 0.6071 | 0.8214 | 0.8964 | 0.9429 | 0.7303 | 0.7828 | 501.19917799998075 | 655.5262339999899 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
