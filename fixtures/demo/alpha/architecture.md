# Architecture Notes

InfoWarden keeps external source truth separate from canonical PostgreSQL state
and from the rebuildable Qdrant serving index. A workspace is the isolation and
retrieval unit for a collection of relatively stable documents.
