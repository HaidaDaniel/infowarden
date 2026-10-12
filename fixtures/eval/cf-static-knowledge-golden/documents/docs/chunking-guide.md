# Chunking Guide

This guide records how documents are split into chunks for indexing and the
tuning levers that affect retrieval quality.

## Default strategy

Documents are split on structure first: headings define chunk boundaries, and
a heading's content stays with its section. When a section exceeds the size
cap, it is split on paragraph boundaries. The default target chunk size is
512 tokens with a 64-token overlap between neighbors.

## Why overlap matters

Overlap lets a concept that spans a boundary remain retrievable from both
sides. The trade-off is a higher duplicate rate: with too much overlap,
near-identical chunks compete for the same rank slots. A duplicate rate above
the baseline threshold usually means overlap or a chunk boundary problem, not
an index defect.

## Small documents

Documents shorter than the minimum chunk size are indexed as a single chunk.
This is why a short note can appear both as its own result and as a neighbor
expansion of a larger document.

## Structure-aware splitting

Markdown headings are the strongest boundary signal. Code files are split on
function and class boundaries when available, otherwise on the size cap.
HTML is split on block elements. A chunk that starts mid-sentence is a
boundary defect and should surface as a `chunk_boundary` failure, not be
accepted as normal output.

## Tuning order

When chunking quality is the problem, change one lever at a time and re-run
the evaluation pack: overlap first, then target size, then boundary
preference. Changing the embedding model at the same time as the chunking
configuration makes it impossible to attribute the result.
