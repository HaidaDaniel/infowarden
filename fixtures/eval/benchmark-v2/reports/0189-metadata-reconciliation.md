# Benchmark v2 metadata reconciliation

Task 0189 reconciled frozen semantic-review and question metadata after the independent review of 0188. No model or retrieval calls were made.

- Semantic review rows now declare frozen independent review and passed status.
- Question metadata points to validation task 0183 and no longer advertises candidate/pending status.
- Historical 0186/0187 bindings use the corrected manifest, question, and semantic-review hashes.
- Canonical query-average order is explicitly: partition, mode order [dense, hybrid-reranker, hybrid], query_id ascending.
- Query text, expected IDs, qrels, primary buckets, and ranked result bytes were not changed.
