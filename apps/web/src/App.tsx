import { FormEvent, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { getApiBaseUrl, getStoredApiKey, setStoredApiKey } from './lib/api';
import { DashboardPage } from './pages/DashboardPage';
import { BenchmarksPage } from './pages/BenchmarksPage';
import { ImportPage } from './pages/ImportPage';
import { JobPage } from './pages/JobPage';
import { AskPage } from './pages/AskPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';

export function App() {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [apiKeyDraft, setApiKeyDraft] = useState(() => getStoredApiKey());
  const [connectionRevision, setConnectionRevision] = useState(0);

  const saveApiKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextApiKey = apiKeyDraft.trim();
    setStoredApiKey(nextApiKey);
    setApiKey(nextApiKey);
    setConnectionRevision((revision) => revision + 1);
  };

  const clearApiKey = () => {
    setStoredApiKey('');
    setApiKey('');
    setApiKeyDraft('');
    setConnectionRevision((revision) => revision + 1);
  };

  return (
    <div className="studio-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="studio-sidebar">
        <div className="brand-block">
          <p className="brand-kicker">InfoWarden</p>
          <h1>Studio</h1>
          <p className="brand-copy">
            Watch indexing work, inspect workspaces, and keep an eye on retrieval health without dropping back to raw
            curl or Swagger.
          </p>
        </div>

        <nav className="studio-nav" aria-label="Studio navigation">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Dashboard
          </NavLink>
          <NavLink to="/import" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Import
          </NavLink>
          <NavLink to="/benchmarks" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Benchmarks
          </NavLink>
        </nav>

        <details className="connection-card">
          <summary>Connection settings</summary>
          <span className="connection-label">API</span>
          <code>{getApiBaseUrl()}</code>
          <form className="connection-form" onSubmit={saveApiKey}>
            <label className="form-field">
              <span>Admin API key</span>
              <input
                type="password"
                value={apiKeyDraft}
                placeholder="Optional shared key"
                autoComplete="off"
                onChange={(event) => setApiKeyDraft(event.target.value)}
              />
            </label>
            <div className="connection-actions">
              <button type="submit" className="primary-button compact-button">
                {apiKey ? 'Update key' : 'Save key'}
              </button>
              {apiKey ? (
                <button type="button" className="secondary-button compact-button" onClick={clearApiKey}>
                  Clear
                </button>
              ) : null}
            </div>
            <p className="muted-copy compact-copy" role="status">
              {apiKey ? 'Key saved locally for this browser.' : 'No API key configured.'}
            </p>
          </form>
        </details>
      </aside>

      <main id="main-content" className="studio-main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<DashboardPage connectionRevision={connectionRevision} />} />
          <Route path="/import" element={<ImportPage connectionRevision={connectionRevision} />} />
          <Route path="/benchmarks" element={<BenchmarksPage connectionRevision={connectionRevision} />} />
          <Route
            path="/knowledge-bases/:identifier"
            element={<KnowledgeBasePage connectionRevision={connectionRevision} />}
          />
          <Route
            path="/workspaces/:identifier"
            element={<KnowledgeBasePage connectionRevision={connectionRevision} />}
          />
          <Route path="/workspaces/:identifier/ask" element={<AskPage connectionRevision={connectionRevision} />} />
          <Route path="/jobs/:jobId" element={<JobPage connectionRevision={connectionRevision} />} />
        </Routes>
      </main>
    </div>
  );
}
