#!/usr/bin/env bash

smoke_case_documents() {
  if [[ "$SMOKE_CORE_READY" != "1" ]]; then
    smoke_note "documents smoke requires the core stack; running core first"
    smoke_case_core
  fi

  smoke_section "Creating advanced document fixture archive"
  SMOKE_DOCS_TMP_DIR="$(mktemp -d)"
  local archive_path="$SMOKE_DOCS_TMP_DIR/advanced-documents.zip"
  ARCHIVE_PATH="$archive_path" node <<'NODE'
const fs = require('fs');

function storedZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const fileName = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, fileName, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, fileName);

    offset += localHeader.length + fileName.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(Object.keys(files).length, 8);
  endOfCentralDirectory.writeUInt16LE(Object.keys(files).length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

const docx = storedZip({
  '[Content_Types].xml': '<Types></Types>',
  'docProps/core.xml': '<cp:coreProperties><dc:title>Smoke DOCX Notes</dc:title></cp:coreProperties>',
  'word/document.xml': [
    '<w:document><w:body>',
    '<w:p><w:r><w:t>Umbra DOCX marker proves Word documents index.</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Second DOCX paragraph survives extraction.</w:t></w:r></w:p>',
    '</w:body></w:document>',
  ].join(''),
});

const pdf = Buffer.from([
  '%PDF-1.4',
  '1 0 obj << /Type /Page >> endobj',
  '2 0 obj << /Length 32 >>',
  'stream',
  'BT (Quasar PDF marker) Tj ET',
  'endstream',
  'endobj',
  '%%EOF',
].join('\n'), 'latin1');

const html = [
  '<html><head><title>Smoke HTML Article</title><script>window.noise=true</script></head>',
  '<body><nav>Hidden nav</nav><article><h1>Smoke HTML Article</h1>',
  '<p>Vesper HTML marker proves article cleanup and entity decoding &amp; indexing.</p>',
  '</article><footer>Hidden footer</footer></body></html>',
].join('');

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
]);

const archive = storedZip({
  'docs/quasar.pdf': pdf,
  'docs/umbra.docx': docx,
  'docs/vesper.html': html,
  'images/scanned-note.png': png,
});

fs.writeFileSync(process.env.ARCHIVE_PATH, archive);
NODE

  smoke_section "Creating document smoke workspace"
  local suffix kb_response docs_kb_id
  suffix="$(date -u +%Y%m%d%H%M%S)"
  kb_response="$(post_json "/knowledge-bases" "{\"name\":\"Document Smoke KB $suffix\",\"description\":\"Advanced document upload smoke\"}")"
  docs_kb_id="$(json_field "$kb_response" "id")"
  if [[ -z "$docs_kb_id" ]]; then
    smoke_fail "failed to create document smoke knowledge base: $kb_response"
  fi
  smoke_note "DOCUMENT_SMOKE_KB_ID=$docs_kb_id"

  smoke_section "Uploading advanced document archive"
  local upload_response docs_source_id
  upload_response="$(post_multipart_file "/workspaces/$docs_kb_id/sources/upload" "$archive_path" \
    -F 'includeRules=["**/*.pdf","**/*.docx","**/*.html","**/*.png"]' \
    -F "sourceName=advanced document smoke")"
  docs_source_id="$(json_field "$upload_response" "source.id")"
  if [[ -z "$docs_source_id" ]]; then
    smoke_fail "failed to upload document smoke archive: $upload_response"
  fi
  UPLOAD_RESPONSE="$upload_response" node <<'NODE'
