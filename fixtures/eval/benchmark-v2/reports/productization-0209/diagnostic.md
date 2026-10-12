# 0209 Lexical Reranker Diagnostic

## Decision

`lexical + reranker` is unsupported for v0.1. The frozen HOLDOUT evidence is
too harmful to expose as a normal built-in combination: Hit@10 was 8.2%, MRR
was 0.0599, candidate recall was about 79.8%, with 143 regressions and only
12 promotions.

## Investigation

The investigation inspected representative EN, RU, and MIXED failing rows and
compared the BM25 candidate payload with the dense+rereanker path. It verified
query/document order, candidate IDs, text extraction, provider response index
mapping, descending score ordering, topN=10, truncation, metadata handling,
and duplicate identity handling. A direct Qwen3-Reranker-0.6B request and 15
concurrent API traces completed successfully; the current provider did not
reproduce the historical catastrophic ordering on these targeted cases.

This does not erase the frozen evidence or prove a stable model guarantee. No
deterministic application integration defect was established, and no model,
prompt, parameter, or benchmark tuning was attempted. The safe v0.1 decision
is therefore to fail closed for lexical+rereanker while keeping dense and
hybrid reranking available and preserving the advanced profile identity for
diagnostics/compatibility.

The targeted reproduction was diagnostic only, not a new benchmark quality
run. Full details and query IDs are in `diagnostic.json`.
