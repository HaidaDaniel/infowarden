# Retrieval Benchmark v2 — Qwen 0.6B aggregate

Runtime commit: `e1a01e33d6e7c8d65cb9530ce890887b2233d3d8`
Repetitions: 3; query labels/qrels and mode matrix were frozen before execution.

Host provenance: Linux `x64`, kernel `6.8.0-142-generic`, 4 CPUs, AMD Ryzen 3
3200G with Radeon Vega Graphics, 8,201,256,960 bytes of host memory, Node `v24.21.0`.
Each repetition recorded 90 warm-up requests (10 per partition/mode), excluded
from latency measurements. Sanitized per-query JSONL evidence is retained at
`../runs/0185-repetition-{1,2,3}/per-query.jsonl`; source text and credentials
are not included. Each repetition has 1,560 records; SHA-256 values are recorded in `0185-aggregate.json`. Repetition 1 reports 2405 provider calls including 205 one-time cold setup calls; repetitions 2 and 3 report 2200 after cache reuse.

| Partition | Mode | Hit@1 | Hit@3 | Hit@5 | Hit@10 | MRR | nDCG@10 | p50 ms | p95 ms | Failed |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EN | dense | 0.7083 | 0.8417 | 0.9417 | 0.9417 | 0.7906 | 0.8279 | 35.4 | 67.9 | 0 |
| EN | hybrid | 0.6750 | 0.8250 | 0.9417 | 0.9417 | 0.7703 | 0.8126 | 562.8 | 660.4 | 0 |
| EN | hybrid-reranker | 0.7250 | 0.8667 | 0.9083 | 0.9333 | 0.7988 | 0.8319 | 785.9 | 968.8 | 0 |
| RU | dense | 0.5833 | 0.7500 | 0.8667 | 0.8667 | 0.6826 | 0.7282 | 32.4 | 43.3 | 0 |
| RU | hybrid | 0.5833 | 0.7417 | 0.8667 | 0.8667 | 0.6815 | 0.7272 | 246.3 | 325.9 | 0 |
| RU | hybrid-reranker | 0.6250 | 0.7917 | 0.8667 | 0.8667 | 0.7197 | 0.7566 | 512.0 | 767.5 | 0 |
| MIXED | dense | 0.5679 | 0.7893 | 0.8679 | 0.8750 | 0.6869 | 0.7339 | 33.2 | 44.3 | 0 |
| MIXED | hybrid | 0.5500 | 0.7786 | 0.8679 | 0.8750 | 0.6760 | 0.7257 | 372.8 | 650.1 | 0 |
| MIXED | hybrid-reranker | 0.5964 | 0.8179 | 0.8750 | 0.8786 | 0.7136 | 0.7553 | 673.4 | 929.4 | 0 |

## Frozen capability limits

- dense-only, hybrid, and hybrid + reranker are comparison-eligible; lexical-only remains unsupported by the product runtime.
- No partition triggered the frozen saturation warning: three-mode thresholds were not simultaneously reached.
- Aggregate quality values are arithmetic means of three repetitions; latency is pooled over measured query requests.
- Full per-query evidence is retained in `../runs/0185-repetition-*`; each repetition passed the 9-run report validator.
