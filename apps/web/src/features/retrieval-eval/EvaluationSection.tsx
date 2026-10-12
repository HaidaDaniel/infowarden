import { SIMPLE_RETRIEVAL_PRESETS } from '../retrieval-playground/retrieval-presets';
import { SectionCard } from '../../components/SectionCard';
import { StatusPill } from '../../components/StatusPill';
import {
  EvalMetricsGrid,
  EvalQuestionList,
  EvalRunConfigSummary,
  EvalRunList,
  ProfileComparisonSummary,
  RerankControls,
  RunComparisonSummary,
} from '../../components/workspace/KnowledgeBasePanels';
import type { JobStatus, KnowledgeBaseDetailResponse } from '../../lib/types';
import type { useRetrievalEvaluation } from './useRetrievalEvaluation';

type EvaluationState = ReturnType<typeof useRetrievalEvaluation>;

export function EvaluationSection({ detail, state }: { detail: KnowledgeBaseDetailResponse; state: EvaluationState }) {
  const {
    evalDatasetId,
    setEvalDatasetId,
    evalProfile,
    setEvalProfile,
    evalCompareProfileA,
    setEvalCompareProfileA,
    evalCompareProfileB,
    setEvalCompareProfileB,
    evalTopK,
    setEvalTopK,
    evalRerankMode,
    setEvalRerankMode,
    evalRerankerProvider,
    setEvalRerankerProvider,
    evalRerankerTopN,
    setEvalRerankerTopN,
    evalRerankerFallbackAllowed,
    setEvalRerankerFallbackAllowed,
    evalQuestions,
    evalRuns,
    evalLoading,
    evalRunLoading,
    standardBenchmarkLoading,
    standardBenchmarkResult,
    rerankerComparisonLoading,
    evalError,
    setEvalError,
    evalLatestRun,
    setEvalLatestRun,
    profileComparison,
    profileComparisonLoading,
    runComparison,
    runComparisonLoading,
    baselineRunId,
    setBaselineRunId,
    candidateRunId,
    setCandidateRunId,
    refreshEvalData,
    submitStandardBenchmarkImport,
    submitEvalRun,
    submitProfileComparison,
    submitRerankerComparison,
    submitRunComparison,
  } = state;

  const defaultKey =
    detail.retrievalPlayground.defaultProfileKey || detail.knowledgeBase.defaultRetrievalProfile || 'default';
  const profiles = [
    ...new Map(
      [
        { key: defaultKey, name: `Workspace default (${defaultKey})` },
        ...detail.retrievalPlayground.profiles,
        ...SIMPLE_RETRIEVAL_PRESETS.map((preset) => ({ key: preset.key, name: preset.label })),
      ].map((profile) => [profile.key, profile]),
    ).values(),
  ];

  return (
    <SectionCard id="evaluation" title="Retrieval evaluation" eyebrow="Pre-LLM gate">
      <div className="dashboard-grid">
        <div className="card-stack">
          <form className="resource-card" onSubmit={submitEvalRun}>
            <div className="resource-header">
              <div>
                <h3>Run deterministic eval</h3>
                <p className="muted-copy">
                  Measure retrieval before enabling optional answer generation for this workspace.
                </p>
              </div>
              {evalLoading ? <span className="muted-copy">Loading...</span> : null}
            </div>

            <div className="playground-form">
              <label className="form-field">
                <span>Dataset</span>
                <input
                  value={evalDatasetId}
                  placeholder="cf-smoke-mini"
                  onChange={(event) => setEvalDatasetId(event.target.value)}
                />
              </label>

              <label className="form-field">
                <span>Profile</span>
                <select value={evalProfile} onChange={(event) => setEvalProfile(event.target.value)}>
                  {profiles.map((profile) => (
                    <option key={profile.key} value={profile.key}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>Top K</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={evalTopK}
                  onChange={(event) => setEvalTopK(Number(event.target.value))}
                />
              </label>

              <RerankControls
                mode={evalRerankMode}
                providerName={evalRerankerProvider}
                topN={evalRerankerTopN}
                fallbackAllowed={evalRerankerFallbackAllowed}
                onModeChange={setEvalRerankMode}
                onProviderNameChange={setEvalRerankerProvider}
                onTopNChange={setEvalRerankerTopN}
                onFallbackAllowedChange={setEvalRerankerFallbackAllowed}
              />

              <div className="playground-actions">
                <button type="submit" className="primary-button" disabled={evalRunLoading}>
                  {evalRunLoading ? 'Running...' : 'Run eval'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={standardBenchmarkLoading}
                  onClick={submitStandardBenchmarkImport}
                >
                  {standardBenchmarkLoading ? 'Importing...' : 'Import standard benchmark'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={rerankerComparisonLoading}
                  onClick={submitRerankerComparison}
                >
                  {rerankerComparisonLoading ? 'Comparing...' : 'Compare reranker off/on'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={evalLoading}
                  onClick={() => {
                    setEvalError(null);
                    refreshEvalData().catch((loadError) =>
                      setEvalError(loadError instanceof Error ? loadError.message : 'Failed to refresh eval data'),
                    );
                  }}
                >
                  Refresh eval data
                </button>
              </div>
            </div>

            {standardBenchmarkResult ? (
              <div className="notice-banner compact-notice" role="status">
                <strong>Standard benchmark ready:</strong> {standardBenchmarkResult.documents} docs,{' '}
                {standardBenchmarkResult.questions} questions, job {standardBenchmarkResult.indexingJob.id.slice(0, 8)}.
              </div>
            ) : null}

            {evalError ? (
              <div className="notice-banner compact-notice" role="alert">
                <strong>Eval error:</strong> {evalError}
              </div>
            ) : null}
          </form>

          <div className="resource-card">
            <div className="resource-header">
              <div>
                <h3>Eval questions</h3>
                <p className="muted-copy">
                  {evalQuestions.length} questions loaded for {evalDatasetId || 'all datasets'}.
                </p>
              </div>
            </div>
            <EvalQuestionList questions={evalQuestions} />
          </div>
        </div>

        <div className="card-stack">
          <div className="resource-card">
            <div className="resource-header">
              <div>
                <h3>Latest run</h3>
                <p className="muted-copy">{evalLatestRun?.name ?? 'No eval run has completed yet.'}</p>
              </div>
              {evalLatestRun ? <StatusPill status={evalLatestRun.status as JobStatus} /> : null}
            </div>
            {evalLatestRun ? (
              <>
                <EvalMetricsGrid metrics={evalLatestRun.metrics} />
                <EvalRunConfigSummary run={evalLatestRun} />
              </>
            ) : (
              <p className="muted-copy">Run an eval or select saved runs to compare.</p>
            )}
          </div>

          <div className="resource-card">
            <div className="resource-header">
              <div>
                <h3>Recent eval runs</h3>
                <p className="muted-copy">Saved run metrics and config hashes from the backend.</p>
              </div>
            </div>
            <EvalRunList runs={evalRuns} onSelect={(run) => setEvalLatestRun(run)} />
          </div>
        </div>
      </div>

      <div className="dashboard-grid eval-comparison-grid">
        <div className="resource-card">
          <div className="resource-header">
            <div>
              <h3>Profile comparison</h3>
              <p className="muted-copy">Runs the same dataset against two retrieval profiles.</p>
            </div>
          </div>

          <div className="source-refresh-grid">
            <label className="form-field">
              <span>Baseline profile</span>
              <select value={evalCompareProfileA} onChange={(event) => setEvalCompareProfileA(event.target.value)}>
                {profiles.map((profile) => (
                  <option key={profile.key} value={profile.key}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span>Candidate profile</span>
              <select value={evalCompareProfileB} onChange={(event) => setEvalCompareProfileB(event.target.value)}>
                {profiles.map((profile) => (
                  <option key={profile.key} value={profile.key}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="playground-actions source-refresh-actions">
            <button
              type="button"
              className="secondary-button compact-button"
              disabled={profileComparisonLoading}
              onClick={submitProfileComparison}
            >
              {profileComparisonLoading ? 'Comparing...' : 'Compare profiles'}
            </button>
          </div>

          {profileComparison ? <ProfileComparisonSummary comparison={profileComparison} /> : null}
        </div>

        <div className="resource-card">
          <div className="resource-header">
            <div>
              <h3>Saved run comparison</h3>
              <p className="muted-copy">Compare metric deltas and config hashes for benchmark runs.</p>
            </div>
          </div>

          <div className="source-refresh-grid">
            <label className="form-field">
              <span>Baseline run</span>
              <select value={baselineRunId} onChange={(event) => setBaselineRunId(event.target.value)}>
                <option value="">Select baseline</option>
                {evalRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span>Candidate run</span>
              <select value={candidateRunId} onChange={(event) => setCandidateRunId(event.target.value)}>
                <option value="">Select candidate</option>
                {evalRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="playground-actions source-refresh-actions">
            <button
              type="button"
              className="secondary-button compact-button"
              disabled={runComparisonLoading || evalRuns.length < 2}
              onClick={submitRunComparison}
            >
              {runComparisonLoading ? 'Comparing...' : 'Compare saved runs'}
            </button>
          </div>

          {runComparison ? <RunComparisonSummary comparison={runComparison} /> : null}
        </div>
      </div>
    </SectionCard>
  );
}
