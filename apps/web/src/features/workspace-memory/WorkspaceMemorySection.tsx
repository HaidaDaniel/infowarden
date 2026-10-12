import { SectionCard } from '../../components/SectionCard';
import { MemoryEntryList } from '../../components/workspace/KnowledgeBasePanels';
import type { MemoryEntryType } from '../../lib/types';
import type { MemoryFormKind, useWorkspaceMemory } from './useWorkspaceMemory';

type WorkspaceMemoryState = ReturnType<typeof useWorkspaceMemory>;

export function WorkspaceMemorySection({ state }: { state: WorkspaceMemoryState }) {
  const {
    memoryEntries,
    recentDecisions,
    memoryLoading,
    memoryError,
    memoryFilterType,
    setMemoryFilterType,
    memoryFilterTag,
    setMemoryFilterTag,
    memoryFilterSessionId,
    setMemoryFilterSessionId,
    memorySearchQuery,
    setMemorySearchQuery,
    memorySearchResults,
    memorySearchLoading,
    memorySearchError,
    memoryFormKind,
    setMemoryFormKind,
    memoryTitle,
    setMemoryTitle,
    memoryBody,
    setMemoryBody,
    memorySummary,
    setMemorySummary,
    memoryTags,
    setMemoryTags,
    memoryAuthoredBy,
    setMemoryAuthoredBy,
    memorySessionId,
    setMemorySessionId,
    memoryCreateLoading,
    memoryCreateError,
    memoryCreateSuccess,
    setMemoryCreateError,
    setMemoryCreateSuccess,
    submitMemorySearch,
    submitMemoryEntry,
  } = state;

  return (
    <SectionCard id="memory" title="Memory workspace" eyebrow="Agent notes">
      <div className="dashboard-grid">
        <div className="card-stack">
          <div className="resource-card">
            <div className="resource-header">
              <div>
                <h3>Add memory entry</h3>
                <p className="muted-copy">
                  Save a fact, decision, or session summary through the workspace memory API.
                </p>
              </div>
              {memoryCreateSuccess ? (
                <span className="success-copy" role="status">
                  {memoryCreateSuccess}
                </span>
              ) : null}
            </div>

            <form className="playground-form memory-form" onSubmit={submitMemoryEntry}>
              <label className="form-field">
                <span>Type</span>
                <select
                  value={memoryFormKind}
                  onChange={(event) => {
                    setMemoryFormKind(event.target.value as MemoryFormKind);
                    setMemoryCreateError(null);
                    setMemoryCreateSuccess(null);
                  }}
                >
                  <option value="fact">Fact</option>
                  <option value="decision">Decision</option>
                  <option value="session_summary">Session summary</option>
                </select>
              </label>

              <label className="form-field">
                <span>Title</span>
                <input
                  value={memoryTitle}
                  placeholder={memoryFormKind === 'decision' ? 'Required for decisions' : 'Optional title'}
                  onChange={(event) => setMemoryTitle(event.target.value)}
                />
              </label>

              <label className="form-field">
                <span>Authored by</span>
                <input
                  value={memoryAuthoredBy}
                  placeholder="agent or operator"
                  onChange={(event) => setMemoryAuthoredBy(event.target.value)}
                />
              </label>

              <label className="form-field">
                <span>Session ID</span>
                <input
                  value={memorySessionId}
                  placeholder={memoryFormKind === 'session_summary' ? 'Required' : 'Optional'}
                  onChange={(event) => setMemorySessionId(event.target.value)}
                />
              </label>

              <label className="form-field form-field-wide">
                <span>Body</span>
                <textarea
                  value={memoryBody}
                  rows={4}
                  placeholder="What should the agent remember?"
                  onChange={(event) => setMemoryBody(event.target.value)}
                />
              </label>

              <label className="form-field form-field-wide">
                <span>Summary</span>
                <input
                  value={memorySummary}
                  placeholder="Short optional summary"
                  onChange={(event) => setMemorySummary(event.target.value)}
                />
              </label>

              <label className="form-field form-field-wide">
                <span>Tags</span>
                <input
                  value={memoryTags}
                  placeholder="comma,separated,tags"
                  onChange={(event) => setMemoryTags(event.target.value)}
                />
              </label>

              <div className="playground-actions">
                <button type="submit" className="primary-button" disabled={memoryCreateLoading}>
                  {memoryCreateLoading ? 'Saving...' : 'Save memory entry'}
                </button>
                {memoryCreateError ? (
                  <span className="error-copy" role="alert">
                    {memoryCreateError}
                  </span>
                ) : null}
              </div>
            </form>
          </div>

          <div className="resource-card">
            <div className="resource-header">
              <div>
                <h3>Search memory</h3>
                <p className="muted-copy">
                  Runs backend memory retrieval instead of rebuilding MCP search behavior in Studio.
                </p>
              </div>
            </div>

            <form className="playground-form memory-form" onSubmit={submitMemorySearch}>
              <label className="form-field form-field-wide">
                <span>Query</span>
                <input
                  value={memorySearchQuery}
                  placeholder="Find relevant decisions, facts, or session notes"
                  onChange={(event) => setMemorySearchQuery(event.target.value)}
                />
              </label>
              <div className="playground-actions">
                <button type="submit" className="secondary-button" disabled={memorySearchLoading}>
                  {memorySearchLoading ? 'Searching...' : 'Search memory'}
                </button>
                {memorySearchError ? (
                  <span className="error-copy" role="alert">
                    {memorySearchError}
                  </span>
                ) : null}
              </div>
            </form>

            {memorySearchResults ? (
              <div className="card-stack">
                <p className="muted-copy compact-copy">
                  {memorySearchResults.count} results via {memorySearchResults.retrievalProfile.key}
                </p>
                <MemoryEntryList entries={memorySearchResults.results} showScore />
              </div>
            ) : (
              <p className="muted-copy compact-copy">No memory search has been run yet.</p>
            )}
          </div>
        </div>

        <div className="card-stack">
          <div className="resource-card">
            <div className="resource-header">
              <div>
                <h3>Memory entries</h3>
                <p className="muted-copy">
                  Entry type, title, summary, tags, author, session, and timestamps are shown from the workspace memory
                  API.
                </p>
              </div>
              {memoryLoading ? <span className="muted-copy">Loading...</span> : null}
            </div>

            <div className="memory-filter-row">
              <label className="form-field">
                <span>Entry type</span>
                <select
                  value={memoryFilterType}
                  onChange={(event) => setMemoryFilterType(event.target.value as MemoryEntryType | '')}
                >
                  <option value="">All</option>
                  <option value="fact">Fact</option>
                  <option value="decision">Decision</option>
                  <option value="session_summary">Session summary</option>
                  <option value="runbook">Runbook</option>
                  <option value="infra_note">Infra note</option>
                  <option value="deployment_note">Deployment note</option>
                  <option value="benchmark_result">Benchmark result</option>
                  <option value="incident_note">Incident note</option>
                </select>
              </label>

              <label className="form-field">
                <span>Tag</span>
                <input
                  value={memoryFilterTag}
                  placeholder="ops"
                  onChange={(event) => setMemoryFilterTag(event.target.value)}
                />
              </label>

              <label className="form-field">
                <span>Session</span>
                <input
                  value={memoryFilterSessionId}
                  placeholder="session id"
                  onChange={(event) => setMemoryFilterSessionId(event.target.value)}
                />
              </label>
            </div>

            {memoryError ? (
              <div className="notice-banner" role="alert">
                <strong>Memory unavailable:</strong> {memoryError}
              </div>
            ) : null}

            {!memoryError && memoryEntries.length === 0 ? (
              <p className="muted-copy">No memory entries match the current filters.</p>
            ) : null}

            <MemoryEntryList entries={memoryEntries} />
          </div>

          <div className="resource-card">
            <div className="resource-header">
              <div>
                <h3>Recent decisions</h3>
                <p className="muted-copy">Latest decision notes from backend recent-decisions.</p>
              </div>
            </div>

            {recentDecisions.length === 0 ? (
              <p className="muted-copy">No decision notes have been saved for this workspace yet.</p>
            ) : (
              <MemoryEntryList entries={recentDecisions} />
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
