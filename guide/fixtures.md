# Fixture provenance and runtime data

Public examples under `test-fixtures/sample-docs` and the demo's temporary
workspaces contain synthetic project documentation. Evaluation fixtures under
`fixtures/eval` have their own manifest and methodology; benchmark corpus origin
and license details remain in the partition READMEs. The project MIT license
does not override licenses of imported benchmark datasets or operator sources.

Advanced-document integration fixtures are generated into a fresh temporary
archive by `scripts/smoke/cases/documents.sh`. They contain the synthetic markers
“Quasar PDF marker”, “Umbra DOCX marker” and “Vesper HTML marker”, plus a
12-byte malformed PNG used to test unsupported OCR handling. The DOCX contains
three synthetic XML members. The generator is project-authored test code under
the repository MIT license; it does not read personal document collections.
Use `SMOKE_CASES=documents pnpm smoke:live` against the isolated smoke stack.

The smoke script creates its archive on each run; no committed runtime upload
copy is needed. Runtime upload-storage directories, build caches, generated Vite
configuration output, logs and local environments are excluded from release
snapshots. Source `vite.config.ts` and TypeScript configuration remain present;
typecheck/build regenerate their own output. User uploads and deployment state
are operator data and must never be committed as release fixtures.
