# Chapter 1: Embedding Fundamentals

An embedding is a fixed-length numeric vector that maps text into a space
where semantic similarity corresponds to geometric closeness. Most
production retrieval systems use cosine similarity over normalized vectors,
which makes the magnitude of the vector irrelevant and the direction carry
all the meaning.

The dimensionality of an embedding model is a hard compatibility constraint.
An index built with a 384-dimension model cannot be queried with a
1024-dimension model; the vectors live in different spaces. Changing the
model or its dimension therefore requires a full reindex, not a
configuration toggle. A deployment that hosts workspaces indexed with
different model/dimension pairs must keep a separate index per pair.

Small embedding models trade recall for speed and memory. A 384-dimension
model is a reasonable CPU baseline for English technical documentation; it is
not a claim of quality for every language or corpus. When a model is weak in
a language, lexical channels often carry the load, which is exactly the
situation hybrid retrieval was designed to cover.

Query and document text should be embedded with the same model and the same
preprocessing. Mixing a query-optimized model with a document-optimized model
on one side of the comparison silently degrades scores without any error.
