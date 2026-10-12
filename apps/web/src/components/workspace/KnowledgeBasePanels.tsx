import { Link } from 'react-router-dom';
import { StatusPill } from '../StatusPill';
import { formatDateTime } from '../../lib/format';
import type {
  EvalProfileComparisonResponse,
  EvalQuestion,
  EvalRun,
  EvalRunComparisonResponse,
  JobStatus,
  KnowledgeBaseSource,
  RerankRequest,
  RetrievalTraceResponse,
  SourcePolicyResponse,
  SourceRefreshMode,
  SourceRefreshPlan,
  SourceSyncPolicy,
  SourceSyncTriggerMode,
  WorkspaceExportManifest,
} from '../../lib/types';

export type SourceRefreshAction = 'dryRun' | 'refresh';
export type RerankMode = 'profile' | 'off' | 'on';

export function buildRerankRequest(
  mode: RerankMode,
  options: { providerName: string; topN: number; fallbackAllowed: boolean },
): RerankRequest | undefined {
  if (mode === 'profile') {
    return undefined;
  }
  if (mode === 'off') {
    return { enabled: false };
  }

  return {
    enabled: true,
    ...(options.providerName.trim() ? { providerName: options.providerName.trim() } : {}),
    topN: Math.max(1, Math.floor(options.topN || 1)),
    fallbackAllowed: options.fallbackAllowed,
  };
}

export function RerankControls({
  mode,
  providerName,
  topN,
  fallbackAllowed,
  lexicalUnsupported,
  onModeChange,
  onProviderNameChange,
  onTopNChange,
  onFallbackAllowedChange,
}: {
  mode: RerankMode;
  providerName: string;
  topN: number;
  fallbackAllowed: boolean;
  lexicalUnsupported?: boolean;
  onModeChange: (mode: RerankMode) => void;
  onProviderNameChange: (providerName: string) => void;
  onTopNChange: (topN: number) => void;
  onFallbackAllowedChange: (fallbackAllowed: boolean) => void;
}) {
  const overrideEnabled = mode === 'on';

  return (
    <>
      <label className="form-field">
        <span>Reranker mode</span>
        <select value={mode} onChange={(event) => onModeChange(event.target.value as RerankMode)}>
          <option value="profile">Profile default</option>
          <option value="off">Off</option>
          <option value="on" disabled={lexicalUnsupported}>
            {lexicalUnsupported ? 'On override (unsupported for lexical)' : 'On override'}
          </option>
        </select>
      </label>

      <label className="form-field">
        <span>Reranker provider</span>
        <input
          value={providerName}
          disabled={!overrideEnabled}
          placeholder="local-cpu-reranker"
          onChange={(event) => onProviderNameChange(event.target.value)}
        />
      </label>

      <label className="form-field">
        <span>Rerank top N</span>
        <input
          type="number"
          min={1}
          max={50}
          disabled={!overrideEnabled}
          value={topN}
          onChange={(event) => onTopNChange(Number(event.target.value))}
        />
      </label>

      <label className="form-field">
        <span>Reranker fallback</span>
        <select
          value={fallbackAllowed ? 'allowed' : 'strict'}
          disabled={!overrideEnabled}
          onChange={(event) => onFallbackAllowedChange(event.target.value === 'allowed')}
        >
          <option value="allowed">Allowed</option>
          <option value="strict">Strict</option>
        </select>
      </label>
    </>
  );
}

export function RerankerDiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: RetrievalTraceResponse['trace']['diagnostics'];
}) {
  const reranker = diagnostics.reranker;
  if (!reranker && !diagnostics.rerankerFallbackUsed && !diagnostics.rerankerReason) {
    return <p className="muted-copy compact-copy">Reranker policy resolved to no reranker for this trace.</p>;
  }

  return (
    <div className="trace-card">
      <div className="resource-footer">
        <span>Provider {String(reranker?.providerName ?? reranker?.providerId ?? 'n/a')}</span>
        <span>Model {String(reranker?.model ?? 'n/a')}</span>
        <span>Top N {String(reranker?.topN ?? 'profile')}</span>
        <span>Fallback {diagnostics.rerankerFallbackUsed ? 'used' : String(reranker?.fallbackAllowed ?? 'n/a')}</span>
      </div>
      {diagnostics.rerankerReason || reranker?.reason ? (
        <p className="muted-copy compact-copy">Reason: {diagnostics.rerankerReason ?? reranker?.reason}</p>
      ) : null}
    </div>
  );
}

