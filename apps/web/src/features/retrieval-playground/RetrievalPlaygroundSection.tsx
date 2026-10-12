import { SectionCard } from '../../components/SectionCard';
import {
  EmptyDebuggerState,
  RerankControls,
  RerankerDiagnosticsPanel,
  TraceList,
} from '../../components/workspace/KnowledgeBasePanels';
import type { KnowledgeBaseDetailResponse } from '../../lib/types';
import type { useRetrievalPlayground } from './useRetrievalPlayground';
import {
  advancedRetrievalProfiles,
  retrievalStageVisibility,
  SIMPLE_RETRIEVAL_PRESETS,
  simplePresetDescription,
} from './retrieval-presets';

type RetrievalPlaygroundState = ReturnType<typeof useRetrievalPlayground>;

export function RetrievalPlaygroundSection({
  detail,
  state,
}: {
  detail: KnowledgeBaseDetailResponse;
  state: RetrievalPlaygroundState;
}) {
  const {
    playgroundQuery,
    setPlaygroundQuery,
    playgroundProfile,
    setPlaygroundProfile,
    playgroundTopK,
    setPlaygroundTopK,
    playgroundTokenBudget,
    setPlaygroundTokenBudget,
    playgroundPathPrefix,
    setPlaygroundPathPrefix,
    playgroundLanguage,
    setPlaygroundLanguage,
    playgroundBranch,
    setPlaygroundBranch,
    playgroundRerankMode,
    setPlaygroundRerankMode,
    playgroundRerankerProvider,
    setPlaygroundRerankerProvider,
    playgroundRerankerTopN,
    setPlaygroundRerankerTopN,
    playgroundRerankerFallbackAllowed,
    setPlaygroundRerankerFallbackAllowed,
    playgroundTrace,
    playgroundError,
    playgroundLoading,
    submitPlayground,
  } = state;
  const advancedProfiles = advancedRetrievalProfiles(detail.retrievalPlayground.profiles).map(({ key, name }) => ({
    key,
    name,
  }));
  const defaultKey =
    detail.retrievalPlayground.defaultProfileKey || detail.knowledgeBase.defaultRetrievalProfile || 'default';
  if (
    !SIMPLE_RETRIEVAL_PRESETS.some((preset) => preset.key === defaultKey) &&
    !advancedProfiles.some((profile) => profile.key === defaultKey)
  ) {
    advancedProfiles.unshift({ key: defaultKey, name: `Workspace default (${defaultKey})` });
  }
  const activePresetDescription = simplePresetDescription(playgroundProfile);
  const trace = playgroundTrace?.trace;
  const stageVisibility = retrievalStageVisibility(trace?.retrievalProfile.key ?? playgroundProfile);
  const showDenseStage = Boolean(trace) && stageVisibility.showDense;
  const showLexicalStage = Boolean(trace) && stageVisibility.showLexical;
  const showFusedStage = Boolean(trace) && stageVisibility.showFused;
  const hasDenseCandidates = Boolean(trace?.stages.denseCandidates.length);
  const hasLexicalCandidates = Boolean(trace?.stages.lexicalCandidates?.length);

  return (
    <SectionCard id="retrieval-playground" title="Retrieval playground" eyebrow="Debugger">
      <form className="playground-form" onSubmit={submitPlayground}>
        <label className="form-field form-field-wide" htmlFor="playground-query">
          <span>Query</span>
          <textarea
            id="playground-query"
            aria-label="Query"
            value={playgroundQuery}
            onChange={(event) => setPlaygroundQuery(event.target.value)}
            rows={3}
            placeholder={detail.retrievalPlayground.suggestedRequest.queryPlaceholder}
          />
        </label>

        <div className="form-field">
          <label htmlFor="playground-profile">Profile</label>
          <select
            id="playground-profile"
            aria-describedby={activePresetDescription ? 'playground-profile-help' : undefined}
            value={playgroundProfile}
            onChange={(event) => setPlaygroundProfile(event.target.value)}
          >
            <optgroup label="Simple presets">
              {SIMPLE_RETRIEVAL_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
            </optgroup>
            {advancedProfiles.length > 0 ? (
              <optgroup label="Advanced profiles">
                {advancedProfiles.map((profile) => (
                  <option key={profile.key} value={profile.key}>
                    {profile.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          {activePresetDescription ? (
            <span id="playground-profile-help" className="muted-copy compact-copy">
              {activePresetDescription}
            </span>
          ) : null}
        </div>

        <label className="form-field">
          <span>Top K</span>
          <input
            type="number"
            min={1}
            max={20}
            value={playgroundTopK}
            onChange={(event) => setPlaygroundTopK(Number(event.target.value))}
          />
        </label>

        <label className="form-field">
          <span>Token budget</span>
          <input
            type="number"
            min={50}
            max={4000}
            step={50}
            value={playgroundTokenBudget}
            onChange={(event) => setPlaygroundTokenBudget(Number(event.target.value))}
          />
        </label>

        <details className="advanced-settings">
          <summary>Advanced retrieval settings</summary>
          <div className="playground-form">
            <label className="form-field">
              <span>Path prefix</span>
              <input
                value={playgroundPathPrefix}
                placeholder="src/"
                onChange={(event) => setPlaygroundPathPrefix(event.target.value)}
              />
            </label>

            <label className="form-field">
              <span>Language</span>
              <input
                value={playgroundLanguage}
                placeholder="typescript"
                onChange={(event) => setPlaygroundLanguage(event.target.value)}
              />
            </label>

            <label className="form-field">
              <span>Branch</span>
              <input
                value={playgroundBranch}
                placeholder="main"
                onChange={(event) => setPlaygroundBranch(event.target.value)}
              />
            </label>

            <RerankControls
              mode={playgroundRerankMode}
              providerName={playgroundRerankerProvider}
              topN={playgroundRerankerTopN}
              fallbackAllowed={playgroundRerankerFallbackAllowed}
              onModeChange={setPlaygroundRerankMode}
              onProviderNameChange={setPlaygroundRerankerProvider}
              onTopNChange={setPlaygroundRerankerTopN}
              onFallbackAllowedChange={setPlaygroundRerankerFallbackAllowed}
              lexicalUnsupported={playgroundProfile === 'lexical' || playgroundProfile.startsWith('lexical-')}
            />
          </div>
        </details>

        <div className="playground-actions">
          <button type="submit" className="primary-button" disabled={playgroundLoading}>
            {playgroundLoading ? 'Running…' : 'Run retrieval trace'}
          </button>
          <p className="muted-copy">
            Collection: {detail.retrievalPlayground.activeCollection?.vectorCollectionName ?? 'No active collection'}
          </p>
        </div>
      </form>

      {playgroundError ? (
        <div className="notice-banner" role="alert" aria-live="assertive">
          <strong>Playground error:</strong> {playgroundError}
        </div>
      ) : null}

      {playgroundTrace ? (
        <div className="page-stack">
          <div className="metric-grid compact">
            <div className="mini-stat">
              <span>Candidate retrieval</span>
              <strong>
                {stageVisibility.showFused || (hasDenseCandidates && hasLexicalCandidates)
                  ? 'Dense + lexical'
                  : stageVisibility.showLexical
                    ? 'Lexical'
                    : 'Dense'}
              </strong>
            </div>
            <div className="mini-stat">
              <span>Filtered</span>
              <strong>{playgroundTrace.trace.diagnostics.filteredCandidates}</strong>
            </div>
            <div className="mini-stat">
              <span>Expanded</span>
              <strong>{playgroundTrace.trace.diagnostics.expandedNeighbors}</strong>
            </div>
            <div className="mini-stat">
              <span>Final package</span>
              <strong>{playgroundTrace.trace.contextPackage.count}</strong>
            </div>
          </div>

          <SectionCard title="Final context package" eyebrow="Agent-facing output">
            <div className="metric-grid compact">
              <div className="mini-stat">
                <span>Estimated tokens</span>
                <strong>{playgroundTrace.trace.contextPackage.budget.estimatedTokens}</strong>
              </div>
              <div className="mini-stat">
                <span>Requested budget</span>
                <strong>{playgroundTrace.trace.contextPackage.budget.requestedTokens ?? 'default'}</strong>
              </div>
            </div>

            <div className="card-stack">
              {playgroundTrace.trace.contextPackage.groups.map((group) => (
                <div key={group.title} className="resource-card">
                  <div className="resource-header">
                    <div>
                      <h3>{group.title}</h3>
                      <p className="muted-copy">{group.kind}</p>
                    </div>
                    <span>{group.items.length} items</span>
                  </div>
                  <TraceList items={group.items} />
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Trace request" eyebrow="Profile and filters">
            <div className="metric-grid compact">
              <div className="mini-stat">
                <span>Profile</span>
                <strong>{playgroundTrace.trace.retrievalProfile.key}</strong>
              </div>
              <div className="mini-stat">
                <span>Intent</span>
                <strong>{playgroundTrace.trace.retrievalProfile.intent}</strong>
              </div>
              <div className="mini-stat">
                <span>Grouping</span>
                <strong>{playgroundTrace.trace.retrievalProfile.grouping}</strong>
              </div>
              <div className="mini-stat">
                <span>Neighbors</span>
                <strong>
                  {playgroundTrace.trace.retrievalProfile.neighborBefore}/
                  {playgroundTrace.trace.retrievalProfile.neighborAfter}
                </strong>
              </div>
              <div className="mini-stat">
                <span>Reranked</span>
                <strong>{playgroundTrace.trace.diagnostics.reranked ? 'yes' : 'no'}</strong>
              </div>
              <div className="mini-stat">
                <span>Rerank source</span>
                <strong>{playgroundTrace.trace.diagnostics.reranker?.source ?? 'none'}</strong>
              </div>
              <div className="mini-stat">
                <span>Rerank candidates</span>
                <strong>{playgroundTrace.trace.diagnostics.rerankerCandidateCount ?? 0}</strong>
              </div>
            </div>
            <RerankerDiagnosticsPanel diagnostics={playgroundTrace.trace.diagnostics} />
            <pre className="trace-text" tabIndex={0} role="region" aria-label="Retrieval request diagnostics">
              {JSON.stringify(
                {
                  request: playgroundTrace.request,
                  appliedFilters: playgroundTrace.trace.appliedFilters ?? {},
                },
                null,
                2,
              )}
            </pre>
          </SectionCard>

          <div className="dashboard-grid">
            {showDenseStage ? (
              <SectionCard title="Dense candidates" eyebrow="Candidate retrieval">
                <TraceList items={playgroundTrace.trace.stages.denseCandidates} />
              </SectionCard>
            ) : null}
            {showLexicalStage ? (
              <SectionCard title="Lexical candidates" eyebrow="Candidate retrieval">
                <TraceList items={playgroundTrace.trace.stages.lexicalCandidates ?? []} />
              </SectionCard>
            ) : null}
            {showFusedStage ? (
              <SectionCard title="Fused candidates" eyebrow="Candidate retrieval">
                <TraceList items={playgroundTrace.trace.stages.mergedCandidates ?? []} />
              </SectionCard>
            ) : null}
            <SectionCard title="Filtered candidates" eyebrow="Stage 2">
              <TraceList items={playgroundTrace.trace.stages.filteredCandidates} />
            </SectionCard>
            <SectionCard title="Deduped candidates" eyebrow="Stage 3">
              <TraceList items={playgroundTrace.trace.stages.dedupedCandidates} />
            </SectionCard>
            {playgroundTrace.trace.stages.rerankedCandidates ? (
              <SectionCard title="Reranked candidates" eyebrow="Stage 4">
                <TraceList items={playgroundTrace.trace.stages.rerankedCandidates} />
              </SectionCard>
            ) : null}
            <SectionCard title="Expanded context" eyebrow="Stage 4">
              <TraceList items={playgroundTrace.trace.stages.expandedCandidates} />
            </SectionCard>
          </div>
        </div>
      ) : (
        <EmptyDebuggerState />
      )}
    </SectionCard>
  );
}
