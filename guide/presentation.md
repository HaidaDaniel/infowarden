# Reproducing presentation assets

## Studio images

The four [screenshots](../assets/screenshots/provenance.json) are original Chromium
1440×900 viewport captures of an isolated real API/PostgreSQL/Redis/Qdrant/CPU
embedding deployment. Synthetic handbook text and deliberately written memory
were created for this project and share its MIT license. No real user content,
provider credentials, private hostnames or checkout paths are shown. PNGs retain
original pixels and compression; together they occupy approximately 524 KiB.
Screenshots illustrate implemented workflows, not benchmark quality or usability
certification. Their fixture uses BAAI/bge-small-en-v1.5, 384 dimensions.

To inspect a similar live setup, follow [local development](deployment.md#persistent-local-development),
create a workspace with your own synthetic managed upload, index it, and inspect
retrieval provenance and separately written memory. Generated UUIDs will differ;
screenshot hashes document the specific captured instance rather than promise
pixel-identical independent deployments.

## Frozen evidence views

From the checkout root, after dependency installation:

```bash
node scripts/generate-presentation.mjs --check
# Recreate only the derived charts, chart data and README table:
node scripts/generate-presentation.mjs --write
```

The generator uses builtin Node modules and a pinned SHA256 of the original
v2.1 analysis. It cannot silently accept changed measurements. All modes retain
original machine identities; labels explain the supported choices. The chart data
retains unrounded aggregate and EN/RU/MIXED values; display rounding never changes
frozen evidence. `--check` fails on stale chart/table/data bytes. No model call,
retrieval experiment or network action occurs.

## Mermaid diagrams

Mermaid source is canonical and also embedded in the README/architecture guide.
SVGs are derived with Mermaid 11.12.0, Chromium 148.0.7778.96 and Arial-compatible
fonts. IDs and diagram seeds are fixed; rerendering with the same tools/fonts is
byte deterministic. Browser/font changes can change geometry and must be reviewed.
The optional renderer downloads nothing. Supply an explicitly installed local tool:

```bash
npm install --prefix /tmp/infowarden-diagram-tools --no-save --no-audit --no-fund mermaid@11.12.0
pnpm --filter web exec playwright install chromium
node scripts/render-diagrams.mjs --check --bundle /tmp/infowarden-diagram-tools/node_modules/mermaid/dist/mermaid.esm.min.mjs
# Use --write instead of --check to regenerate the three SVGs deliberately.
```

Temporary Mermaid tooling is not an application dependency. Runtime builds and
benchmark chart generation do not require it. Diagram rendering uses local browser
request interception with the supplied tool directory; it binds no network service.
