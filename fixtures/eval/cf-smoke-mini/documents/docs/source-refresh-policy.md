# Source Refresh Policy

External folders, Git repositories, Obsidian vaults, uploads, and URL crawls are
source truth. Qdrant is only a rebuildable serving index.

Refresh policies decide how source truth becomes searchable:

- manual refresh is always allowed;
- disabled auto-refresh blocks webhook, schedule, and watch triggers;
- dry-run refresh reports added, changed, unchanged, and deleted paths;
- webhook refresh records trigger metadata when enabled.

The stable phrase `saffron-refresh-marker` proves source refresh facts can be
found by exact-term retrieval.

Stable external document id: `doc_source_refresh_policy`.
