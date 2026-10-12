# benchmark-v2-en

Bounded open-data retrieval benchmark-v2 EN partition.

## Provenance

- Upstream: Mr. TyDi v1.1, pinned to `1d43c80218d06d0ef80f5b172ccabd848b948bc1`.
- License: Apache-2.0; see the upstream [LICENSE](https://github.com/castorini/mr.tydi/blob/main/LICENSE).
- Source archive SHA-256: `5cd9dccd7bf65bfbb68ed67ef0785eef76702de622e237641ad34f4a9ab32392`.
- No upstream archive or private data is committed here.
- Reconstruct by downloading the URL in `manifest.json`, verifying the checksum, and applying the frozen order-independent SHA-256 selection rule with seed `infowarden-benchmark-v2-2026-10`.

## Contents

- `manifest.json`: pinned source identity, selection rule, counts, and corpus inventory.
- `questions.jsonl`: selected queries with positive and explicit upstream-negative passage ids.
- `documents/shard-*.jsonl`: deterministic 64-shard corpus; `manifest.documents[].recordId` selects one JSONL record.
- `baseline.json`: contract validation floors only; it is not a quality result.
- `approved-regressions.json`: empty until an evidence-backed regression is reviewed.

## Scope

This partition is stable/warm knowledge retrieval evidence, not coding-agent productivity, repository search, answer generation, or an end-to-end agent benchmark. Mr. TyDi is monolingual; cross-language claims are intentionally deferred to the MIXED pack.

The upstream rows provide positive and negative passages, but do not annotate the 0174 query buckets. Bucket coverage is a candidate inventory until 0183 reviews the selected queries and hard-negative suitability.

## Pre-execution semantic freeze

`semantic-review.jsonl` and `semantic-review-manifest.json` contain frozen pre-run bucket and hard-negative review metadata. The review was completed before any retrieval quality result; task `0183` is the semantic-freeze gate for later harness execution.
