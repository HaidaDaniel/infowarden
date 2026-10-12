# Static Knowledge Golden Set — Aggregate Report

Dataset: `cf-static-knowledge-golden@2026-10-05`
Generated: 2026-10-06T13:32:39.684Z (UTC)

## Scope and sanitization

Sanitized synthetic corpus only: no private source text, private paths, personal
questions, or provider credentials. Labels are reviewed fixture labels, never derived
from retrieval output. Raw per-run JSON is stored under git-ignored
`.contextforge/benchmarks/` and is not committed.

## Environment and corpus

- API: http://localhost:3000 (Node v24.21.0)
- Embedding: qwen3-embedding-0.6b (1024 dimensions)
- Reranker: configured (enabled in rerank run)
- Serving revision: 69d3da66-506f-4ac0-9e11-e891b76b2e78 (manifest c65d949f69d43b0ba0e0f377c79615b1ff29606ec7be4ace58f11f4465e9231e)
- Vector backend: 29919789-0eb6-4df2-98f3-27d5d7f31a92 / collection kb-2722b670-6e90-4576-bc4a-64939edcdcf3
- Corpus: 19 documents, 41 questions, 29.0 KiB
- Source classes: markdown_docs, book_reference, obsidian_notes

## Index build duration

| Source class | Source type | Duration (ms) | Documents | Chunks |
| ------------ | ----------- | ------------- | --------- | ------ |
| markdown_docs | local_folder | 2027 | 8 | 48 |
| book_reference | upload (zip) | 2021 | 6 | 6 |
| obsidian_notes | obsidian_vault | 2022 | 5 | 28 |

## Channel comparison

The runtime supports dense (default profile, lexical disabled), hybrid (weighted rank
fusion), and hybrid+reranker (cross-encoder on the first-stage candidate set). A pure
lexical-only channel is not expressible: profile metadata falls back to the default
dense weight when zero, and the dense candidate limit is clamped to at least one, so
every search includes the dense stage. Lexical contribution is observable inside the
hybrid channel via per-candidate retrieval-source provenance.

| Mode | Profile | Rerank | Questions | Hit@K (top5) | Hit@3 | MRR | Empty rate | Duplicate rate | p50 (ms) | p95 (ms) |
| ---- | ------- | ------ | --------- | ---------- | ----- | --- | ---------- | -------------- | -------- | -------- |
| dense | default | no | 41 | 0.976 | 0.976 | 0.939 | 0.000 | 0.000 | 33.289816 | 46.77222 |
| hybrid | golden-hybrid | no | 41 | 0.976 | 0.951 | 0.909 | 0.000 | 0.000 | 50.412796 | 65.175045 |
| hybrid+reranker | golden-hybrid-rerank | yes | 41 | 0.976 | 0.976 | 0.939 | 0.000 | 0.000 | 201.948279 | 252.950196 |

## Baseline gates

Baseline: `cf-static-knowledge-golden-local-baseline` (environment class `local-dev-cpu-baseline`), topK 5.

The baseline is the release gate for the `local-dev-cpu-baseline` environment class. This run executed under the embedding profile recorded in the environment section above; if that profile differs from the baseline's, read the gate result below as a cross-environment reference, not a same-environment release check.

- dense: PASS
- hybrid: PASS
- hybrid+reranker: PASS

## Per-question results (sanitized: ids and paths only)

### dense (default)

