# Retrieval Benchmark v2.1 DEV Selection

Quality run over the frozen DEV split only; HOLDOUT was not read or scored.

Split: 312 DEV / 208 HOLDOUT (34b11d2ab26eb26086a88fc13685704e9ca46dbf93ad0eaf02ae7be9c37862b3)
Models: qwen3-embedding-0.6b (1024d), qwen3-reranker-0.6b

| Configuration | Hit@10 | MRR | Candidate recall | p50 ms |
| --- | ---: | ---: | ---: | ---: |
| lexical-pg-fts | 1.0% | 0.0096 | 1.0% | 66 |
| lexical-structured | 1.0% | 0.0096 | 1.0% | 376 |
| lexical-bm25-k1-0.9-b-0.5 | 74.0% | 0.3700 | 83.0% | 1114 |
| lexical-bm25-k1-0.9-b-0.75 | 74.7% | 0.3713 | 83.7% | 1088 |
| lexical-bm25-k1-0.9-b-0.9 | 74.7% | 0.3709 | 83.7% | 1085 |
| lexical-bm25-k1-1.2-b-0.5 | 73.7% | 0.3638 | 83.0% | 1085 |
| lexical-bm25-k1-1.2-b-0.75 | 75.0% | 0.3699 | 83.7% | 1143 |
| lexical-bm25-k1-1.2-b-0.9 | 74.4% | 0.3641 | 83.7% | 1026 |
| lexical-bm25-k1-1.5-b-0.5 | 74.4% | 0.3637 | 83.0% | 1142 |
| lexical-bm25-k1-1.5-b-0.75 | 75.3% | 0.3656 | 83.7% | 1011 |
| lexical-bm25-k1-1.5-b-0.9 | 74.0% | 0.3601 | 83.7% | 1116 |
| lexical-bm25f-balanced | 73.7% | 0.3684 | 84.0% | 2117 |
| lexical-bm25f-text-first | 74.7% | 0.3729 | 83.7% | 2204 |
| lexical-bm25f-identifier-first | 73.7% | 0.3684 | 84.0% | 2200 |
| fusion-legacy | 96.5% | 0.7240 | 100.0% | 1178 |
| fusion-rrf-k-20-depth-25 | 93.3% | 0.5410 | 100.0% | 1129 |
| fusion-rrf-k-20-depth-50 | 92.0% | 0.5387 | 100.0% | 1131 |
| fusion-rrf-k-60-depth-25 | 93.3% | 0.5410 | 100.0% | 1106 |
| fusion-rrf-k-60-depth-50 | 88.8% | 0.5344 | 100.0% | 1110 |
| fusion-rrf-k-100-depth-25 | 93.3% | 0.5408 | 100.0% | 1230 |
| fusion-rrf-k-100-depth-50 | 88.5% | 0.5344 | 100.0% | 1206 |
| fusion-dbsf-depth-25 | 95.5% | 0.5869 | 100.0% | 1164 |
| fusion-dbsf-depth-50 | 94.9% | 0.5508 | 100.0% | 1135 |
| dense | 96.8% | 0.7381 | 100.0% | 178 |
| dense-reranker | 90.1% | 0.7444 | 100.0% | 2453 |
| lexical-lstar | 75.3% | 0.3656 | 83.7% | 1375 |
| lexical-lstar-reranker | 7.7% | 0.0484 | 83.7% | 2522 |
| fusion-selected | 96.5% | 0.7240 | 100.0% | 1175 |
| fusion-selected-reranker | 92.9% | 0.7574 | 100.0% | 2495 |

Selected lexical leg: **lexical-bm25-k1-1.5-b-0.75**
Selected fusion: **fusion-legacy**

