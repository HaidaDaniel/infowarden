# Retrieval Benchmark v2 — isolated Qwen 0.6B repetition 2

Runtime commit: a547a0c0f2edea3f457ef1294eec8461aa7fd449. Separate workspace/index per partition; ten warm-up queries per partition/mode excluded.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EN | dense | 0.7083 | 0.8417 | 0.9500 | 0.9833 | 0.7974 | 0.8426 | 30.6 | 38.7 |
| EN | hybrid | 0.6833 | 0.8250 | 0.9500 | 0.9833 | 0.7781 | 0.8278 | 214.7 | 242.7 |
| EN | hybrid-reranker | 0.7333 | 0.8750 | 0.9333 | 0.9833 | 0.8141 | 0.8553 | 405.9 | 484.4 |
| RU | dense | 0.5833 | 0.7500 | 0.8750 | 0.9583 | 0.6965 | 0.7595 | 32.2 | 43.2 |
| RU | hybrid | 0.5750 | 0.7417 | 0.8750 | 0.9583 | 0.6898 | 0.7543 | 95.8 | 131.7 |
| RU | hybrid-reranker | 0.6417 | 0.8083 | 0.8833 | 0.9583 | 0.7436 | 0.7955 | 403.3 | 575.8 |
| MIXED | dense | 0.5714 | 0.7929 | 0.8786 | 0.9429 | 0.7013 | 0.7603 | 33.1 | 42.2 |
| MIXED | hybrid | 0.5571 | 0.7821 | 0.8786 | 0.9429 | 0.6913 | 0.7527 | 205.6 | 367.8 |
| MIXED | hybrid-reranker | 0.6071 | 0.8214 | 0.8964 | 0.9429 | 0.7303 | 0.7828 | 503.3 | 653.1 |

Cross-partition path count: 0; unidentified result count: 0.
