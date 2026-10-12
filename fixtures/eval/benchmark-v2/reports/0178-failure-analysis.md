# Retrieval Benchmark v2 Failure Analysis and Saturation Review

Task `0178`; source execution task `0185`; representative quality repetition `1` with repetitions `2` and `3` cross-checked for identical query-level outcomes.

## Evidence boundary

The analysis uses the authoritative retrieval-trace reports only. It records stable query IDs and document paths/IDs, never source text. No labels, qrels, manifests, runtime code, or benchmark results were changed. The old golden set is untouched.

Runtime: `qwen3-embedding-0.6b` embedding, `qwen3-reranker-0.6b` reranker, dimension `1024`, provider `local-qwen-0.6b`, runtime SHA `e1a01e33d6e7c8d65cb9530ce890887b2233d3d8`.

## Failure taxonomy

Classification is deterministic and conservative: reranker regressions take precedence when hybrid retrieves a relevant document and hybrid+rereanker does not; otherwise the frozen semantic bucket maps to the corresponding category. Categories without an explicit trace signal are not guessed.

| Category | EN | RU | MIXED |
| --- | ---: | ---: | ---: |
| exact-term miss | 0 | 6 | 9 |
| semantic miss | 0 | 0 | 0 |
| hard-negative confusion | 18 | 24 | 47 |
| entity/identifier confusion | 3 | 9 | 12 |
| Russian morphology/inflection | 0 | 9 | 9 |
| cross-language miss | 0 | 0 | 27 |
| chunk-boundary issue | 0 | 0 | 0 |
| candidate-generation miss | 0 | 0 | 0 |
| reranker regression | 1 | 0 | 0 |
| duplicate result | 0 | 0 | 0 |
| empty result | 0 | 0 | 0 |
| dataset/qrel ambiguity | 0 | 0 | 0 |

Observed duplicate result, empty result, and failed query counts are zero in every partition/mode. No chunk-boundary issue, direct candidate-generation diagnostic, or dataset/qrel ambiguity was observed in the committed traces; these remain limitations of post-hoc trace classification, not evidence that such failures are impossible.

## Partition/mode breakdown

| Partition | Mode | Queries | Misses | Failed | Empty | Duplicates |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| EN | dense | 120 | 7 | 0 | 0 | 0 |
| EN | hybrid | 120 | 7 | 0 | 0 | 0 |
| EN | hybrid-reranker | 120 | 8 | 0 | 0 | 0 |
| RU | dense | 120 | 16 | 0 | 0 | 0 |
| RU | hybrid | 120 | 16 | 0 | 0 | 0 |
| RU | hybrid-reranker | 120 | 16 | 0 | 0 | 0 |
| MIXED | dense | 280 | 35 | 0 | 0 | 0 |
| MIXED | hybrid | 280 | 35 | 0 | 0 | 0 |
| MIXED | hybrid-reranker | 280 | 34 | 0 | 0 | 0 |

## Representative stable IDs

Only IDs are shown; no unreviewed query/document text is copied.

### EN
- hard-negative confusion: `mrtydi_en_q_2569`, `mrtydi_en_q_541`, `mrtydi_en_q_3562`
- entity/identifier confusion: `mrtydi_en_q_3707`
- reranker regression: `mrtydi_en_q_1210`
### RU
- exact-term miss: `mrtydi_ru_q_557`, `mrtydi_ru_q_2652`
- hard-negative confusion: `mrtydi_ru_q_5609`, `mrtydi_ru_q_3612`, `mrtydi_ru_q_1486`
- entity/identifier confusion: `mrtydi_ru_q_1496`, `mrtydi_ru_q_5645`, `mrtydi_ru_q_1394`
- Russian morphology/inflection: `mrtydi_ru_q_90`, `mrtydi_ru_q_127`, `mrtydi_ru_q_141`
### MIXED
- exact-term miss: `mixed_mrtydi_ru_q_557`, `mixed_mrtydi_ru_q_2652`, `mixed_mrtydi_ru_q_484`
- hard-negative confusion: `mixed_mrtydi_en_q_3562`, `mixed_mrtydi_en_q_1210`, `mixed_mrtydi_en_q_2569`, `mixed_mrtydi_en_q_1120`
- entity/identifier confusion: `mixed_mrtydi_en_q_3707`, `mixed_mrtydi_ru_q_1496`, `mixed_mrtydi_ru_q_5645`
- Russian morphology/inflection: `mixed_mrtydi_ru_q_90`, `mixed_mrtydi_ru_q_127`, `mixed_mrtydi_ru_q_141`
- cross-language miss: `xquad_cross_language_ru_to_en_571c8539dd7acb1400e4c0e6`, `xquad_cross_language_en_to_ru_57339c16d058e614000b5ec5`, `xquad_cross_language_ru_to_en_57339c16d058e614000b5ec5`

## Quality and uncertainty

The three-run arithmetic means and pooled latency are unchanged from the execution aggregate. Paired bootstrap used the frozen 10,000-resample protocol. Meaningful differences require the frozen MRR/Hit@5 delta and an interval excluding zero.

| Partition | Comparison evidence | Interpretation |
| --- | --- | --- |
| EN | dense vs hybrid MRR delta `0.0203`, CI `[0.0053, 0.0383]`; dense vs reranker Hit@5 delta `0.0333`, CI `[0.0083, 0.0667]` | Modes are distinguishable; hybrid is slower without a quality gain, reranker changes rank/latency trade-off. |
| RU | reranker MRR deltas are about `0.037`, but CI upper bounds cross zero; Hit@5 is tied | No frozen meaningful winner; language partition remains informative but noisy. |
| MIXED | Reranker-minus-dense MRR delta `+0.0267`, CI `[+0.0016, +0.0521]`; reranker-minus-hybrid `+0.0376`, CI `[+0.0112, +0.0640]` | Reranker produces a meaningful MRR difference; modes are distinguishable. |

## Saturation decision

Frozen thresholds: at least three supported modes simultaneously reaching Hit@10 >= 0.98, Hit@3 >= 0.95, and MRR >= 0.95. No partition triggered the warning. All three supported modes were evaluated; lexical-only remains explicitly unsupported by the product runtime.

**Benchmark difficulty: PASS.** The benchmark is not trivially saturated and differentiates mode behavior, while preserving a meaningful RU uncertainty limitation. No corrective dataset or harness task is required by this analysis.

## Final analysis verdict

`PASS`: benchmark-v2 supplies discriminative comparative retrieval evidence with documented failure taxonomy, uncertainty, and latency trade-offs. This is not a general SOTA claim and does not authorize publication; task `0179` remains the release evidence gate.
