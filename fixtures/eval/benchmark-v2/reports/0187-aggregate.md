# Retrieval Benchmark v2 — corrected statistical aggregate

Source: task 0186 isolated evidence; runtime SHA a547a0c0f2edea3f457ef1294eec8461aa7fd449.
No model or retrieval calls were made by task 0187. Every query metric was averaged across repetitions 1–3 before paired bootstrap. Canonical averages: reports/0187-query-averages.json. Frozen manifest/questions/qrels/semantic-review checksums and source-run IDs are bound in 0187-aggregate.json.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EN | dense | 0.7083 | 0.8417 | 0.9500 | 0.9833 | 0.7974 | 0.8426 | 30.5 | 38.2 |
| EN | hybrid | 0.6833 | 0.8250 | 0.9500 | 0.9833 | 0.7781 | 0.8278 | 214.5 | 243.9 |
| EN | hybrid-reranker | 0.7333 | 0.8750 | 0.9333 | 0.9833 | 0.8141 | 0.8553 | 405.6 | 484.4 |
| RU | dense | 0.5833 | 0.7500 | 0.8750 | 0.9583 | 0.6965 | 0.7595 | 32.5 | 42.9 |
| RU | hybrid | 0.5750 | 0.7417 | 0.8750 | 0.9583 | 0.6898 | 0.7543 | 96.2 | 128.2 |
| RU | hybrid-reranker | 0.6417 | 0.8083 | 0.8833 | 0.9583 | 0.7436 | 0.7955 | 402.4 | 575.8 |
| MIXED | dense | 0.5714 | 0.7929 | 0.8786 | 0.9429 | 0.7013 | 0.7603 | 33.1 | 41.7 |
| MIXED | hybrid | 0.5571 | 0.7821 | 0.8786 | 0.9429 | 0.6913 | 0.7527 | 213.9 | 367.3 |
| MIXED | hybrid-reranker | 0.6071 | 0.8214 | 0.8964 | 0.9429 | 0.7303 | 0.7828 | 501.7 | 655.5 |

Paired bootstrap uses 10,000 resamples of query-level metrics averaged across all three repetitions, with the frozen 0174 seed rule.

Seed normalization: lower-case partition; sorted mode keys joined by `|`; SHA-256 input `0174|benchmarkRevision|partition|sortedModePair|metric`; first eight hex characters parsed as unsigned 32-bit. Bootstrap uses the documented uint32 LCG and sorted percentile rule.
Bootstrap input order is the hash-linked canonical query-average artifact order: partition, mode order [dense, hybrid-reranker, hybrid], query_id ascending.
