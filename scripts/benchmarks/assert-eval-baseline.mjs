#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));
let throwOnFail = false;

if (args['self-test-regression']) {
  selfTestRegression();
  process.exit(0);
}

const baselinePath = path.resolve(repoRoot, args.baseline || 'fixtures/eval/cf-smoke-mini/baseline.json');
const runPath = args['run-json'] ? path.resolve(repoRoot, args['run-json']) : '';
const profileKey = args.profile || 'default';

if (!runPath) {
  fail('missing --run-json <path>');
}

const baseline = readJson(baselinePath);
const run = readJson(runPath);
const profile = baseline.profiles?.[profileKey];
if (!profile) {
  fail(`baseline has no profile ${profileKey}`);
}

assertRunAgainstProfile(run, baseline, profileKey, profile, loadAcceptedRegressions(baselinePath, baseline));
console.log(
  `eval baseline passed: ${baseline.datasetId}@${baseline.datasetVersion} profile=${profileKey} env=${baseline.environmentClass}`,
);

function assertRunAgainstProfile(run, baseline, profileKey, profile, approvals) {
  const metrics = run.metrics || run;
  const failures = [];
  const config = metrics.config || {};
  const dataset = config.dataset || {};
  const retrieval = config.retrieval || {};
  const serving = config.serving || {};

  assertEqual(metrics.datasetId, baseline.datasetId, 'datasetId', failures);
  assertEqual(metrics.datasetVersion, baseline.datasetVersion, 'datasetVersion', failures);
  assertEqual(metrics.profileKey, profileKey, 'profileKey', failures);
  assertEqual(metrics.topK, baseline.topK, 'topK', failures);
  assertEqual(retrieval.profileKey, profileKey, 'config.retrieval.profileKey', failures);
  assertEqual(dataset.id, baseline.datasetId, 'config.dataset.id', failures);
  assertEqual(dataset.version, baseline.datasetVersion, 'config.dataset.version', failures);

  if (!metrics.configHash || typeof metrics.configHash !== 'string') {
    failures.push('missing metrics.configHash');
  }
  if (!serving.servingRevisionId || !serving.manifestHash || !Array.isArray(serving.sourceRevisionIds) || serving.sourceRevisionIds.length < 1) {
    failures.push('missing serving manifest identity in metrics.config.serving');
  }
  if (!serving.vectorBackendId || !serving.vectorCollectionName) {
    failures.push('missing vector placement identity in metrics.config.serving');
  }

  assertMin(metrics.questionCount, profile.minQuestionCount, 'questionCount', failures);
  assertMin(metrics.hitAtK, profile.minHitAtK, 'hitAtK', failures);
  assertMin(metrics.hitAt3, profile.minHitAt3, 'hitAt3', failures);
  assertMin(metrics.mrr, profile.minMrr, 'mrr', failures);
  assertMax(metrics.emptyResultRate, profile.maxEmptyResultRate, 'emptyResultRate', failures);
  assertMax(metrics.duplicateRate, profile.maxDuplicateRate, 'duplicateRate', failures);
  assertMax(metrics.latencyMs?.p95, profile.maxLatencyMsP95, 'latencyMs.p95', failures);

  const approved = failures.every((failure) => {
    const metric = failure.split(' expected ')[0];
    return approvals.some(
      (approval) =>
        approval.baselineId === baseline.id &&
        approval.datasetId === baseline.datasetId &&
        approval.datasetVersion === baseline.datasetVersion &&
        approval.profileKey === profileKey &&
        approval.metric === metric &&
        approval.configHash === metrics.configHash,
    );
  });
  if (failures.length && !approved) {
    fail(`eval baseline regression:\n- ${failures.join('\n- ')}`);
  }
}

function loadAcceptedRegressions(baselinePath, baseline) {
  const approvalPath = path.resolve(path.dirname(baselinePath), baseline.acceptedRegressionsPath || 'approved-regressions.json');
  if (!fs.existsSync(approvalPath)) return [];
  const data = readJson(approvalPath);
  const approvals = Array.isArray(data.acceptedRegressions) ? data.acceptedRegressions : [];
  for (const [index, approval] of approvals.entries()) {
    for (const key of [
      'baselineId',
      'datasetId',
      'datasetVersion',
      'profileKey',
      'metric',
      'configHash',
      'reason',
      'reviewer',
      'approvedAt',
    ]) {
      if (typeof approval[key] !== 'string' || approval[key].trim() === '') {
        fail(`accepted regression ${index} missing ${key}`);
      }
    }
  }
  return approvals;
}

function selfTestRegression() {
  throwOnFail = true;
  const baseline = {
    datasetId: 'cf-smoke-mini',
    datasetVersion: 'test',
    topK: 5,
    environmentClass: 'self-test',
    profiles: {
      default: {
        minQuestionCount: 2,
        minHitAtK: 0.8,
        minHitAt3: 0.8,
        minMrr: 0.8,
        maxEmptyResultRate: 0.1,
        maxDuplicateRate: 0.1,
        maxLatencyMsP95: 100,
      },
    },
  };
  const regressedRun = {
    metrics: {
      datasetId: 'cf-smoke-mini',
      datasetVersion: 'test',
      profileKey: 'default',
      topK: 5,
      questionCount: 2,
      hitAtK: 0.5,
      hitAt3: 0.5,
      mrr: 0.25,
      emptyResultRate: 0.5,
      duplicateRate: 0,
      latencyMs: { p95: 50 },
      configHash: 'self-test-hash',
      config: {
        dataset: { id: 'cf-smoke-mini', version: 'test' },
        retrieval: { profileKey: 'default' },
        serving: {
          servingRevisionId: 'serving-self-test',
          manifestHash: 'manifest-self-test',
          sourceRevisionIds: ['revision-self-test'],
          vectorBackendId: 'backend-self-test',
          vectorCollectionName: 'kb-self-test',
        },
      },
    },
  };
  let failed = false;
  try {
    assertRunAgainstProfile(regressedRun, baseline, 'default', baseline.profiles.default, []);
  } catch {
    failed = true;
  }
  if (!failed) {
    fail('self-test regression did not fail');
  }
  throwOnFail = false;
  console.log('eval baseline synthetic regression self-test passed');
}

function assertEqual(actual, expected, label, failures) {
  if (actual !== expected) failures.push(`${label} expected ${expected}, got ${actual}`);
}

function assertMin(actual, expected, label, failures) {
  if (typeof actual !== 'number' || actual < expected) failures.push(`${label} expected >= ${expected}, got ${actual}`);
}

function assertMax(actual, expected, label, failures) {
  if (typeof actual !== 'number' || actual > expected) failures.push(`${label} expected <= ${expected}, got ${actual}`);
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=', 2);
    parsed[key] = inlineValue ?? rawArgs[index + 1] ?? true;
    if (inlineValue === undefined && rawArgs[index + 1] && !rawArgs[index + 1].startsWith('--')) index += 1;
  }
  return parsed;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`invalid JSON at ${path.relative(repoRoot, filePath)}: ${error.message}`);
  }
}

function fail(message) {
  if (throwOnFail) {
    throw new Error(message);
  }
  console.error(message);
  process.exit(1);
}
