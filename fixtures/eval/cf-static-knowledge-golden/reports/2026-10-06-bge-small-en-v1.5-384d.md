# Static Knowledge Golden Set — Aggregate Report (local-dev-cpu-baseline)

Dataset: `cf-static-knowledge-golden@2026-10-05`
Generated: 2026-10-06T14:14:26.288Z (UTC)

## Scope and sanitization

Sanitized synthetic corpus only: no private source text, private paths, personal
questions, or provider credentials. Labels are reviewed fixture labels, never
derived from retrieval output. Raw per-run JSON is stored under git-ignored
`.contextforge/benchmarks/` and is not committed.

## Environment and corpus

- Environment class: `local-dev-cpu-baseline` (same environment as the committed `baseline.json` gates)
- API: http://localhost:3100 (Node v24.21.0)
- Embedding: BAAI/bge-small-en-v1.5 (384 dimensions), local CPU text-embeddings-inference
- Reranker: cross-encoder/ms-marco-MiniLM-L6-v2, local CPU (enabled in rerank run)
- Serving revision: d9b29be0-cf84-4dc9-84ae-44f3c4bb0487 (manifest 019819cfe342ea33680dc3f707da7592cd5118c335fbb0cfaeb5a1e7095cdfe8)
- Vector backend: 29919789-0eb6-4df2-98f3-27d5d7f31a92 / collection kb-b5302d53-bb86-4b2f-9053-d5b6e1508379
- Corpus: 19 documents, 41 questions, 29.0 KiB
- Source classes: markdown_docs, book_reference, obsidian_notes

The benchmark ran against a dedicated API instance started with the local CPU
provider overrides (local embeddings plus local CPU reranker registered as the
only active defaults). No external provider host was contacted by this run.

## Index build duration

| Source class | Source type | Duration (ms) | Documents | Chunks |
| ------------ | ----------- | ------------- | --------- | ------ |
| markdown_docs | local_folder | 6052 | 8 | 48 |
| book_reference | upload (zip) | 2017 | 6 | 6 |
| obsidian_notes | obsidian_vault | 4034 | 5 | 28 |

## Channel comparison

The runtime supports dense (default profile, lexical disabled), hybrid (weighted
rank fusion), and hybrid+reranker (cross-encoder on the first-stage candidate
set). A pure lexical-only channel is not expressible: profile metadata falls
back to the default dense weight when zero, and the dense candidate limit is
clamped to at least one, so every search includes the dense stage. Lexical
contribution is observable inside the hybrid channel via per-candidate
retrieval-source provenance.

| Mode | Profile | Rerank | Questions | Hit@K (top5) | Hit@3 | MRR | Empty rate | Duplicate rate | p50 (ms) | p95 (ms) |
| ---- | ------- | ------ | --------- | ---------- | ----- | --- | ---------- | -------------- | -------- | -------- |
| dense | default | no | 41 | 1.000 | 1.000 | 0.951 | 0.000 | 0.000 | 50.260896 | 78.931894 |
| hybrid | golden-hybrid | no | 41 | 1.000 | 1.000 | 0.915 | 0.000 | 0.000 | 58.14377 | 85.281582 |
| hybrid+reranker | golden-hybrid-rerank | yes | 41 | 1.000 | 1.000 | 0.959 | 0.000 | 0.000 | 568.4376 | 1309.585417 |

## Baseline gates

Baseline: `cf-static-knowledge-golden-local-baseline` (environment class
`local-dev-cpu-baseline`), topK 5.

