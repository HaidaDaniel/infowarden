// Deterministic views of frozen evidence; never runs a retrieval experiment.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const mode = process.argv[2];
if (!["--write", "--check"].includes(mode) || process.argv.length !== 3)
  throw Error("Usage: node scripts/generate-presentation.mjs --write|--check (from repository root)");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = "fixtures/eval/benchmark-v2/reports/v2.1-analysis/benchmark-v21-analysis.json";
const bytes = await fs.readFile(path.resolve(source));
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== "da057ffb96dbfa8764bbfbddc44fe3ac09e1fb08c65521d6f882a7090197b30e")
  throw Error("Frozen presentation evidence identity mismatch");
const evidence = JSON.parse(bytes);
const selected = [
  ["dense", "Dense (default)", "#1d4ed8"],
  ["lexical-lstar", "BM25", "#475569"],
  ["fusion-legacy", "Hybrid (legacy)", "#0f766e"],
  ["dense-reranker", "Dense + reranker", "#9a3412"],
  ["fusion-selected-reranker", "Hybrid + reranker", "#7e22ce"],
];
const rows = selected.map(([id, label, color]) => ({
  id,
  label,
  color,
  overall: evidence.modes[id].overall,
  byPartition: evidence.modes[id].byPartition,
}));
if (!evidence.qualityRun || rows.some((r) => r.overall.queryCount !== 208 || r.overall.failedQueryCount !== 0))
  throw Error("Unexpected quality evidence population");
