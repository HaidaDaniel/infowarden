#!/usr/bin/env bash

smoke_case_url() {
  if [[ "$SMOKE_CORE_READY" != "1" ]]; then
    smoke_note "url smoke requires the core stack; running core first"
    smoke_case_core
  fi

  smoke_section "Starting local URL fixture server"
  SMOKE_URL_TMP_DIR="$(mktemp -d)"
  SMOKE_URL_SITE_DIR="$SMOKE_URL_TMP_DIR/site"
  mkdir -p "$SMOKE_URL_SITE_DIR"
  URL_SITE_DIR="$SMOKE_URL_SITE_DIR" node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.env.URL_SITE_DIR;
fs.writeFileSync(path.join(root, 'robots.txt'), 'User-agent: *\nAllow: /\n');
fs.writeFileSync(path.join(root, 'index.html'), [
  '<!doctype html><html><head><title>URL Smoke Home</title></head><body>',
  '<main><h1>URL Smoke Home</h1>',
  '<p>Solstice URL marker proves local HTTP crawl indexing.</p>',
  '<a href="/guide.html">Guide</a>',
  '</main></body></html>',
].join(''));
fs.writeFileSync(path.join(root, 'guide.html'), [
  '<!doctype html><html><head><title>URL Smoke Guide</title></head><body>',
  '<article><h1>URL Smoke Guide</h1>',
  '<p>Lantern URL marker proves linked pages are crawled.</p>',
  '</article></body></html>',
].join(''));
NODE

  local port="${SMOKE_URL_PORT:-3199}"
  SMOKE_URL_BASE="http://127.0.0.1:$port"
  URL_SITE_DIR="$SMOKE_URL_SITE_DIR" SMOKE_URL_PORT="$port" node <<'NODE' &
const fs = require('fs');
const http = require('http');
const path = require('path');
const root = process.env.URL_SITE_DIR;
const port = Number(process.env.SMOKE_URL_PORT);
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.normalize(path.join(root, pathname));
  if (!target.startsWith(root)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': types.get(path.extname(target)) || 'text/plain; charset=utf-8' });
    response.end(content);
  });
});

server.listen(port, '127.0.0.1');
NODE
  SMOKE_URL_SERVER_PID=$!
  wait_for_url "$SMOKE_URL_BASE/index.html" "URL smoke fixture server" 30

  smoke_section "Creating URL smoke workspace and source"
  local suffix kb_response source_body source_response
  suffix="$(date -u +%Y%m%d%H%M%S)"
  kb_response="$(post_json "/workspaces" "{\"name\":\"URL Smoke Workspace $suffix\",\"description\":\"URL crawl smoke\",\"workspaceKind\":\"docs\"}")"
  SMOKE_URL_KB_ID="$(json_field "$kb_response" "id")"
  if [[ -z "$SMOKE_URL_KB_ID" ]]; then
    smoke_fail "failed to create URL smoke workspace: $kb_response"
  fi

  source_body="$(
    KB_ID="$SMOKE_URL_KB_ID" START_URL="$SMOKE_URL_BASE/index.html" node <<'NODE'
process.stdout.write(JSON.stringify({
  knowledgeBaseId: process.env.KB_ID,
  type: 'url',
  uri: process.env.START_URL,
  url: {
    maxPages: 3,
    maxBytesPerPage: 65536,
    totalMaxBytes: 262144,
    timeoutMs: 5000,
    sameHost: true,
    respectRobots: true,
  },
}));
NODE
  )"
  source_response="$(post_json "/sources" "$source_body")"
  SMOKE_URL_SOURCE_ID="$(json_field "$source_response" "id")"
  if [[ -z "$SMOKE_URL_SOURCE_ID" ]]; then
    smoke_fail "failed to create URL smoke source: $source_response"
  fi
  smoke_note "SMOKE_URL_KB_ID=$SMOKE_URL_KB_ID"
  smoke_note "SMOKE_URL_SOURCE_ID=$SMOKE_URL_SOURCE_ID"

  smoke_section "Indexing URL source"
  local refresh_response job_id
  refresh_response="$(post_json "/workspaces/$SMOKE_URL_KB_ID/sources/$SMOKE_URL_SOURCE_ID/refresh" '{"mode":"incremental","reason":"initial url smoke crawl"}')"
  job_id="$(json_field "$refresh_response" "job.id")"
  if [[ -z "$job_id" ]]; then
    smoke_fail "failed to enqueue initial URL refresh: $refresh_response"
  fi
  wait_for_indexing_job "$job_id" "initial URL refresh"
  URL_INITIAL_JOB="$SMOKE_LAST_JOB_DETAIL" URL_BASE="$SMOKE_URL_BASE" node <<'NODE'
const job = JSON.parse(process.env.URL_INITIAL_JOB);
const stats = job.stats || {};
if ((stats.filesScanned || 0) < 2 || (stats.filesParsed || 0) < 2 || !stats.validationReportId) {
  console.error('initial URL refresh stats are incomplete');
  console.error(JSON.stringify(stats, null, 2));
  process.exit(1);
}
const prepared = (job.logs || []).find((entry) => entry.message === 'Prepared URL crawl source');
if (!prepared || !prepared.data?.fetchedUrls?.some((url) => url.startsWith(process.env.URL_BASE))) {
  console.error('URL job did not record crawl metadata');
  console.error(JSON.stringify(job.logs, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Checking URL retrieval and metadata"
  local search_response admin_response manifest_response
  search_response="$(post_json "/workspaces/$SMOKE_URL_KB_ID/search" '{"query":"Solstice URL marker","topK":5,"pathPrefix":"index.html"}')"
  URL_SEARCH_RESPONSE="$search_response" URL_BASE="$SMOKE_URL_BASE" node <<'NODE'
const response = JSON.parse(process.env.URL_SEARCH_RESPONSE);
const result = response.results?.find((item) => item.path === 'index.html');
if (!result || !String(result.text || '').includes('Solstice URL marker')) {
  console.error('URL search did not return the index page marker');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (!String(result.metadata?.sourceUrl || '').startsWith(process.env.URL_BASE)) {
  console.error('URL search result is missing sourceUrl metadata');
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
NODE

  admin_response="$(get_json "/admin/knowledge-bases/$SMOKE_URL_KB_ID")"
  URL_ADMIN_RESPONSE="$admin_response" URL_BASE="$SMOKE_URL_BASE" node <<'NODE'
const response = JSON.parse(process.env.URL_ADMIN_RESPONSE);
const docs = response.explorer?.documents || [];
if (!docs.some((doc) => doc.path === 'index.html' && String(doc.metadata?.sourceUrl || '').startsWith(process.env.URL_BASE))) {
  console.error('admin explorer did not expose URL document metadata');
  console.error(JSON.stringify(docs, null, 2));
  process.exit(1);
}
NODE

  manifest_response="$(get_json "/workspaces/$SMOKE_URL_KB_ID/export-manifest")"
  URL_MANIFEST_RESPONSE="$manifest_response" URL_BASE="$SMOKE_URL_BASE" node <<'NODE'
const response = JSON.parse(process.env.URL_MANIFEST_RESPONSE);
const snapshot = response.sourceSnapshots?.find((item) => item.snapshotType === 'url_crawl');
if (!snapshot || !String(snapshot.metadata?.startUrl || '').startsWith(process.env.URL_BASE)) {
  console.error('export manifest is missing URL crawl source snapshot metadata');
  console.error(JSON.stringify(response.sourceSnapshots, null, 2));
  process.exit(1);
}
NODE
}
