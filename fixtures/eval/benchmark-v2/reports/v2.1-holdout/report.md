# Retrieval Benchmark v2.1 HOLDOUT

Quality run over the immutable HOLDOUT split; no tuning or winner changes were performed.

Split: 208 HOLDOUT / 312 DEV (34b11d2ab26eb26086a88fc13685704e9ca46dbf93ad0eaf02ae7be9c37862b3)
Repetitions: 3
Models: qwen3-embedding-0.6b (1024d), qwen3-reranker-0.6b

| Configuration | Hit@10 | MRR | Candidate recall | p50 ms | Failed |
| --- | ---: | ---: | ---: | ---: | ---: |
| dense | 93.8% | 0.7047 | 99.5% | 197 | 0 |
| dense-reranker | 88.9% | 0.7244 | 99.5% | 2500 | 0 |
| lexical-lstar | 71.2% | 0.3328 | 79.8% | 1040 | 0 |
| lexical-lstar-reranker | 8.2% | 0.0599 | 79.8% | 2504 | 0 |
| fusion-legacy | 94.2% | 0.6896 | 99.5% | 1125 | 0 |
| fusion-rrf-k-60-depth-25 | 91.8% | 0.4885 | 99.5% | 1057 | 0 |
| fusion-dbsf-depth-25 | 92.3% | 0.5425 | 99.5% | 1083 | 0 |
| fusion-selected-reranker | 91.8% | 0.7357 | 99.5% | 2537 | 0 |