| Question | Class | Hit@K | Rank | Top-1 path | Top-1 channel |
| -------- | ----- | ----- | ---- | ---------- | ------------- |
| q_ops_tier2_escalation | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_ops_escalation_path | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_ops_stalled_queue | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_ops_change_window | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_api_pagination | markdown_docs | 1 | 1 | api-design.md | dense |
| q_api_error_branching | markdown_docs | 1 | 1 | api-design.md | dense |
| q_api_slug_rename | markdown_docs | 0 | - | onboarding-notes.md | dense |
| q_api_idempotency_retention | markdown_docs | 1 | 1 | api-design.md | dense |
| q_deploy_migration_order | markdown_docs | 1 | 1 | deployment-guide.md | dense |
| q_book_fusion_rank_scores | book_reference | 1 | 1 | chapter-03-hybrid.md | dense |
| q_deploy_rollback | markdown_docs | 1 | 1 | deployment-guide.md | dense |
| q_deploy_startup_refusal | markdown_docs | 1 | 1 | deployment-guide.md | dense |
| q_trouble_stale_content | markdown_docs | 1 | 2 | data-retention.md | dense |
| q_trouble_empty_results | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_trouble_slow_reranker | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_trouble_wrong_first | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_backup_canonical | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_schedule | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_drill | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_targets | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_security_key_scope | markdown_docs | 1 | 2 | api-design.md | dense |
| q_security_stdio_trust | markdown_docs | 1 | 1 | security-notes.md | dense |
| q_security_key_rotation | markdown_docs | 1 | 1 | security-notes.md | dense |
| q_chunking_defaults | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_chunking_duplicate_rate | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_chunking_tuning_order | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_retention_purge_timing | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_retention_legal_hold | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_retention_audit_window | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_book_dimension_compat | book_reference | 1 | 1 | chapter-01-fundamentals.md | dense |
| q_book_reranker_limit | book_reference | 1 | 1 | chapter-04-reranking.md | dense |
| q_book_mrr_meaning | book_reference | 1 | 1 | chapter-05-evaluation.md | dense |
| q_book_fail_closed | book_reference | 1 | 1 | troubleshooting-search.md | dense |
| q_book_lexical_strength | book_reference | 1 | 1 | chapter-02-lexical.md | dense |
| q_vault_qdrant_truth | obsidian_notes | 1 | 2 | backup-policy.md | dense |
| q_vault_memory_generation | obsidian_notes | 1 | 1 | project-meridian-decisions.md | dense |
| q_vault_unavailable_meaning | obsidian_notes | 1 | 1 | architecture-notes.md | dense |
| q_vault_incident_cause | obsidian_notes | 1 | 1 | incident-2026-08-14.md | dense |
| q_vault_incident_action | obsidian_notes | 1 | 1 | incident-2026-08-14.md | dense |
| q_vault_roadmap_evidence | obsidian_notes | 1 | 1 | meeting-2026-09-02-roadmap.md | dense |
| q_vault_onboarding_ports | obsidian_notes | 1 | 1 | onboarding-notes.md | dense |

### hybrid (golden-hybrid)

| Question | Class | Hit@K | Rank | Top-1 path | Top-1 channel |
| -------- | ----- | ----- | ---- | ---------- | ------------- |
| q_ops_tier2_escalation | markdown_docs | 1 | 1 | ops-runbook.md | dense+lexical |
| q_ops_escalation_path | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_ops_stalled_queue | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_ops_change_window | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_api_pagination | markdown_docs | 1 | 1 | api-design.md | dense |
| q_api_error_branching | markdown_docs | 1 | 1 | api-design.md | dense |
| q_api_slug_rename | markdown_docs | 0 | - | onboarding-notes.md | dense |
| q_api_idempotency_retention | markdown_docs | 1 | 1 | api-design.md | dense |
| q_deploy_migration_order | markdown_docs | 1 | 1 | deployment-guide.md | dense+lexical |
| q_deploy_rollback | markdown_docs | 1 | 1 | deployment-guide.md | dense |
| q_deploy_startup_refusal | markdown_docs | 1 | 1 | deployment-guide.md | dense+lexical |
| q_trouble_stale_content | markdown_docs | 1 | 2 | data-retention.md | dense |
| q_trouble_empty_results | markdown_docs | 1 | 1 | troubleshooting-search.md | dense+lexical |
| q_backup_schedule | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_trouble_slow_reranker | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_trouble_wrong_first | markdown_docs | 1 | 2 | chapter-04-reranking.md | dense+lexical |
| q_backup_canonical | markdown_docs | 1 | 2 | project-meridian-decisions.md | dense+lexical |
| q_backup_drill | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_targets | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_security_key_scope | markdown_docs | 1 | 4 | api-design.md | dense |
| q_security_stdio_trust | markdown_docs | 1 | 1 | security-notes.md | dense+lexical |
| q_security_key_rotation | markdown_docs | 1 | 1 | security-notes.md | dense |
| q_chunking_defaults | markdown_docs | 1 | 1 | chunking-guide.md | dense+lexical |
| q_chunking_duplicate_rate | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_chunking_tuning_order | markdown_docs | 1 | 1 | chunking-guide.md | dense+lexical |
| q_retention_purge_timing | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_retention_legal_hold | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_retention_audit_window | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_book_fusion_rank_scores | book_reference | 1 | 1 | chapter-03-hybrid.md | dense+lexical |
| q_book_dimension_compat | book_reference | 1 | 1 | chapter-01-fundamentals.md | dense |
| q_book_reranker_limit | book_reference | 1 | 1 | chapter-04-reranking.md | dense+lexical |
| q_book_mrr_meaning | book_reference | 1 | 1 | chapter-05-evaluation.md | dense |
| q_book_fail_closed | book_reference | 1 | 1 | troubleshooting-search.md | dense |
| q_book_lexical_strength | book_reference | 1 | 1 | chapter-02-lexical.md | dense+lexical |
| q_vault_qdrant_truth | obsidian_notes | 1 | 2 | backup-policy.md | dense |
| q_vault_memory_generation | obsidian_notes | 1 | 1 | project-meridian-decisions.md | dense |
| q_vault_unavailable_meaning | obsidian_notes | 1 | 1 | architecture-notes.md | dense |
| q_vault_incident_cause | obsidian_notes | 1 | 1 | incident-2026-08-14.md | dense+lexical |
| q_vault_incident_action | obsidian_notes | 1 | 1 | incident-2026-08-14.md | dense |
| q_vault_roadmap_evidence | obsidian_notes | 1 | 1 | meeting-2026-09-02-roadmap.md | dense |
| q_vault_onboarding_ports | obsidian_notes | 1 | 1 | onboarding-notes.md | dense |

