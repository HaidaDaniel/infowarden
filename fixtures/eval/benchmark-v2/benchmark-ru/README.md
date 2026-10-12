# benchmark-v2-ru

Bounded open-data retrieval benchmark-v2 RU partition.

## Provenance

- Upstream: Mr. TyDi v1.1, pinned to `1d43c80218d06d0ef80f5b172ccabd848b948bc1`.
- License: Apache-2.0; see the upstream [LICENSE](https://github.com/castorini/mr.tydi/blob/main/LICENSE).
- Source archive SHA-256: `3e71c50805576587aca2ec8aac4d800daaf772fd6f1eb0816082d6ff9c2d3c8d`.
- No upstream archive or private data is committed here.
- Reconstruct by downloading the URL in `manifest.json`, verifying the checksum, applying the frozen order-independent SHA-256 base selection rule with seed `infowarden-benchmark-v2-2026-10`, and adding the explicitly listed morphology candidates.

## Contents

- `manifest.json`: pinned source identity, selection rule, counts, and corpus inventory.
- `questions.jsonl`: selected queries with positive and explicit upstream-negative passage ids.
- `documents/shard-*.jsonl`: deterministic 64-shard corpus; `manifest.documents[].recordId` selects one JSONL record.
- `baseline.json`: contract validation floors only; it is not a quality result.
- `approved-regressions.json`: empty until an evidence-backed regression is reviewed.

## Scope

This partition is stable/warm knowledge retrieval evidence, not coding-agent productivity, repository search, answer generation, or an end-to-end agent benchmark. Mr. TyDi is monolingual; cross-language claims are intentionally deferred to the MIXED pack.

The upstream rows provide positive and negative passages, but do not annotate the 0174 query buckets. The current pack records a pre-result review proposal; task `0183` was independently confirmed the query-specific evidence before the labels are frozen.

The RU `morphology_inflection` slice is restricted to questions whose query form and positive passage/title contain an explicit grammatical-form contrast for the same lemma or referent. Ordinary factual questions are not accepted as morphology evidence.

## Pre-execution semantic freeze

`semantic-review.jsonl` and `semantic-review-manifest.json` contain query-specific pre-run bucket and hard-negative review proposals. They intentionally are frozen after task `0183` passed; no retrieval quality result has been used.
