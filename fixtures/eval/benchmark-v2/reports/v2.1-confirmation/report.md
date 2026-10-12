# Retrieval Benchmark v2.1 Final Confirmation

Post-0203 stability run over the immutable HOLDOUT; no tuning, relabeling, or winner selection was performed.

Runtime SHA: c54fac94784e860843608346d6638e41243ba799
Split: 208 HOLDOUT / 312 DEV (34b11d2ab26eb26086a88fc13685704e9ca46dbf93ad0eaf02ae7be9c37862b3)
Repetitions: 3
Models: qwen3-embedding-0.6b (1024d), qwen3-reranker-0.6b
Verdict: **PASS**

| Configuration | Role | Hit@10 drift | MRR drift | p50 drift | Failed | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| default-dense | selected-default | +0.00pp | -0.00pp | -8.4% | 0 | PASS |
| hybrid-legacy-control | required-control | +0.00pp | -0.00pp | -5.4% | 0 | PASS |