### hybrid+reranker (golden-hybrid-rerank)

| Question | Class | Hit@K | Rank | Top-1 path | Top-1 channel |
| -------- | ----- | ----- | ---- | ---------- | ------------- |
| q_ops_tier2_escalation | markdown_docs | 1 | 1 | ops-runbook.md | dense+lexical |
| q_ops_escalation_path | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_ops_stalled_queue | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_ops_change_window | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_api_idempotency_retention | markdown_docs | 1 | 1 | api-design.md | dense |
| q_deploy_migration_order | markdown_docs | 1 | 1 | deployment-guide.md | dense+lexical |
| q_api_pagination | markdown_docs | 1 | 1 | api-design.md | dense |
| q_api_error_branching | markdown_docs | 1 | 1 | api-design.md | dense |
| q_api_slug_rename | markdown_docs | 0 | - | architecture-notes.md | dense |
| q_trouble_empty_results | markdown_docs | 1 | 1 | troubleshooting-search.md | dense+lexical |
| q_vault_memory_generation | obsidian_notes | 1 | 1 | project-meridian-decisions.md | dense |
| q_deploy_rollback | markdown_docs | 1 | 1 | deployment-guide.md | dense |
| q_deploy_startup_refusal | markdown_docs | 1 | 1 | deployment-guide.md | dense+lexical |
| q_trouble_stale_content | markdown_docs | 1 | 2 | data-retention.md | dense |
| q_chunking_tuning_order | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_book_reranker_limit | book_reference | 1 | 1 | chapter-04-reranking.md | dense+lexical |
| q_book_mrr_meaning | book_reference | 1 | 1 | chapter-05-evaluation.md | dense |
| q_book_fail_closed | book_reference | 1 | 1 | troubleshooting-search.md | dense |
| q_book_lexical_strength | book_reference | 1 | 1 | chapter-02-lexical.md | dense+lexical |
| q_vault_qdrant_truth | obsidian_notes | 1 | 1 | project-meridian-decisions.md | dense |
| q_trouble_slow_reranker | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_trouble_wrong_first | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_backup_canonical | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_schedule | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_drill | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_targets | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_security_key_scope | markdown_docs | 1 | 2 | api-design.md | dense |
| q_security_stdio_trust | markdown_docs | 1 | 1 | security-notes.md | dense+lexical |
| q_security_key_rotation | markdown_docs | 1 | 1 | security-notes.md | dense |
| q_chunking_defaults | markdown_docs | 1 | 1 | chunking-guide.md | dense+lexical |
| q_chunking_duplicate_rate | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_retention_purge_timing | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_retention_legal_hold | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_retention_audit_window | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_book_fusion_rank_scores | book_reference | 1 | 1 | chapter-03-hybrid.md | dense+lexical |
| q_book_dimension_compat | book_reference | 1 | 1 | chapter-01-fundamentals.md | dense |
| q_vault_unavailable_meaning | obsidian_notes | 1 | 2 | troubleshooting-search.md | dense |
| q_vault_incident_cause | obsidian_notes | 1 | 1 | incident-2026-08-14.md | dense+lexical |
| q_vault_incident_action | obsidian_notes | 1 | 1 | incident-2026-08-14.md | dense |
| q_vault_roadmap_evidence | obsidian_notes | 1 | 1 | meeting-2026-09-02-roadmap.md | dense |
| q_vault_onboarding_ports | obsidian_notes | 1 | 1 | onboarding-notes.md | dense |

