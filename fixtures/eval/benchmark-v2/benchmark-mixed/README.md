# benchmark-v2-mixed

Bounded open-data mixed English/Russian retrieval benchmark-v2 partition.

- Mr. TyDi v1.1 EN/RU sources are pinned to revision `1d43c80218d06d0ef80f5b172ccabd848b948bc1` and sampled by the frozen per-bucket, order-independent SHA-256 rule with seed `infowarden-benchmark-v2-2026-10`. The bounded MIXED pack keeps the 0174 EN/RU bucket minima rather than taking an upstream-order prefix.
- LAReQA XQuAD-R is pinned to revision `9bc8c7fb6dd8d01d72a05a93c2cb96882b0d299c` and contributes hash-selected aligned blocks for EN→RU, RU→EN, and same-topic mixed-distractor diagnostics.
- Licenses: Apache-2.0 for Mr. TyDi and CC BY-SA 4.0 for LAReQA XQuAD-R.
- Opposite-language mixed distractors are unjudged diagnostics and are absent from qrels; they are not silently encoded as grade 0.
- Semantic buckets and hard-negative suitability are query-specific pre-result review proposals until task 0183 independently confirms them. Russian morphology rows require explicit query/positive-passage form contrasts; ordinary factual questions are not accepted as morphology evidence.

## Pre-execution semantic freeze

`semantic-review.jsonl` and `semantic-review-manifest.json` contain query-specific pre-run bucket and hard-negative review proposals. They intentionally are frozen after task `0183` passed; no retrieval quality result has been used.
