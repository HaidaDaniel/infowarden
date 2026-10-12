# cf-static-knowledge-golden

Sanitized static-knowledge retrieval golden set for public v0.1 (task `0138`).
It measures retrieval quality over stable/warm persistent knowledge only. It
is not a coding-productivity dataset, and nothing in this pack claims one.

## Contents

- `manifest.json` — pack identity, corpus inventory, and source-class metadata.
- `questions.jsonl` — reviewed questions with fixed expected labels.
- `documents/` — synthetic source corpus, organized by source class.
- `baseline.json` — reviewed local-dev retrieval quality gates.
- `approved-regressions.json` — ledger of explicitly approved regressions.
- `reports/` — committed sanitized aggregate reports from reviewed runs.

## Source classes

| Class            | Source type      | Documents | Notes                                        |
| ---------------- | ---------------- | --------- | -------------------------------------------- |
| `markdown_docs`  | `local_folder`   | 8         | Operations, API, and policy Markdown docs.   |
| `book_reference` | `upload` (zip)   | 6         | Managed book/reference archive, one chapter. |
| `obsidian_notes` | `obsidian_vault` | 5         | Decision log, incidents, and meeting notes.  |

The corpus is synthetic repo-owned content. It contains no private source
text, private paths, personal questions, or provider credentials.

## Question format

Each line of `questions.jsonl` is one JSON object:

```json
{
  "id": "q_ops_tier2_escalation",
  "text": "When is a tier-2 escalation required for an on-call incident?",
  "expectedDocumentIds": ["doc_ops_runbook"],
  "expectedChunkHints": [
    { "documentId": "doc_ops_runbook", "contains": "A tier-2 escalation is required when an incident is still open after 30" }
  ],
  "tags": ["ops", "escalation", "exact-term"],
  "metadata": { "sourceClass": "markdown_docs", "language": "en", "difficulty": "easy" }
}
```

- `expectedDocumentIds` are manifest document ids, reviewed by an operator.
  They are never derived from retrieval output.
- `expectedChunkHints` are reviewed substrings that must exist in the named
  document; the validator enforces this on every change.
- `metadata.sourceClass` ties each question to a persistent source class.

## Running the benchmark

Requires a live deployment (API, PostgreSQL, Qdrant) and the `zip` utility:

```sh
pnpm benchmark:static-knowledge
```

The runner creates a throwaway `benchmarks` workspace, imports the three
source classes, indexes them, applies the golden hybrid profiles, imports the
questions with fixed labels, and runs `dense`, `hybrid`, and `hybrid+rerank`
eval runs. It deletes the workspace on exit (`--keep-workspace` retains it).

Options:

```text
--api-url <url>    default http://localhost:3000
--api-key <key>    or CONTEXTFORGE_API_KEY / ADMIN_API_KEY env
--pack <dir>       default fixtures/eval/cf-static-knowledge-golden
--out <dir>        default .contextforge/benchmarks/static-knowledge-golden/<utc>
--topk <n>         default 5 (must match baseline.json topK)
--keep-workspace   do not delete the benchmark workspace on exit
```

Raw per-run JSON and `report.md` are written under git-ignored
`.contextforge/benchmarks/`. Commit only the sanitized aggregate report,
placed under `reports/` with the environment identity and date.

## Validation

```sh
pnpm eval:validate-fixtures
```

Validates manifest identity, document presence, chunk-hint substrings,
baseline shape, and the approved-regressions ledger for this pack and
`cf-smoke-mini`.

## Baseline gates

`baseline.json` defines release gates for the `local-dev-cpu-baseline`
environment class (CPU embedding baseline plus local CPU reranker). The
`benchmark:static-knowledge` report prints PASS/FAIL per mode against these
gates. A gate failure is reviewed, then either fixed or recorded in
`approved-regressions.json` with baseline id, dataset identity, profile,
metric, config hash, reason, reviewer, and approval date.

## Failure taxonomy

Reviewed qualitative failures use this taxonomy: exact-term failure, semantic
mismatch, cross-document question, poor multilingual retrieval, chunk boundary
problem, reranker degradation, stale source revision, missing source, and
duplicate or empty result. Reports must separate observed failures from
speculative feature ideas.
