# Chapter 2: Lexical Retrieval

Lexical retrieval matches words. In the systems covered here it is
PostgreSQL full-text search: the indexed text is normalized into a
`tsvector`, the query is parsed with `plainto_tsquery` using the `simple`
configuration, and candidates are ranked with `ts_rank_cd`.

Lexical retrieval is strongest exactly where embeddings are weakest: exact
terms, identifiers, filenames, version strings, and error messages. A query
for a specific configuration key, an error code, or a filename is a lexical
query, and a system that relies only on dense retrieval will routinely miss
it or rank it low.

The lexical channel has two structural limits. First, it does not understand
paraphrase: "how do I back up the database" and "PostgreSQL dump schedule"
share few terms, so the lexical channel alone connects them poorly. Second,
rank is position-sensitive; a term that appears in a title outranks the same
term buried in a long section, which is usually desirable but occasionally
hides the real answer.

Because lexical candidates come from a relational store, they respect the
same active-revision filtering as everything else: a deleted source revision
is not lexically retrievable once it is no longer active.