export function EvalQuestionList({ questions }: { questions: EvalQuestion[] }) {
  if (questions.length === 0) {
    return <p className="muted-copy">No eval questions match the current dataset filter.</p>;
  }

  return (
    <div className="card-stack">
      {questions.slice(0, 6).map((question) => (
        <article key={question.id} className="trace-card">
          <div className="resource-header">
            <div>
              <h3>{question.id}</h3>
              <p>{question.text}</p>
            </div>
            <span>{String(question.metadata.datasetId ?? 'dataset')}</span>
          </div>
          <div className="resource-footer">
            <span>Docs: {question.expectedDocumentIds.join(', ') || 'n/a'}</span>
            <span>Chunks: {question.expectedChunkIds.length || 0}</span>
          </div>
        </article>
      ))}
      {questions.length > 6 ? (
        <p className="muted-copy compact-copy">{questions.length - 6} more questions hidden.</p>
      ) : null}
    </div>
  );
}

export function EvalMetricsGrid({ metrics }: { metrics: EvalRun['metrics'] }) {
  return (
    <div className="metric-grid compact">
      <Metric label="hit@k" value={formatMetric(metrics.hitAtK)} />
      <Metric label="MRR" value={formatMetric(metrics.mrr)} />
      <Metric label="Doc hit" value={formatMetric(metrics.expectedDocumentHitRate)} />
      <Metric label="Chunk hit" value={formatMetric(metrics.expectedChunkHitRate)} />
      <Metric label="Empty" value={formatMetric(metrics.emptyResultRate)} />
      <Metric label="Duplicate" value={formatMetric(metrics.duplicateRate)} />
      <Metric label="p50 ms" value={formatLatency(metrics.latencyMs?.p50)} />
      <Metric label="p95 ms" value={formatLatency(metrics.latencyMs?.p95)} />
      <Metric label="RR Δ" value={formatSignedMetric(metrics.reranker?.meanReciprocalRankDelta)} />
      <Metric label="Top changed" value={formatMetric(metrics.reranker?.changedTopRate)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function EvalRunConfigSummary({ run }: { run: EvalRun }) {
  const config = run.metrics.config as Record<string, unknown> | undefined;
  const index = asRecord(config?.index);
  const retrieval = asRecord(config?.retrieval);
  const providers = asRecord(config?.providers);
  const reranker = asRecord(providers.reranker);
  const rerankerRequest = asRecord(asRecord(retrieval.request).rerank);

  return (
    <div className="trace-card">
      <div className="resource-footer">
        <span>Run {run.id}</span>
        <span>Profile {String(run.metrics.profileKey ?? retrieval.profileKey ?? 'n/a')}</span>
        <span>Questions {run.metrics.questionCount ?? 'n/a'}</span>
      </div>
      <div className="resource-footer">
        <span>Config {shortHash(run.metrics.configHash)}</span>
        <span>Index {String(index.id ?? run.indexVersionId)}</span>
        <span>Model {String(index.embeddingModel ?? 'n/a')}</span>
      </div>
      {Object.keys(reranker).length || Object.keys(rerankerRequest).length ? (
        <div className="resource-footer">
          <span>Reranker {String(reranker.enabled ?? rerankerRequest.enabled ?? 'profile')}</span>
          <span>{String(reranker.providerName ?? reranker.providerId ?? 'profile')}</span>
          <span>Top N {String(reranker.topN ?? rerankerRequest.topN ?? 'profile')}</span>
          <span>Source {String(reranker.source ?? 'profile')}</span>
        </div>
      ) : null}
    </div>
  );
}

export function EvalRunList({ runs, onSelect }: { runs: EvalRun[]; onSelect: (run: EvalRun) => void }) {
  if (runs.length === 0) {
    return <p className="muted-copy">No eval runs found for this workspace.</p>;
  }

  return (
    <div className="card-stack">
      {runs.slice(0, 5).map((run) => (
        <button key={run.id} type="button" className="resource-card interactive" onClick={() => onSelect(run)}>
          <div className="resource-header">
            <div>
              <h3>{run.name}</h3>
              <p className="muted-copy">
                {run.metrics.profileKey ?? 'profile'} · {formatDateTime(run.finishedAt ?? run.createdAt)}
              </p>
            </div>
            <StatusPill status={run.status as JobStatus} />
          </div>
          <div className="resource-footer">
            <span>hit@k {formatMetric(run.metrics.hitAtK)}</span>
            <span>MRR {formatMetric(run.metrics.mrr)}</span>
            <span>p95 {formatLatency(run.metrics.latencyMs?.p95)} ms</span>
            <span>{shortHash(run.metrics.configHash)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export function ProfileComparisonSummary({ comparison }: { comparison: EvalProfileComparisonResponse }) {
  return (
    <div className="card-stack">
      {comparison.summary.map((summary, index) => (
        <article key={summary.runId} className="trace-card">
          <div className="resource-header">
            <div>
              <h3>{String(summary.profileKey ?? `run ${index + 1}`)}</h3>
              <p className="muted-copy">{summary.runId}</p>
            </div>
            <span>{index === 0 ? 'baseline' : 'candidate'}</span>
          </div>
          <EvalMetricsGrid metrics={summary.metrics} />
          {index > 0 ? <DeltaList deltas={summary.deltasFromBaseline ?? {}} /> : null}
        </article>
      ))}
    </div>
  );
}

export function RunComparisonSummary({ comparison }: { comparison: EvalRunComparisonResponse }) {
  return (
    <div className="card-stack">
      <div className="trace-card">
        <div className="resource-footer">
          <span>Baseline {comparison.baselineRunId}</span>
          <span>Candidate {comparison.candidateRunId}</span>
          <span>Config changed: {comparison.config.changed ? 'yes' : 'no'}</span>
        </div>
        <div className="resource-footer">
          <span>{shortHash(String(comparison.config.baselineHash ?? ''))}</span>
          <span>{shortHash(String(comparison.config.candidateHash ?? ''))}</span>
        </div>
      </div>
      <DeltaList deltas={comparison.metricDeltas} />
      {comparison.perQuestionDeltas.length ? (
        <div className="trace-card">
          <h3>Question deltas</h3>
          <ul className="compact-list">
            {comparison.perQuestionDeltas.slice(0, 5).map((item) => (
              <li key={item.evalQuestionId}>
                {item.evalQuestionId}: {formatDeltaMap(item.deltas)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DeltaList({ deltas }: { deltas: Record<string, number> }) {
  const entries = Object.entries(deltas);
  if (entries.length === 0) {
    return <p className="muted-copy compact-copy">No numeric metric deltas available.</p>;
  }

  return (
    <div className="metric-grid compact">
      {entries.slice(0, 8).map(([key, value]) => (
        <Metric key={key} label={`Δ ${key}`} value={formatSignedMetric(value)} />
      ))}
    </div>
  );
}

export function formatMetric(value: unknown) {
  return typeof value === 'number' ? value.toFixed(3) : 'n/a';
}

function formatSignedMetric(value: unknown) {
  if (typeof value !== 'number') {
    return 'n/a';
  }
  const formatted = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(3);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatLatency(value: unknown) {
  return typeof value === 'number' ? value.toFixed(1) : 'n/a';
}

function shortHash(value?: string) {
  return value ? value.slice(0, 12) : 'no hash';
}

function formatDeltaMap(deltas: Record<string, number>) {
  const entries = Object.entries(deltas);
  if (entries.length === 0) {
    return 'no deltas';
  }
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key} ${formatSignedMetric(value)}`)
    .join(', ');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function SourceRefreshControls({
  source,
  mode,
  reason,
  loading,
  error,
  plan,
  job,
  onModeChange,
  onReasonChange,
  onDryRun,
  onRefresh,
}: {
  source: KnowledgeBaseSource;
  mode: SourceRefreshMode;
  reason: string;
  loading: SourceRefreshAction | null;
  error: string | null;
  plan: SourceRefreshPlan | null;
  job: { id: string; mode: SourceRefreshMode } | null;
  onModeChange: (mode: SourceRefreshMode) => void;
  onReasonChange: (reason: string) => void;
  onDryRun: () => void;
  onRefresh: () => void;
}) {
  const isBusy = Boolean(loading);

  return (
    <div className="source-refresh-panel">
      <div className="resource-header">
        <div>
          <h3>Refresh source</h3>
          <p className="muted-copy compact-copy">
            Update this {source.type} source through the backend source lifecycle route.
          </p>
        </div>
        {job ? <Link to={`/jobs/${job.id}`}>Open refresh job {job.id}</Link> : null}
      </div>

      <div className="source-refresh-grid">
        <label className="form-field">
          <span>Refresh mode</span>
          <select
            aria-label={`Refresh mode for ${source.uri}`}
            value={mode}
            onChange={(event) => onModeChange(event.target.value as SourceRefreshMode)}
            disabled={isBusy}
          >
            <option value="incremental">Incremental</option>
            <option value="force_reembed">Force re-embed</option>
            <option value="force_rechunk">Force re-chunk</option>
            <option value="rebuild_collection">Rebuild collection</option>
          </select>
        </label>

        <label className="form-field source-refresh-reason">
          <span>Reason</span>
          <input
            value={reason}
            placeholder="after git pull or dataset update"
            onChange={(event) => onReasonChange(event.target.value)}
            disabled={isBusy}
          />
        </label>
      </div>

      {mode === 'rebuild_collection' ? (
        <div className="notice-banner compact-notice" role="status">
          <strong>Explicit rebuild:</strong> this mode regenerates vectors and removes stale serving data. Preview the
          plan before running it on shared workspaces.
        </div>
      ) : null}

      <div className="playground-actions source-refresh-actions">
        <button type="button" className="secondary-button compact-button" disabled={isBusy} onClick={onDryRun}>
          {loading === 'dryRun' ? 'Previewing...' : 'Preview dry-run'}
        </button>
        <button type="button" className="primary-button compact-button" disabled={isBusy} onClick={onRefresh}>
          {loading === 'refresh' ? 'Starting...' : 'Start refresh'}
        </button>
        {error ? (
          <span className="error-copy" role="alert">
            {error}
          </span>
        ) : null}
        {job ? (
          <span className="success-copy" role="status">
            Queued {job.mode} refresh.
          </span>
        ) : null}
      </div>

      {plan ? <SourceRefreshPlanPreview plan={plan} /> : null}
    </div>
  );
}

export function SourcePolicyControls({
  source,
  policy,
  draft,
  loading,
  error,
  success,
  onDraftChange,
  onSave,
}: {
  source: KnowledgeBaseSource;
  policy: SourcePolicyResponse | null;
  draft: SourceSyncPolicy;
  loading: boolean;
  error: string | null;
  success: string | null;
  onDraftChange: (policy: SourceSyncPolicy) => void;
  onSave: () => void;
}) {
  const updateDraft = (patch: Partial<SourceSyncPolicy>) => {
    onDraftChange({ ...draft, ...patch });
  };

  return (
    <div className="source-refresh-panel source-policy-panel">
      <div className="resource-header">
        <div>
          <h3>Source policy</h3>
          <p className="muted-copy compact-copy">
            Truth is read-only. Studio only controls refresh triggers and refresh mode.
          </p>
        </div>
        <span className="status-pill active">read only</span>
      </div>

      <div className="metric-grid compact">
        <div className="mini-stat">
          <span>Truth</span>
          <strong>{policy?.sourceTruthPolicy.truthMode ?? 'read_only'}</strong>
        </div>
        <div className="mini-stat">
          <span>Writes</span>
          <strong>{policy?.sourceTruthPolicy.writePolicy ?? 'disabled'}</strong>
        </div>
        <div className="mini-stat">
          <span>Auto refresh</span>
          <strong>{policy?.autoRefreshEnabled ? 'on' : 'off'}</strong>
        </div>
        <div className="mini-stat">
          <span>Next trigger</span>
          <strong>{formatDateTime(policy?.nextTriggerAt ?? null)}</strong>
        </div>
      </div>

      <div className="source-refresh-grid source-policy-grid">
        <label className="form-field checkbox-field">
          <span>Enabled</span>
          <input
            aria-label={`Enable auto refresh for ${source.uri}`}
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => updateDraft({ enabled: event.target.checked })}
            disabled={loading}
          />
        </label>

        <label className="form-field">
          <span>Trigger</span>
          <select
            aria-label={`Source trigger for ${source.uri}`}
            value={draft.triggerMode}
            onChange={(event) => updateDraft({ triggerMode: event.target.value as SourceSyncTriggerMode })}
            disabled={loading}
          >
            <option value="manual">Manual</option>
            <option value="schedule">Schedule</option>
            <option value="webhook">Webhook</option>
            <option value="watch">Watch</option>
          </select>
        </label>

        <label className="form-field">
          <span>Refresh mode</span>
          <select
            aria-label={`Policy refresh mode for ${source.uri}`}
            value={draft.mode}
            onChange={(event) => updateDraft({ mode: event.target.value as SourceRefreshMode })}
            disabled={loading}
          >
            <option value="incremental">Incremental</option>
            <option value="force_reembed">Force re-embed</option>
            <option value="force_rechunk">Force re-chunk</option>
            <option value="rebuild_collection">Rebuild collection</option>
          </select>
        </label>

        <label className="form-field">
          <span>Schedule</span>
          <input
            value={draft.schedule ?? ''}
            placeholder="5m, 1h, every 1d"
            onChange={(event) => updateDraft({ schedule: event.target.value })}
            disabled={loading}
          />
        </label>

        <label className="form-field">
          <span>Watch debounce ms</span>
          <input
            type="number"
            min={250}
            max={300000}
            value={draft.watchDebounceMs ?? ''}
            onChange={(event) =>
              updateDraft({
                watchDebounceMs: event.target.value ? Number(event.target.value) : undefined,
              })
            }
            disabled={loading}
          />
        </label>

        <label className="form-field source-refresh-reason">
          <span>Reason</span>
          <input
            value={draft.reason ?? ''}
            placeholder="daily vault sync"
            onChange={(event) => updateDraft({ reason: event.target.value })}
            disabled={loading}
          />
        </label>
      </div>

      <div className="playground-actions source-refresh-actions">
        <button type="button" className="secondary-button compact-button" disabled={loading} onClick={onSave}>
          {loading ? 'Saving...' : 'Save policy'}
        </button>
        {error ? (
          <span className="error-copy" role="alert">
            {error}
          </span>
        ) : null}
        {success ? (
          <span className="success-copy" role="status">
            {success}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SourceRefreshPlanPreview({ plan }: { plan: SourceRefreshPlan }) {
  const stats = plan.plan.stats;

  return (
    <div className="trace-card source-refresh-plan">
      <div className="resource-header">
        <div>
          <h3>Dry-run preview</h3>
          <p className="muted-copy compact-copy">
            No documents, chunks, vectors, or active index pointers were mutated.
          </p>
        </div>
        <span>{plan.mode}</span>
      </div>

      <div className="metric-grid compact">
        <div className="mini-stat">
          <span>Added</span>
          <strong>{stats.added ?? plan.plan.addedPaths.length}</strong>
        </div>
        <div className="mini-stat">
          <span>Changed</span>
          <strong>{stats.changed ?? plan.plan.changedPaths.length}</strong>
        </div>
        <div className="mini-stat">
          <span>Deleted</span>
          <strong>{stats.deleted ?? plan.plan.deletedPaths.length}</strong>
        </div>
        <div className="mini-stat">
          <span>Unchanged</span>
          <strong>{stats.unchanged ?? plan.plan.unchangedCount}</strong>
        </div>
        <div className="mini-stat">
          <span>Parsed</span>
          <strong>{stats.filesParsed ?? 'n/a'}</strong>
        </div>
        <div className="mini-stat">
          <span>Warnings</span>
          <strong>{plan.plan.validationIssues.length}</strong>
        </div>
      </div>

      <div className="dashboard-grid source-refresh-paths">
        <PathPreview title="Added paths" paths={plan.plan.addedPaths} emptyLabel="No added paths." />
        <PathPreview title="Changed paths" paths={plan.plan.changedPaths} emptyLabel="No changed paths." />
        <PathPreview title="Deleted paths" paths={plan.plan.deletedPaths} emptyLabel="No deleted paths." />
        <div className="trace-card">
          <h3>Dependency hints</h3>
          {plan.plan.dependencyHints.length === 0 ? (
            <p className="muted-copy compact-copy">No dependency hints.</p>
          ) : (
            <ul className="compact-list">
              {plan.plan.dependencyHints.slice(0, 5).map((hint) => (
                <li key={hint.path}>
                  {hint.path}: {hint.dependsOn.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {plan.plan.validationIssues.length ? (
        <div className="notice-banner compact-notice" role="status">
          <strong>Validation issues:</strong>
          <ul className="compact-list">
            {plan.plan.validationIssues.slice(0, 5).map((issue, index) => (
              <li key={`${issue.code ?? 'issue'}-${index}`}>
                {issue.code ? `${issue.code}: ` : ''}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PathPreview({ title, paths, emptyLabel }: { title: string; paths: string[]; emptyLabel: string }) {
  return (
    <div className="trace-card">
      <h3>{title}</h3>
      {paths.length === 0 ? (
        <p className="muted-copy compact-copy">{emptyLabel}</p>
      ) : (
        <ul className="compact-list">
          {paths.slice(0, 6).map((path) => (
            <li key={path}>{path}</li>
          ))}
          {paths.length > 6 ? <li>{paths.length - 6} more...</li> : null}
        </ul>
      )}
    </div>
  );
}

export type MemoryEntryView = {
  id: string;
  entryType: string;
  title?: string | null;
  summary?: string | null;
  body: string;
  tags: string[];
  authoredBy?: string | null;
  sessionId?: string | null;
  occurredAt?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
  score?: number;
};

export function MemoryEntryList({ entries, showScore = false }: { entries: MemoryEntryView[]; showScore?: boolean }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="card-stack memory-entry-list">
      {entries.map((entry) => (
        <article key={entry.id} className="resource-card trace-card">
          <div className="resource-header">
            <div>
              <h3>{entry.title || entry.entryType}</h3>
              <p className="muted-copy">
                {entry.entryType}
                {entry.authoredBy ? ` · ${entry.authoredBy}` : ''}
                {entry.sessionId ? ` · session ${entry.sessionId}` : ''}
              </p>
            </div>
            <span>{formatDateTime(entry.occurredAt ?? entry.createdAt)}</span>
          </div>

          {entry.summary ? <p>{entry.summary}</p> : null}
          <pre className="trace-text" tabIndex={0} role="group" aria-label="Scrollable content and provenance">
            {entry.body}
          </pre>

          <div className="resource-footer">
            <span>{entry.tags.length ? `Tags: ${entry.tags.join(', ')}` : 'No tags'}</span>
            {showScore && typeof entry.score === 'number' ? <span>Score {entry.score.toFixed(2)}</span> : null}
          </div>

          {entry.metadata && Object.keys(entry.metadata).length > 0 ? (
            <pre className="trace-text" tabIndex={0} role="group" aria-label="Scrollable content and provenance">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function TraceList({ items }: { items: RetrievalTraceResponse['trace']['stages']['denseCandidates'] }) {
  if (items.length === 0) {
    return <p className="muted-copy">No items at this stage.</p>;
  }

  return (
    <div className="card-stack">
      {items.map((item) => (
        <article key={`${item.chunkId}-${item.score}`} className="resource-card trace-card">
          <div className="resource-header">
            <div>
              <h3>{item.path ?? item.documentId}</h3>
              <p className="muted-copy">
                Score {item.score.toFixed(3)}
                {item.language ? ` · ${item.language}` : ''}
                {item.startLine || item.endLine ? ` · lines ${item.startLine ?? '?'}-${item.endLine ?? '?'}` : ''}
              </p>
            </div>
            <span>{item.tokenCount ?? 'n/a'} tok</span>
          </div>
          <div className="resource-footer">
            <span>Document: {item.documentId}</span>
            <span>Chunk: {item.chunkId}</span>
            {item.sourceId ? <span>Source: {item.sourceId}</span> : null}
            {item.metadata.sourceRevisionId ? (
              <span>Source revision: {String(item.metadata.sourceRevisionId)}</span>
            ) : null}
            {item.metadata.workspaceServingRevisionId ? (
              <span>Serving revision: {String(item.metadata.workspaceServingRevisionId)}</span>
            ) : null}
            {item.branch ? <span>Branch: {item.branch}</span> : null}
            {item.commit ? <span>Commit: {item.commit}</span> : null}
            {item.metadata.rerankerScore !== undefined ? (
              <span>Reranker: {String(item.metadata.rerankerScore)}</span>
            ) : null}
            {item.metadata.originalRank !== undefined ? (
              <span>Original rank: {String(item.metadata.originalRank)}</span>
            ) : null}
          </div>
          <pre className="trace-text" tabIndex={0} role="group" aria-label="Scrollable content and provenance">
            {item.text}
          </pre>
          {Object.keys(item.metadata).length > 0 ? (
            <details>
              <summary>Chunk metadata</summary>
              <pre className="trace-text" tabIndex={0} role="group" aria-label="Chunk metadata">
                {JSON.stringify(item.metadata, null, 2)}
              </pre>
            </details>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function splitTags(rawTags: string) {
  return rawTags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function ManifestSummary({ manifest }: { manifest: WorkspaceExportManifest }) {
  return (
    <div className="card-stack">
      <div className="metric-grid compact">
        <div className="mini-stat">
          <span>Format</span>
          <strong>{manifest.formatVersion}</strong>
        </div>
        <div className="mini-stat">
          <span>Exported</span>
          <strong>{formatDateTime(manifest.exportedAt)}</strong>
        </div>
        <div className="mini-stat">
          <span>Sources</span>
          <strong>{manifest.counts.sources}</strong>
        </div>
        <div className="mini-stat">
          <span>Documents</span>
          <strong>{manifest.counts.documents}</strong>
        </div>
        <div className="mini-stat">
          <span>Chunks</span>
          <strong>{manifest.counts.chunks}</strong>
        </div>
        <div className="mini-stat">
          <span>Restore mode</span>
          <strong>{manifest.restorePlan.mode}</strong>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="trace-card">
          <h3>Included metadata</h3>
          <ul className="compact-list">
            {manifest.exportScope.includes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="trace-card">
          <h3>Excluded data</h3>
          <ul className="compact-list">
            {manifest.exportScope.excludes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="notice-banner">
        <strong>Restore is plan-only:</strong> Studio can inspect this manifest, but import and destructive restore
        actions are not implemented yet.
      </div>

      {manifest.restorePlan.sourceWarnings.length ? (
        <div className="card-stack">
          <h3>Source restore warnings</h3>
          {manifest.restorePlan.sourceWarnings.map((warning) => (
            <div key={`${warning.type}-${warning.uri}`} className="trace-card">
              <div className="resource-footer">
                <span>{warning.type}</span>
                <span>{warning.uri}</span>
              </div>
              <p className="muted-copy">{warning.message}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="card-stack">
        <h3>Recommended restore steps</h3>
        <ol className="compact-list">
          {manifest.restorePlan.recommendedSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function EmptyDebuggerState() {
  return (
    <div className="empty-state">
      <h3>No retrieval trace yet</h3>
      <p className="muted-copy">
        Run a query to inspect dense candidates, expanded neighbors, and the final context package.
      </p>
    </div>
  );
}