This run executed inside the `local-dev-cpu-baseline` environment class the
gates belong to (CPU embedding baseline BAAI/bge-small-en-v1.5, 384d, plus
local CPU reranker), so the gate result below is the same-environment release
check, not a cross-environment reference.

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
| q_deploy_startup_refusal | markdown_docs | 1 | 2 | onboarding-notes.md | dense |
| q_trouble_stale_content | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_backup_drill | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_targets | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_api_slug_rename | markdown_docs | 1 | 2 | architecture-notes.md | dense |
| q_api_idempotency_retention | markdown_docs | 1 | 1 | api-design.md | dense |
| q_deploy_migration_order | markdown_docs | 1 | 1 | deployment-guide.md | dense |
| q_deploy_rollback | markdown_docs | 1 | 1 | deployment-guide.md | dense |
| q_trouble_empty_results | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_trouble_slow_reranker | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_trouble_wrong_first | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_backup_canonical | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_schedule | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_retention_purge_timing | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_security_key_scope | markdown_docs | 1 | 2 | api-design.md | dense |
| q_security_stdio_trust | markdown_docs | 1 | 1 | security-notes.md | dense |
| q_security_key_rotation | markdown_docs | 1 | 1 | security-notes.md | dense |
| q_chunking_defaults | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_chunking_duplicate_rate | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_chunking_tuning_order | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_retention_legal_hold | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_retention_audit_window | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_book_fusion_rank_scores | book_reference | 1 | 1 | chapter-03-hybrid.md | dense |
| q_book_dimension_compat | book_reference | 1 | 2 | chunking-guide.md | dense |
| q_book_reranker_limit | book_reference | 1 | 1 | chapter-04-reranking.md | dense |
| q_book_mrr_meaning | book_reference | 1 | 1 | chapter-05-evaluation.md | dense |
| q_book_fail_closed | book_reference | 1 | 1 | troubleshooting-search.md | dense |
| q_book_lexical_strength | book_reference | 1 | 1 | chapter-02-lexical.md | dense |
| q_vault_qdrant_truth | obsidian_notes | 1 | 1 | project-meridian-decisions.md | dense |
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
| q_security_key_rotation | markdown_docs | 1 | 1 | security-notes.md | dense |
| q_chunking_defaults | markdown_docs | 1 | 1 | chunking-guide.md | dense+lexical |
| q_chunking_duplicate_rate | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_api_error_branching | markdown_docs | 1 | 1 | api-design.md | dense |
| q_api_slug_rename | markdown_docs | 1 | 3 | architecture-notes.md | dense |
| q_api_idempotency_retention | markdown_docs | 1 | 1 | api-design.md | dense |
| q_deploy_migration_order | markdown_docs | 1 | 1 | deployment-guide.md | dense+lexical |
| q_deploy_rollback | markdown_docs | 1 | 1 | deployment-guide.md | dense |
| q_deploy_startup_refusal | markdown_docs | 1 | 2 | onboarding-notes.md | dense |
| q_trouble_stale_content | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_trouble_empty_results | markdown_docs | 1 | 1 | troubleshooting-search.md | dense+lexical |
| q_trouble_slow_reranker | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_trouble_wrong_first | markdown_docs | 1 | 2 | chapter-04-reranking.md | dense+lexical |
| q_backup_canonical | markdown_docs | 1 | 2 | project-meridian-decisions.md | dense+lexical |
| q_backup_schedule | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_drill | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_targets | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_security_key_scope | markdown_docs | 1 | 3 | api-design.md | dense |
| q_security_stdio_trust | markdown_docs | 1 | 1 | security-notes.md | dense+lexical |
| q_retention_legal_hold | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_chunking_tuning_order | markdown_docs | 1 | 1 | chunking-guide.md | dense+lexical |
| q_retention_purge_timing | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_retention_audit_window | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_book_fusion_rank_scores | book_reference | 1 | 1 | chapter-03-hybrid.md | dense+lexical |
| q_book_dimension_compat | book_reference | 1 | 3 | chunking-guide.md | dense |
| q_book_reranker_limit | book_reference | 1 | 1 | chapter-04-reranking.md | dense+lexical |
| q_book_mrr_meaning | book_reference | 1 | 1 | chapter-05-evaluation.md | dense |
| q_book_fail_closed | book_reference | 1 | 1 | troubleshooting-search.md | dense |
| q_book_lexical_strength | book_reference | 1 | 1 | chapter-02-lexical.md | dense+lexical |
| q_vault_qdrant_truth | obsidian_notes | 1 | 1 | project-meridian-decisions.md | dense |
| q_vault_memory_generation | obsidian_notes | 1 | 1 | project-meridian-decisions.md | dense |
| q_vault_unavailable_meaning | obsidian_notes | 1 | 1 | architecture-notes.md | dense |
| q_vault_incident_cause | obsidian_notes | 1 | 1 | incident-2026-08-14.md | dense+lexical |
| q_vault_incident_action | obsidian_notes | 1 | 1 | incident-2026-08-14.md | dense |
| q_vault_roadmap_evidence | obsidian_notes | 1 | 1 | meeting-2026-09-02-roadmap.md | dense |
| q_vault_onboarding_ports | obsidian_notes | 1 | 1 | onboarding-notes.md | dense |

### hybrid+reranker (golden-hybrid-rerank)

