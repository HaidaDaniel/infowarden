#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const datasetId = 'cf-standard-benchmark';
const sourceName = 'beir-scifact';
const defaultUrl = 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip';

const args = parseArgs(process.argv.slice(2));
const profile = args.profile || 'cpu-mini';
const maxDocs = numberArg(args.maxDocs, profile === 'cpu-mini' ? 500 : 2000);
const maxQuestions = numberArg(args.maxQuestions, profile === 'cpu-mini' ? 50 : 150);
const cacheRoot = path.resolve(repoRoot, args.cacheDir || `.contextforge/benchmarks/${datasetId}`);
const outputDir = path.resolve(cacheRoot, `${sourceName}-${profile}`);
const rawDir = path.join(cacheRoot, 'raw');
const zipPath = path.join(rawDir, `${sourceName}.zip`);
const extractedDir = path.join(rawDir, 'scifact');

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  await fsp.mkdir(rawDir, { recursive: true });
  await downloadIfMissing(args.url || defaultUrl, zipPath);
  await extractIfMissing(zipPath, extractedDir);

  const corpus = readJsonl(path.join(extractedDir, 'corpus.jsonl'));
  const queries = readJsonl(path.join(extractedDir, 'queries.jsonl'));
  const qrels = readQrels(path.join(extractedDir, 'qrels', 'test.tsv'));
  const pack = buildPack({ corpus, queries, qrels, maxDocs, maxQuestions, profile });
  await writePack(outputDir, pack);

  console.log(
    JSON.stringify(
      {
        datasetId,
        source: sourceName,
        profile,
        outputDir: path.relative(repoRoot, outputDir),
        documents: pack.documents.length,
        questions: pack.questions.length,
        manifest: path.relative(repoRoot, path.join(outputDir, 'manifest.json')),
        questionsPath: path.relative(repoRoot, path.join(outputDir, 'questions.jsonl')),
      },
      null,
      2,
    ),
  );
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=', 2);
    parsed[key] = inlineValue ?? rawArgs[index + 1] ?? true;
    if (inlineValue === undefined && rawArgs[index + 1] && !rawArgs[index + 1].startsWith('--')) {
      index += 1;
    }
  }
  return parsed;
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function downloadIfMissing(url, targetPath) {
  if (fs.existsSync(targetPath) && !args.force) {
    return;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(targetPath, buffer);
  await fsp.writeFile(`${targetPath}.sha256`, crypto.createHash('sha256').update(buffer).digest('hex'));
}

async function extractIfMissing(sourceZip, targetDir) {
  if (fs.existsSync(path.join(targetDir, 'corpus.jsonl')) && !args.force) {
    return;
  }
  await fsp.rm(targetDir, { recursive: true, force: true });
  const result = spawnSync('unzip', ['-q', '-o', sourceZip, '-d', rawDir], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('failed to extract benchmark zip; install unzip and retry');
  }
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readQrels(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = lines.shift()?.split(/\t/) || [];
  const queryIndex = header.indexOf('query-id');
  const corpusIndex = header.indexOf('corpus-id');
  const scoreIndex = header.indexOf('score');
  if (queryIndex < 0 || corpusIndex < 0 || scoreIndex < 0) {
    throw new Error(`unexpected qrels header in ${filePath}: ${header.join(', ')}`);
  }
  return lines.map((line) => {
    const columns = line.split(/\t/);
    return {
      queryId: columns[queryIndex],
      corpusId: columns[corpusIndex],
      score: Number(columns[scoreIndex]),
    };
  });
}

function buildPack({ corpus, queries, qrels, maxDocs, maxQuestions }) {
  const corpusById = new Map(corpus.map((document) => [String(document._id), document]));
  const queryById = new Map(queries.map((query) => [String(query._id), query]));
  const qrelsByQuery = new Map();
  for (const qrel of qrels.filter((item) => item.score > 0)) {
    const bucket = qrelsByQuery.get(qrel.queryId) || [];
    bucket.push(qrel);
    qrelsByQuery.set(qrel.queryId, bucket);
  }

  const selectedQuestions = [];
  const selectedDocumentIds = new Set();
  for (const [queryId, relevant] of qrelsByQuery.entries()) {
    const query = queryById.get(queryId);
    if (!query) continue;
    const validRelevant = relevant.filter((qrel) => corpusById.has(qrel.corpusId));
    if (!validRelevant.length) continue;
    selectedQuestions.push({ query, relevant: validRelevant });
    for (const qrel of validRelevant) selectedDocumentIds.add(qrel.corpusId);
    if (selectedQuestions.length >= maxQuestions) break;
  }

  for (const document of corpus) {
    if (selectedDocumentIds.size >= maxDocs) break;
    selectedDocumentIds.add(String(document._id));
  }

  const documents = [...selectedDocumentIds].map((id) => {
    const document = corpusById.get(id);
    return {
      id: docId(id),
      sourceId: id,
      fileName: `${safeFileName(id)}.md`,
      title: document.title || `SciFact ${id}`,
      text: [document.title, document.text].filter(Boolean).join('\n\n'),
    };
  });
  const documentPathBySourceId = new Map(
    documents.map((document) => [document.sourceId, `documents/${sourceName}/${document.fileName}`]),
  );

  const questions = selectedQuestions.map(({ query, relevant }) => ({
    id: `beir_scifact_q_${safeId(query._id)}`,
    text: query.text,
    expectedDocumentIds: relevant.map((qrel) => docId(qrel.corpusId)),
    tags: ['beir', 'scifact', 'scientific-claims'],
    metadata: {
      datasetId,
      sourceDataset: sourceName,
      sourceQueryId: String(query._id),
      expectedDocumentPaths: relevant
        .map((qrel) => documentPathBySourceId.get(qrel.corpusId))
        .filter(Boolean),
    },
  }));

  return { documents, questions };
}

async function writePack(packDir, pack) {
  await fsp.rm(packDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(packDir, 'documents', sourceName), { recursive: true });
  for (const document of pack.documents) {
    await fsp.writeFile(
      path.join(packDir, 'documents', sourceName, document.fileName),
      `# ${document.title}\n\n${document.text}\n`,
    );
  }
  await fsp.writeFile(
    path.join(packDir, 'questions.jsonl'),
    `${pack.questions.map((question) => JSON.stringify(question)).join('\n')}\n`,
  );
  await fsp.writeFile(
    path.join(packDir, 'manifest.json'),
    JSON.stringify(
      {
        id: datasetId,
        version: new Date().toISOString().slice(0, 10),
        tier: 'standard',
        description: 'CPU-friendly BEIR SciFact sample for ContextForge model and pipeline comparison.',
        license: 'BEIR/SciFact public benchmark; see source metadata.',
        languages: ['en'],
        documentsPath: 'documents',
        questionsPath: 'questions.jsonl',
        defaultTopK: 10,
        sourceTypes: ['local_folder'],
        metrics: ['hit@1', 'hit@3', 'hit@10', 'mrr', 'empty_result_rate', 'duplicate_rate'],
        source: {
          name: sourceName,
          url: args.url || defaultUrl,
          cachedZip: path.relative(repoRoot, zipPath),
          profile,
          maxDocs,
          maxQuestions,
        },
        documents: pack.documents.map((document) => ({
          id: document.id,
          path: `documents/${sourceName}/${document.fileName}`,
          sourceType: 'local_folder',
          language: 'en',
          tags: ['beir', 'scifact'],
          metadata: {
            sourceDataset: sourceName,
            sourceDocumentId: document.sourceId,
          },
        })),
      },
      null,
      2,
    ),
  );
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function safeFileName(value) {
  return safeId(value).slice(0, 120);
}

function docId(value) {
  return `beir_scifact_doc_${safeId(value)}`;
}
