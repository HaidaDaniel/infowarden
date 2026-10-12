# Reproducible retrieval evidence

The complete frozen EN/RU/MIXED corpora, queries, qrels, methodology, DEV/HOLDOUT
split, configurations, attempted runs, analysis, and confirmation reports live
in `fixtures/eval/benchmark-v2`. Read the partition READMEs, metadata, and
`reports/v2.1-analysis/report.md` before comparing results. The split checksum is
`34b11d2ab26eb26086a88fc13685704e9ca46dbf93ad0eaf02ae7be9c37862b3`.

Run `pnpm eval:validate-fixtures` for local fixture checks and
`pnpm benchmark:v2 -- --validate` for frozen split/harness integrity. With the
same documented provider/model topology running, reproduce HOLDOUT into an
external output directory without overwriting the committed evidence:

```bash
pnpm benchmark:v2 -- --holdout --api-url http://localhost:3000 --out /tmp/infowarden-holdout
```

The committed DEV selections remain frozen inputs. `--dev` is available only
for independent exploration into an external directory; it does not change
accepted selections or labels. Benchmark scoring
and identity helpers in `scripts/benchmarks/benchmark-v2` support independent
analysis. Frozen reports preserve measured quality and model/configuration
identity. Two confirmation reports replace machine-local checkout paths with
`[private-checkout]`; their original byte hashes are recorded in the export
manifest. No queries, qrels, measurements, or retrieval algorithms are changed.

The private release-control validators are not public benchmark tooling. A full
new quality run requires recreating the documented runtime/provider topology
and following the frozen methodology; it is never run by the export command.
Latency is specific to that topology. These retrieval results do not establish
coding-agent productivity, enterprise availability, or production-scale capacity.

The v2.1 quality comparison used Qwen3-Embedding-0.6B (1,024 dimensions),
with Qwen3-Reranker-0.6B where configured. The quick demo uses
BAAI/bge-small-en-v1.5 (384 dimensions); its successful setup is not a
reproduction of the v2.1 quality numbers. See the analysis report for the exact
model identities, matrix and observed latency. Benchmark fixture validation
checks integrity only; it does not rerun the frozen retrieval experiments.

## Presentation of the accepted comparison

[The README table](../README.md#frozen-retrieval-evidence),
[quality chart](../assets/benchmarks/quality.svg),
[quality/latency chart](../assets/benchmarks/quality-latency.svg) and
[chart data](../assets/benchmarks/data.json) all derive from the same
[frozen v2.1 analysis JSON](../fixtures/eval/benchmark-v2/reports/v2.1-analysis/benchmark-v21-analysis.json).
The chart input SHA256 is
`da057ffb96dbfa8764bbfbddc44fe3ac09e1fb08c65521d6f882a7090197b30e`.

The HOLDOUT consists of EN 48, RU 48 and MIXED 112 queries. The displayed aggregate
is weighted by query count, not an equal-language mean. Query-level means across
three operational repetitions feed the frozen 2,000-resample bootstrap; MRR
error bars show its 95% interval. Hit@10, MRR and latency are separate measurements;
a higher MRR can coexist with lower Hit@10. Latency shown is the analysis P50/P95,
not the separate productization confirmation run. No figures combine runs.

Dense is the measured default; legacy hybrid remains compatible. Reranking has
higher measured MRR but substantially higher latency in these runs. The harmful
lexical-reranker pairing and alternative fusion experiments remain in the complete
frozen evidence; the five-mode presentation does not imply support for every
experimental configuration. See [full analysis and selection reasoning](../fixtures/eval/benchmark-v2/reports/v2.1-analysis/report.md).

Hardware/provider topology and model serving affect latency. The evidence does
not supply a portable hardware model, production load curve or capacity guarantee.
Corpus scope, fixed model identities and frozen split limit generalization.
[Regenerate presentation assets](presentation.md) without rerunning retrieval.