| Question | Class | Hit@K | Rank | Top-1 path | Top-1 channel |
| -------- | ----- | ----- | ---- | ---------- | ------------- |
| q_backup_drill | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_ops_tier2_escalation | markdown_docs | 1 | 1 | ops-runbook.md | dense+lexical |
| q_ops_escalation_path | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_ops_stalled_queue | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_api_idempotency_retention | markdown_docs | 1 | 1 | api-design.md | dense |
| q_deploy_migration_order | markdown_docs | 1 | 1 | deployment-guide.md | dense+lexical |
| q_deploy_rollback | markdown_docs | 1 | 1 | deployment-guide.md | dense |
| q_trouble_stale_content | markdown_docs | 1 | 3 | data-retention.md | dense |
| q_trouble_empty_results | markdown_docs | 1 | 1 | troubleshooting-search.md | dense+lexical |
| q_security_stdio_trust | markdown_docs | 1 | 1 | security-notes.md | dense+lexical |
| q_retention_purge_timing | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_retention_legal_hold | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_ops_change_window | markdown_docs | 1 | 1 | ops-runbook.md | dense |
| q_api_pagination | markdown_docs | 1 | 1 | api-design.md | dense |
| q_api_error_branching | markdown_docs | 1 | 1 | api-design.md | dense |
| q_api_slug_rename | markdown_docs | 1 | 1 | api-design.md | dense |
| q_deploy_startup_refusal | markdown_docs | 1 | 1 | deployment-guide.md | lexical |
| q_trouble_slow_reranker | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_trouble_wrong_first | markdown_docs | 1 | 1 | troubleshooting-search.md | dense |
| q_backup_canonical | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_schedule | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_backup_targets | markdown_docs | 1 | 1 | backup-policy.md | dense |
| q_security_key_scope | markdown_docs | 1 | 2 | api-design.md | dense |
| q_security_key_rotation | markdown_docs | 1 | 1 | security-notes.md | dense |
| q_chunking_defaults | markdown_docs | 1 | 1 | chunking-guide.md | dense+lexical |
| q_chunking_duplicate_rate | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_chunking_tuning_order | markdown_docs | 1 | 1 | chunking-guide.md | dense |
| q_book_dimension_compat | book_reference | 1 | 1 | chapter-01-fundamentals.md | dense |
| q_book_reranker_limit | book_reference | 1 | 1 | chapter-04-reranking.md | dense+lexical |
| q_book_mrr_meaning | book_reference | 1 | 1 | chapter-05-evaluation.md | dense |
| q_retention_audit_window | markdown_docs | 1 | 1 | data-retention.md | dense |
| q_book_fusion_rank_scores | book_reference | 1 | 1 | chapter-03-hybrid.md | dense+lexical |
| q_book_lexical_strength | book_reference | 1 | 1 | chapter-02-lexical.md | dense+lexical |
| q_vault_qdrant_truth | obsidian_notes | 1 | 1 | project-meridian-decisions.md | dense |
| q_vault_memory_generation | obsidian_notes | 1 | 1 | project-meridian-decisions.md | dense |
| q_book_fail_closed | book_reference | 1 | 1 | troubleshooting-search.md | dense |
| q_vault_unavailable_meaning | obsidian_notes | 1 | 2 | troubleshooting-search.md | dense |
| q_vault_incident_cause | obsidian_notes | 1 | 1 | incident-2026-08-14.md | dense+lexical |
| q_vault_incident_action | obsidian_notes | 1 | 1 | incident-2026-08-14.md | dense |
| q_vault_roadmap_evidence | obsidian_notes | 1 | 1 | meeting-2026-09-02-roadmap.md | dense |
| q_vault_onboarding_ports | obsidian_notes | 1 | 1 | onboarding-notes.md | dense |

## Failure analysis input

Questions with hit@K=0 in any mode, for the reviewed qualitative taxonomy
(exact-term failure, semantic mismatch, cross-document question, multilingual
weakness, chunk boundary, reranker degradation, stale revision, missing source,
duplicate/empty):

None — all 41 questions hit in all three modes in this environment.

## Reviewed failure taxonomy

No question missed in this run, so no failure category is observed in this
environment. Two reviewed observations are recorded for the cross-environment
record:

- **Provider-dependent semantic mismatch (observed, not a failure here).**
  `q_api_slug_rename` ("How is a workspace renamed?") missed in all three modes
  under the external `qwen3-embedding-0.6b`/1024d run (see the 2026-10-06
  cross-environment report) but hits in all three modes here (dense rank 2,
  hybrid rank 3, hybrid+reranker rank 1). The miss is therefore a
  candidate-generation miss of the smaller external encoder on a short generic
  query, compounded by the lexical inflection gap ("renamed" vs "renaming", no
  stemmer) — not a reranker failure in either environment. It remains the
  observed static-retrieval evidence that a follow-up task (`0157`, or deferred
  `0096` if lexical normalization is chosen) must cite; this task neither fixes
  it nor changes any threshold because of it.
- **Reranker effect (observed).** The local CPU reranker did not degrade any
  result: Hit@K stays 1.000 and MRR improves from 0.915 (hybrid) to 0.959
  (hybrid+reranker), at the expected CPU latency cost (p95 85.3 ms to
  1309.6 ms, within the 12000 ms gate).

No speculative feature idea is presented as an observed failure.

## Run provenance

- Raw run directory (git-ignored): `.contextforge/benchmarks/static-knowledge-golden/local-dev-cpu-baseline-2026-10-06`
- Reproduce: `pnpm benchmark:static-knowledge -- --api-url <local-dev-cpu-baseline API>`
  against a trusted API whose active defaults are the local CPU embedding
  (BAAI/bge-small-en-v1.5, 384d) and local CPU reranker
  (cross-encoder/ms-marco-MiniLM-L6-v2), with the `local-dev-cpu-baseline`
  provider overrides active for the run.
- Environment class of this run: `local-dev-cpu-baseline` — the same class the
  committed `baseline.json` gates, so the PASS lines are the same-environment
  release check for that class. The external qwen3-embedding-0.6b (1024d) run
  remains the cross-environment reference.

## Conclusion boundary

This report measures retrieval quality over stable/warm persistent knowledge. It
does not measure, and must not be read as measuring, coding-agent productivity.
Active-repository coding outcomes belong to tasks 0159/0160.