const response = JSON.parse(process.env.UPLOAD_RESPONSE);
if (response.upload?.archiveFormat !== 'zip' || response.upload?.fileCount !== 4) {
  console.error('document upload response did not describe the ZIP fixture');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
if (response.source?.type !== 'upload' || !String(response.source?.uri || '').startsWith('upload://')) {
  console.error('document upload did not create a managed upload source');
  console.error(JSON.stringify(response.source, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Indexing advanced document upload source"
  local job_body job_response docs_job_id
  job_body="$(KB_ID="$docs_kb_id" SOURCE_ID="$docs_source_id" node -e 'process.stdout.write(JSON.stringify({knowledgeBaseId:process.env.KB_ID,sourceId:process.env.SOURCE_ID,type:"scan_source"}))')"
  job_response="$(post_json "/jobs/indexing" "$job_body")"
  docs_job_id="$(json_field "$job_response" "id")"
  if [[ -z "$docs_job_id" ]]; then
    smoke_fail "failed to enqueue document smoke indexing job: $job_response"
  fi
  wait_for_indexing_job "$docs_job_id" "document upload indexing job"
  DOCUMENT_JOB_DETAIL="$SMOKE_LAST_JOB_DETAIL" node <<'NODE'
const job = JSON.parse(process.env.DOCUMENT_JOB_DETAIL);
const stats = job.stats || {};
if (stats.filesScanned !== 4 || stats.filesParsed !== 3 || stats.parseFailures !== 1 || !stats.validationReportId) {
  console.error('document smoke indexing stats are unexpected');
  console.error(JSON.stringify(stats, null, 2));
  process.exit(1);
}
if (!Array.isArray(job.logs) || !job.logs.some((entry) => entry.message === 'Prepared managed upload source')) {
  console.error('document smoke job did not record managed upload preparation');
  console.error(JSON.stringify(job.logs, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Verifying document extraction retrieval"
  local pdf_search docx_search html_search
  pdf_search="$(post_json "/workspaces/$docs_kb_id/search" '{"query":"Quasar PDF marker","topK":5,"pathPrefix":"docs/quasar.pdf"}')"
  DOC_SEARCH_RESPONSE="$pdf_search" EXPECTED_PATH="docs/quasar.pdf" EXPECTED_TEXT="Quasar PDF marker" EXPECTED_PROCESSOR="pdf_text" node <<'NODE'
const response = JSON.parse(process.env.DOC_SEARCH_RESPONSE);
const result = response.results?.find((item) => item.path === process.env.EXPECTED_PATH);
if (!result || !String(result.text || '').includes(process.env.EXPECTED_TEXT) || result.metadata?.processor !== process.env.EXPECTED_PROCESSOR) {
  console.error('document search result did not include expected text and processor metadata');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  docx_search="$(post_json "/workspaces/$docs_kb_id/search" '{"query":"Umbra DOCX marker","topK":5,"pathPrefix":"docs/umbra.docx"}')"
  DOC_SEARCH_RESPONSE="$docx_search" EXPECTED_PATH="docs/umbra.docx" EXPECTED_TEXT="Umbra DOCX marker" EXPECTED_PROCESSOR="docx_text" node <<'NODE'
const response = JSON.parse(process.env.DOC_SEARCH_RESPONSE);
const result = response.results?.find((item) => item.path === process.env.EXPECTED_PATH);
if (!result || !String(result.text || '').includes(process.env.EXPECTED_TEXT) || result.metadata?.processor !== process.env.EXPECTED_PROCESSOR) {
  console.error('document search result did not include expected text and processor metadata');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  html_search="$(post_json "/workspaces/$docs_kb_id/search" '{"query":"Vesper HTML marker","topK":5,"pathPrefix":"docs/vesper.html"}')"
  DOC_SEARCH_RESPONSE="$html_search" EXPECTED_PATH="docs/vesper.html" EXPECTED_TEXT="Vesper HTML marker" EXPECTED_PROCESSOR="html_article" node <<'NODE'
const response = JSON.parse(process.env.DOC_SEARCH_RESPONSE);
const result = response.results?.find((item) => item.path === process.env.EXPECTED_PATH);
if (!result || !String(result.text || '').includes(process.env.EXPECTED_TEXT) || result.metadata?.processor !== process.env.EXPECTED_PROCESSOR) {
  console.error('document search result did not include expected text and processor metadata');
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
NODE

  smoke_section "Verifying document metadata and validation report"
  local admin_response manifest_response
  admin_response="$(get_json "/admin/knowledge-bases/$docs_kb_id")"
  ADMIN_DOC_RESPONSE="$admin_response" node <<'NODE'
const response = JSON.parse(process.env.ADMIN_DOC_RESPONSE);
const byPath = new Map((response.explorer?.documents || []).map((doc) => [doc.path, doc]));
for (const [path, processor] of [
  ['docs/quasar.pdf', 'pdf_text'],
  ['docs/umbra.docx', 'docx_text'],
  ['docs/vesper.html', 'html_article'],
]) {
  const doc = byPath.get(path);
  if (!doc || doc.status !== 'active' || doc.metadata?.processor !== processor || (doc.chunkCount || 0) < 1) {
    console.error(`document metadata missing expected processor for ${path}`);
    console.error(JSON.stringify(doc, null, 2));
    process.exit(1);
  }
}
if (byPath.has('images/scanned-note.png')) {
  console.error('OCR candidate image should not be materialized as an active document');
  console.error(JSON.stringify(byPath.get('images/scanned-note.png'), null, 2));
  process.exit(1);
}
NODE

  manifest_response="$(get_json "/workspaces/$docs_kb_id/export-manifest")"
  DOCUMENT_MANIFEST_RESPONSE="$manifest_response" node <<'NODE'
const response = JSON.parse(process.env.DOCUMENT_MANIFEST_RESPONSE);
const issues = response.validationReports?.flatMap((report) => report.issues || []) || [];
const codes = new Set(issues.map((issue) => issue.code));
for (const code of ['low_confidence_pdf_text', 'ocr_unavailable']) {
  if (!codes.has(code)) {
    console.error(`validation report missing ${code}`);
    console.error(JSON.stringify(response.validationReports, null, 2));
    process.exit(1);
  }
}
const ocrIssue = issues.find((issue) => issue.code === 'ocr_unavailable');
if (ocrIssue?.metadata?.path !== 'images/scanned-note.png') {
  console.error('ocr_unavailable issue does not reference the image fixture');
  console.error(JSON.stringify(ocrIssue, null, 2));
  process.exit(1);
}
if ((response.counts?.documents || 0) !== 3 || (response.counts?.validationReports || 0) < 1) {
  console.error('document export manifest counts are unexpected');
  console.error(JSON.stringify(response.counts, null, 2));
  process.exit(1);
}
NODE
}