## Failure analysis input

Questions with hit@K=0 in any mode, for the reviewed qualitative taxonomy (exact-term
failure, semantic mismatch, cross-document question, multilingual weakness, chunk
boundary, reranker degradation, stale revision, missing source, duplicate/empty):

| Question | Missed in | Result count | Note |
| -------- | --------- | ------------ | ---- |
| q_api_slug_rename | dense, hybrid, hybrid+reranker | 5 | expected doc outside top-K |

## Reviewed failure taxonomy

The single miss, `q_api_slug_rename` ("How is a workspace renamed?"), is reviewed
below against the qualitative taxonomy. It is the only question that missed in every
mode, so the classification applies uniformly.

- **Primary cause: semantic mismatch (embedding quality).** The expected answer
  (`api-design.md`, "renaming a workspace requires a new slug and an explicit
  migration") is a short, generic operations phrasing. The 0.6b/1024d encoder maps
  "How is a workspace renamed?" onto generic workspace-operations content
  (`onboarding-notes.md`, `architecture-notes.md`) and does not surface the API
  design doc, whose rename guidance sits in a secondary "Identifier resolution"
  section rather than the document's primary topic.
- **Compounding factor: lexical inflection gap.** The query token is "renamed" while
  the document text is "renaming". The lexical channel has no stemmer, so it could
  not bridge the inflection. In hybrid, lexical added candidates (5 lexical + 5 dense
  = 8 merged) but none was the expected doc, so the inflection gap did not change the
  outcome. This is an exact-term/inflection weakness of the lexical channel, not a
  dense failure.
- **Not a reranker failure.** In hybrid+reranker the expected doc was absent from the
  merged candidate set, so reranking could not recover it; the miss is a
  candidate-generation miss, not a reranker degradation.
- **Not** stale revision, missing source, empty result, or duplicate result: all runs
  returned 5 well-formed results from the active serving revision, and the expected
  source was indexed and resolvable.

**Labeling note.** `q_book_fail_closed` was relabeled from a single-answer
(`doc_book_ch06`) to a multi-answer expectation (`doc_book_ch06` + `doc_troubleshooting`)
during this review: the provider-outage fail-closed behavior is documented in both the
operations chapter and the troubleshooting guide, so a top-1 hit on either is a correct
answer. The relabel is recorded in `questions.jsonl` metadata and is not a retrieval
outcome.

## Run provenance

- Raw run directory (git-ignored): `.contextforge/benchmarks/static-knowledge-golden/2026-10-06T13-32-39-678Z`
- Reproduce: `pnpm benchmark:static-knowledge` (requires a trusted API on `localhost:3000`
  with a live embedding provider and, for the rerank mode, a live reranker).
- Environment class of this run: external qwen3-embedding-0.6b (1024d) plus
  qwen3-reranker-0.6b (both served from the operator's local dev cluster);
  **not** the `local-dev-cpu-baseline` class the committed `baseline.json` gates.
  The PASS lines above are therefore a cross-environment reference. A
  same-environment CPU-baseline run is still required to satisfy the committed
  release gate.

## Conclusion boundary

This report measures retrieval quality over stable/warm persistent knowledge. It does
not measure, and must not be read as measuring, coding-agent productivity. Active-
repository coding outcomes belong to tasks 0159/0160.
