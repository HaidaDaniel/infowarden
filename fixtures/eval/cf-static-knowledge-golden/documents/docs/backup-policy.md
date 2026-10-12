# Backup and Recovery Policy

This policy defines what is backed up, how often, and how recovery is proven.

## What is canonical

Canonical state is PostgreSQL plus the managed upload storage tree. Qdrant is
a serving/cache layer and is never the backup of record. External sources
(local folders, Obsidian vaults, Git repositories, URL policy) are source
truth owned elsewhere and are not captured by a platform backup.

## Schedule

PostgreSQL is dumped in custom format daily at 02:00 UTC. Managed uploads are
copied with checksums in the same window. Dumps are retained for 14 days
online and 90 days in cold storage. A backup is considered valid only if the
restore drill in the next section has passed within the last 30 days.

## Restore drill

Every 30 days a backup is restored into a fresh isolated environment: fresh
PostgreSQL, fresh upload root, fresh Qdrant. The drill reindexes restored
sources, verifies retrieval parity against pre-backup metrics, and confirms
memory and export state survive. A failed drill invalidates the backup
procedure until re-proven.

## Recovery of external sources

Because external sources are source truth, recovery also requires explicit
remap records for local/NAS folders, Obsidian vault paths, Git remotes, URL
policy, and provider secret references. Restoring the database alone does not
restore access to an external source.

## RPO and RTO targets

The target recovery point objective is 24 hours for PostgreSQL and uploads.
The target recovery time objective is 4 hours to a queryable state. Qdrant
re-materialization after a full loss is expected to take longer than the RTO
and is scheduled as a separate rebuild, not part of the initial restore.
