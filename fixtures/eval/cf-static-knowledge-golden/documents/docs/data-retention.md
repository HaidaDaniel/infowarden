# Data Retention Policy

This policy defines how long platform data is kept and how deletion is
enforced.

## Retention periods

Workspace metadata and source revisions are retained indefinitely unless a
workspace is deleted. Indexed vectors for a deleted source revision are
removed at the next successful refresh, not immediately. Managed upload files
are retained for the lifetime of the source that references them.

## Deletion semantics

Deleting a source removes its serving content on the next refresh and marks
the revision as retired. Retired revisions remain queryable for audit until
the retention window closes, then are purged by the scheduled job. Purge is
idempotent: running it twice has no additional effect.

## Legal hold

A legal hold freezes purge for the affected workspace. While a hold is active,
refresh and rebuild still run, but the purge job skips held revisions.
Releasing a hold does not retroactively purge; the next scheduled purge
handles the newly eligible revisions.

## Memory entries

Durable memory entries follow the workspace lifetime. Archiving a memory
entry removes it from active retrieval but keeps it available to the operator
surface. Hard delete is operator-only and is not reversible.

## Audit

Every purge, hard delete, and hold change is recorded with the actor, the
timestamp, and the affected revision identifiers. Audit records are retained
for 7 years regardless of the underlying data's retention period.