const data = {
  schemaVersion: 1,
  source,
  sourceSha256: sha256,
  splitChecksumSha256: evidence.source.splitChecksumSha256,
  scope: "208 EN/RU/MIXED HOLDOUT queries; three repetitions; aggregate v2.1 analysis",
  methodology: evidence.methodology,
  embeddingModel: evidence.runtime.embeddingModel,
  embeddingDimension: evidence.runtime.embeddingDimension,
  rerankerModel: evidence.runtime.rerankerModel,
  modes: rows.map(({ id, label, overall, byPartition }) => ({ id, label, overall, byPartition })),
};
const escape = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n = (v) => Number(v).toFixed(2);
const text = (x, y, s, extra = "") => `<text x="${n(x)}" y="${n(y)}" ${extra}>${escape(s)}</text>`;
const line = (x1, y1, x2, y2, stroke = "#cbd5e1") =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}"/>`;
const svg = (title, desc, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="460" viewBox="0 0 1000 460" role="img" aria-labelledby="title desc"><title id="title">${escape(title)}</title><desc id="desc">${escape(desc)}</desc><rect width="1000" height="460" fill="white"/><g font-family="Arial, sans-serif" font-size="15" fill="#172033">${body}</g></svg>\n`;
let quality = text(28, 36, "Retrieval quality on frozen EN/RU/MIXED HOLDOUT", 'font-size="23" font-weight="700"');
quality += text(28, 63, "MRR · 208 queries · bars show 95% query-bootstrap confidence intervals");
const bx = 225,
  bw = 610;
for (let i = 0; i <= 10; i++) {
  quality += line(bx + (bw * i) / 10, 90, bx + (bw * i) / 10, 370, i === 0 ? "#475569" : "#e2e8f0");
  quality += text(bx + (bw * i) / 10, 395, (i / 10).toFixed(1), 'text-anchor="middle"');
}
rows.forEach(({ label, color, overall }, i) => {
  const y = 115 + i * 53,
    metric = overall.metrics.mrr;
  quality += text(210, y + 7, label, 'text-anchor="end"');
  quality += `<rect x="${bx}" y="${y - 13}" width="${n(bw * metric.value)}" height="29" fill="${color}" rx="3"/>`;
  const low = bx + bw * metric.ci95.low,
    high = bx + bw * metric.ci95.high;
  quality +=
    line(low, y + 2, high, y + 2, "#111827") +
    line(low, y - 5, low, y + 9, "#111827") +
    line(high, y - 5, high, y + 9, "#111827");
  quality += text(860, y + 7, metric.value.toFixed(4));
});
quality += text(
  28,
  437,
  "Qwen3-Embedding-0.6B / optional Qwen3-Reranker-0.6B · Corpus-specific quality, not a production claim.",
  'font-size="13"',
);
let latency = text(28, 36, "Quality versus measured retrieval latency", 'font-size="23" font-weight="700"');
latency += text(28, 63, "Same frozen analysis run · P50 latency is topology-specific; lower is faster");
const lx = 80,
  ly = 375,
  lw = 590,
  lh = 275;
for (let i = 0; i <= 6; i++) {
  const x = lx + (lw * i) / 6;
  latency += line(x, ly - lh, x, ly) + text(x, ly + 24, String(i * 500), 'text-anchor="middle"');
}
for (let i = 0; i <= 5; i++) {
  const y = ly - (lh * i) / 5;
  latency += line(lx, y, lx + lw, y) + text(lx - 12, y + 5, (i / 5).toFixed(1), 'text-anchor="end"');
}
latency += text(27, 94, "MRR") + text(375, 425, "Retrieval P50 (ms)", 'text-anchor="middle"');
rows.forEach(({ label, color, overall }, i) => {
  const x = lx + (lw * overall.latencyP50Ms) / 3000,
    y = ly - lh * overall.metrics.mrr.value;
  latency += `<circle cx="${n(x)}" cy="${n(y)}" r="5" fill="${color}" stroke="white"/>`;
  latency += `<rect x="710" y="${105 + i * 54}" width="13" height="13" fill="${color}"/>`;
  latency +=
    text(733, 118 + i * 54, label) +
    text(
      733,
      137 + i * 54,
      `${overall.metrics.mrr.value.toFixed(4)} MRR / ${overall.latencyP50Ms.toFixed(1)} ms`,
      'font-size="13"',
    );
});
latency += text(
  28,
  451,
  "Hardware/model serving and dataset affect latency; this is not a throughput or capacity benchmark.",
  'font-size="13"',
);
const tableRows = [
  ["Mode", "Hit@10", "MRR", "P50 (ms)", "P95 (ms)"],
  ...rows.map((r) => [
    r.label,
    `${(r.overall.metrics.hit_at_10.value * 100).toFixed(1)}%`,
    r.overall.metrics.mrr.value.toFixed(4),
    r.overall.latencyP50Ms.toFixed(0),
    r.overall.latencyP95Ms.toFixed(0),
  ]),
];
const widths = tableRows[0].map((_, i) => Math.max(3, ...tableRows.map((r) => r[i].length)));
const tableLine = (r) => `| ${r.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
const table = [
  tableLine(tableRows[0]),
  tableLine(widths.map((w) => "-".repeat(w))),
  ...tableRows.slice(1).map(tableLine),
].join("\n");
const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
const tablePattern = /<!-- benchmark-table:start -->\n[\s\S]*?\n<!-- benchmark-table:end -->/;
if (!tablePattern.test(readme)) throw Error("README benchmark table markers missing");
const outputs = new Map([
  [
    "assets/benchmarks/quality.svg",
    svg(
      "Frozen retrieval quality",
      "Five supported modes with aggregate MRR and bootstrap intervals; full partition evidence is linked.",
      quality,
    ),
  ],
  [
    "assets/benchmarks/quality-latency.svg",
    svg(
      "Frozen retrieval quality versus latency",
      "Aggregate MRR against P50 milliseconds for the same five modes and same frozen run.",
      latency,
    ),
  ],
  ["assets/benchmarks/data.json", JSON.stringify(data, null, 2) + "\n"],
  [
    "README.md",
    readme.replace(tablePattern, `<!-- benchmark-table:start -->\n\n${table}\n\n<!-- benchmark-table:end -->`),
  ],
]);
for (const [relative, content] of outputs) {
  const target = path.join(root, relative);
  if (mode === "--check") {
    if ((await fs.readFile(target, "utf8")) !== content) throw Error(`Stale presentation output: ${relative}`);
  } else await fs.writeFile(target, content);
}
console.log(JSON.stringify({ status: "PASS", mode, sourceSha256: sha256, files: [...outputs.keys()] }));
