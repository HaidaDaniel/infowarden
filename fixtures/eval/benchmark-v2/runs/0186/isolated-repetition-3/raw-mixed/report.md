# Retrieval Benchmark v2 Report

Generated from the authoritative `POST /workspaces/:id/retrieval-trace` path.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| MIXED | dense-only | 0.5714 | 0.7929 | 0.8786 | 0.9429 | 0.7013 | 0.7603 | 32.76459799999975 | 40.181093999999575 |
| MIXED | hybrid | 0.5571 | 0.7821 | 0.8786 | 0.9429 | 0.6913 | 0.7527 | 214.76314699999057 | 366.5308189999996 |
| MIXED | hybrid + reranker | 0.6071 | 0.8214 | 0.8964 | 0.9429 | 0.7303 | 0.7828 | 501.0683839999838 | 657.0339109999768 |

Lexical-only is recorded as unsupported because the product runtime has no zero-dense contract.
