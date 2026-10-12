import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { SectionCard } from '../components/SectionCard';
import {
  compareEvalRuns,
  fetchEvalQuestions,
  fetchEvalRuns,
  fetchWorkspaces,
  importStandardBenchmark,
  runRetrievalEval,
} from '../lib/api';
import { formatDateTime } from '../lib/format';
import type {
  EvalRun,
  EvalRunComparisonResponse,
  StandardBenchmarkImportResponse,
  WorkspaceRecord,
} from '../lib/types';

const STANDARD_DATASET_ID = 'cf-standard-benchmark';
const DEFAULT_RERANKER_PROVIDER = 'local-cpu-reranker';

type BenchmarkWorkspaceSummary = {
  workspace: WorkspaceRecord;
  questions: number;
  runs: EvalRun[];
  latestOff?: EvalRun;
  latestOn?: EvalRun;
  bestRun?: EvalRun;
};

type BenchmarkBundle = {
  workspaces: WorkspaceRecord[];
  summaries: BenchmarkWorkspaceSummary[];
};

export function BenchmarksPage({ connectionRevision = 0 }: { connectionRevision?: number }) {
  const [bundle, setBundle] = useState<BenchmarkBundle | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [profileKey, setProfileKey] = useState('');
  const [topK, setTopK] = useState(10);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<StandardBenchmarkImportResponse | null>(null);
  const [comparison, setComparison] = useState<EvalRunComparisonResponse | null>(null);

  const selected = useMemo(
    () => bundle?.workspaces.find((workspace) => workspace.slug === selectedWorkspace),
    [bundle, selectedWorkspace],
  );

  const load = async () => {
    setLoading(true);
    try {
      const workspaces = await fetchWorkspaces();
      const summaries = await Promise.all(workspaces.map(loadWorkspaceSummary));
      setBundle({ workspaces, summaries });
      const nextSelected = selectedWorkspace || workspaces[0]?.slug || '';
      setSelectedWorkspace(nextSelected);
      const nextProfile =
        workspaces.find((workspace) => workspace.slug === nextSelected)?.defaultRetrievalProfile ||
        workspaces[0]?.defaultRetrievalProfile ||
        'default';
      setProfileKey((current) => current || nextProfile);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load benchmarks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionRevision]);

  const importBenchmark = async () => {
    if (!selectedWorkspace) return;

    setActionLoading(true);
    setError(null);
    setComparison(null);
    try {
      const result = await importStandardBenchmark(selectedWorkspace, { profile: 'cpu-mini' });
      setImportResult(result);
      setProfileKey(result.next.profileKey);
      setTopK(result.next.topK);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to import benchmark');
    } finally {
      setActionLoading(false);
    }
  };

  const runOffOnBenchmark = async () => {
    if (!selectedWorkspace) return;

    const effectiveProfile = profileKey.trim() || selected?.defaultRetrievalProfile || 'default';
    setActionLoading(true);
    setError(null);
    setImportResult(null);
    try {
      const baseline = await runRetrievalEval(selectedWorkspace, {
        name: `${STANDARD_DATASET_ID} ${effectiveProfile} reranker off`,
        datasetId: STANDARD_DATASET_ID,
        profileKey: effectiveProfile,
        topK,
        rerank: { enabled: false },
      });
      const candidate = await runRetrievalEval(selectedWorkspace, {
        name: `${STANDARD_DATASET_ID} ${effectiveProfile} reranker on`,
        datasetId: STANDARD_DATASET_ID,
        profileKey: effectiveProfile,
        topK,
        rerank: {
          enabled: true,
          providerName: DEFAULT_RERANKER_PROVIDER,
          topN: 3,
          fallbackAllowed: true,
        },
      });
      setComparison(
        await compareEvalRuns(selectedWorkspace, {
          baselineRunId: baseline.id,
          candidateRunId: candidate.id,
        }),
      );
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to run benchmark pair');
    } finally {
      setActionLoading(false);
    }
  };

  const summaries = bundle?.summaries ?? [];

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Benchmark lab</p>
          <h2>Standard retrieval benchmark</h2>
          <p className="hero-copy">
            Compare retrieval profiles and reranker impact on the shared `cf-standard-benchmark` dataset before enabling
            optional answer generation.
          </p>
        </div>
        <div className="hero-meta">
          <span className="status-pill active">{STANDARD_DATASET_ID}</span>
          <span className="muted-copy">CPU-mini BEIR SciFact pack</span>
        </div>
      </section>

      {error ? (
        <div className="notice-banner">
          <strong>Benchmark error:</strong> {error}
        </div>
      ) : null}

      <SectionCard title="Run benchmark" eyebrow="Workspace comparison">
        {loading && !bundle ? (
          <p className="muted-copy">Loading benchmark state...</p>
        ) : bundle?.workspaces.length ? (
          <div className="playground-form">
            <label className="form-field">
              <span>Workspace</span>
              <select
                value={selectedWorkspace}
                onChange={(event) => {
                  const slug = event.target.value;
                  setSelectedWorkspace(slug);
                  setProfileKey(
                    bundle.workspaces.find((workspace) => workspace.slug === slug)?.defaultRetrievalProfile ||
                      'default',
                  );
                }}
              >
                {bundle.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.slug}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span>Profile</span>
              <input
                value={profileKey}
                placeholder={selected?.defaultRetrievalProfile || 'default'}
                onChange={(event) => setProfileKey(event.target.value)}
              />
            </label>

            <label className="form-field">
              <span>Top K</span>
              <input
                type="number"
                min={1}
                max={50}
                value={topK}
                onChange={(event) => setTopK(Number(event.target.value))}
              />
            </label>

            <div className="playground-actions">
              <button type="button" className="secondary-button" disabled={actionLoading} onClick={importBenchmark}>
                {actionLoading ? 'Working...' : 'Import benchmark'}
              </button>
              <button type="button" className="primary-button" disabled={actionLoading} onClick={runOffOnBenchmark}>
                {actionLoading ? 'Running...' : 'Run off/on pair'}
              </button>
              <button type="button" className="secondary-button" disabled={loading} onClick={load}>
                Refresh leaderboard
              </button>
            </div>
          </div>
        ) : (
          <EmptyState title="No workspaces yet" copy="Create or restore a workspace before running benchmarks." />
        )}

        {importResult ? (
          <div className="notice-banner compact-notice">
            <strong>Import queued:</strong> {importResult.documents} docs, {importResult.questions} questions, indexing
            job {importResult.indexingJob.id.slice(0, 8)}.
          </div>
        ) : null}

        {comparison ? (
          <div className="notice-banner compact-notice">
            <strong>Latest off/on delta:</strong> {formatDelta(comparison.metricDeltas.hitAtK)} hit@K,{' '}
            {formatDelta(comparison.metricDeltas.mrr)} MRR.
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Leaderboard" eyebrow="Saved eval runs">
        {summaries.length ? (
          <div className="benchmark-table-wrap">
            <table className="benchmark-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Questions</th>
                  <th>Best hit@K</th>
                  <th>Best MRR</th>
                  <th>Reranker off</th>
                  <th>Reranker on</th>
                  <th>Latest run</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.workspace.id}>
                    <td>
                      <strong>{summary.workspace.name}</strong>
                      <span>{summary.workspace.slug}</span>
                    </td>
                    <td>{summary.questions}</td>
                    <td>{formatMetric(summary.bestRun?.metrics.hitAtK)}</td>
                    <td>{formatMetric(summary.bestRun?.metrics.mrr)}</td>
                    <td>{runSummary(summary.latestOff)}</td>
                    <td>{runSummary(summary.latestOn)}</td>
                    <td>{formatDateTime(summary.runs[0]?.createdAt ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No benchmark runs yet"
            copy="Import the standard benchmark, wait for indexing, then run an off/on pair."
          />
        )}
      </SectionCard>
    </div>
  );
}

async function loadWorkspaceSummary(workspace: WorkspaceRecord): Promise<BenchmarkWorkspaceSummary> {
  const [questionsResponse, runsResponse] = await Promise.all([
    fetchEvalQuestions(workspace.slug, STANDARD_DATASET_ID).catch(() => ({ questions: [] })),
    fetchEvalRuns(workspace.slug, 50).catch(() => ({ runs: [] })),
  ]);
  const runs = runsResponse.runs
    .filter((run) => run.metrics.datasetId === STANDARD_DATASET_ID)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const bestRun = [...runs].sort(compareRunsByQuality)[0];

  return {
    workspace,
    questions: questionsResponse.questions.length,
    runs,
    latestOff: runs.find((run) => rerankerEnabled(run) === false),
    latestOn: runs.find((run) => rerankerEnabled(run) === true),
    bestRun,
  };
}

function compareRunsByQuality(left: EvalRun, right: EvalRun): number {
  return (
    Number(right.metrics.hitAtK || 0) - Number(left.metrics.hitAtK || 0) ||
    Number(right.metrics.mrr || 0) - Number(left.metrics.mrr || 0)
  );
}

function rerankerEnabled(run: EvalRun): boolean | undefined {
  const config = run.metrics.config as Record<string, any> | undefined;
  const requestRerank = config?.retrieval?.request?.rerank;
  if (requestRerank?.enabled === false) return false;
  if (requestRerank?.enabled === true) return true;
  if (run.metrics.reranker) return true;
  return undefined;
}

function runSummary(run?: EvalRun): string {
  if (!run) return 'none';
  return `${formatMetric(run.metrics.hitAtK)} / ${formatMetric(run.metrics.mrr)}`;
}

function formatMetric(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '-';
}

function formatDelta(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}
