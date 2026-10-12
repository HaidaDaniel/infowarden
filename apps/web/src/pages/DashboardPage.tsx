import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { JobProgress } from '../components/JobProgress';
import { SectionCard } from '../components/SectionCard';
import { StatusPill } from '../components/StatusPill';
import { fetchDashboard, fetchKnowledgeBases, fetchRecentJobs } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { DashboardResponse, KnowledgeBaseListResponse, RecentJobsResponse } from '../lib/types';

type DashboardBundle = {
  dashboard: DashboardResponse;
  knowledgeBases: KnowledgeBaseListResponse;
  jobs: RecentJobsResponse;
};

type DashboardPageProps = {
  connectionRevision?: number;
};

export function DashboardPage({ connectionRevision = 0 }: DashboardPageProps) {
  const [bundle, setBundle] = useState<DashboardBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [dashboard, knowledgeBases, jobs] = await Promise.all([
          fetchDashboard(),
          fetchKnowledgeBases(),
          fetchRecentJobs(8),
        ]);

        if (!cancelled) {
          setBundle({ dashboard, knowledgeBases, jobs });
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    const intervalId = window.setInterval(() => void load(), 8000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [connectionRevision]);

  if (loading && !bundle) {
    return <DashboardSkeleton />;
  }

  if (error && !bundle) {
    return (
      <SectionCard title="Dashboard unavailable" eyebrow="Admin read models">
        <p role="alert">{error}</p>
      </SectionCard>
    );
  }

  const dashboard = bundle?.dashboard;
  const knowledgeBases = bundle?.knowledgeBases.knowledgeBases ?? [];
  const jobs = bundle?.jobs.jobs ?? [];
  const system = dashboard?.system;

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Operational snapshot</p>
          <h2>Studio dashboard for your context workspaces</h2>
          <p className="hero-copy">
            Watch workspaces, indexing pressure, and retrieval coverage in one place. Data is refreshed every few
            seconds so active jobs surface without manual refreshes.
          </p>
        </div>
        <div className="metric-grid">
          <div className="hero-stat">
            <span>Workspaces</span>
            <strong>{dashboard?.totals.knowledgeBases ?? 0}</strong>
          </div>
          <div className="hero-stat">
            <span>Sources</span>
            <strong>{dashboard?.totals.sources ?? 0}</strong>
          </div>
          <div className="hero-stat">
            <span>Documents</span>
            <strong>{dashboard?.totals.documents ?? 0}</strong>
          </div>
          <div className="hero-stat">
            <span>Active indexes</span>
            <strong>{dashboard?.totals.activeIndexes ?? 0}</strong>
          </div>
          <div className="hero-stat">
            <span>Queue pressure</span>
            <strong>{system?.queue.pressure ?? 'idle'}</strong>
          </div>
        </div>
      </section>

      {error ? (
        <div className="notice-banner" role="status" aria-live="polite">
          <strong>Refresh warning:</strong> {error}
        </div>
      ) : null}

      <div className="dashboard-grid">
        <SectionCard title="System health" eyebrow="Dependencies">
          <div className="card-stack">
            <div className="metric-grid compact">
              {Object.entries(system?.health.services ?? {}).map(([name, status]) => (
                <div key={name} className="mini-stat">
                  <span>{name}</span>
                  <strong>{status.status}</strong>
                  {'error' in status && status.error ? <p className="muted-copy compact-copy">{status.error}</p> : null}
                </div>
              ))}
            </div>
            <div className="metric-grid compact">
              <div className="mini-stat">
                <span>Queued</span>
                <strong>{system?.queue.queued ?? 0}</strong>
              </div>
              <div className="mini-stat">
                <span>Running</span>
                <strong>{system?.queue.running ?? 0}</strong>
              </div>
              <div className="mini-stat">
                <span>Succeeded / hour</span>
                <strong>{system?.queue.succeededLastHour ?? 0}</strong>
              </div>
              <div className="mini-stat">
                <span>Failed / day</span>
                <strong>{system?.queue.failedLast24Hours ?? 0}</strong>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Workspaces" eyebrow="Coverage">
          {knowledgeBases.length === 0 ? (
            <EmptyState
              title="No workspaces yet"
              copy="Create and index a workspace source first. The dashboard will begin filling in once the API has context to monitor."
              action={
                <Link to="/import" className="primary-button">
                  Import your first workspace
                </Link>
              }
            />
          ) : (
            <div className="card-stack">
              {knowledgeBases.map((knowledgeBase) => (
                <Link
                  key={knowledgeBase.id}
                  to={`/workspaces/${knowledgeBase.slug}`}
                  className="resource-card interactive"
                >
                  <div className="resource-header">
                    <div>
                      <h3>{knowledgeBase.name}</h3>
                      <p className="muted-copy">{knowledgeBase.description ?? knowledgeBase.slug}</p>
                    </div>
                    <StatusPill status={knowledgeBase.lastJobStatus} />
                  </div>

                  <div className="metric-grid compact">
                    <div className="mini-stat">
                      <span>Sources</span>
                      <strong>{knowledgeBase.counts.sources}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Active sources</span>
                      <strong>{knowledgeBase.counts.activeSources}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Documents</span>
                      <strong>{knowledgeBase.counts.documents}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Jobs</span>
                      <strong>{knowledgeBase.counts.jobs}</strong>
                    </div>
                  </div>

                  <div className="resource-footer">
                    <span>Last success: {formatDateTime(knowledgeBase.lastSuccessfulIndexAt)}</span>
                    {knowledgeBase.lastErrorSummary ? (
                      <span className="error-copy">{knowledgeBase.lastErrorSummary.message}</span>
                    ) : (
                      <span className="muted-copy">No recent failure signal</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent indexing jobs" eyebrow="Live queue">
          {jobs.length === 0 ? (
            <EmptyState
              title="No indexing jobs yet"
              copy="Bootstrap or enqueue a source scan and the queue timeline will appear here with progress and failure details."
            />
          ) : (
            <div className="card-stack">
              {jobs.map((job) => (
                <Link key={job.id} to={`/jobs/${job.id}`} className="resource-card interactive">
                  <div className="resource-header">
                    <div>
                      <h3>{job.knowledgeBase.name}</h3>
                      <p className="muted-copy">{job.source?.uri ?? 'Workspace-level job'}</p>
                    </div>
                    <StatusPill status={job.status} />
                  </div>

                  <JobProgress progress={job.progress} />

                  <div className="resource-footer">
                    <span>Created: {formatDateTime(job.createdAt)}</span>
                    {job.lastErrorSummary ? (
                      <span className="error-copy">{job.lastErrorSummary.message}</span>
                    ) : (
                      <span className="muted-copy">No error log</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Active collections" eyebrow="Serving materialization">
          {system?.collections.items.length ? (
            <div className="card-stack">
              <div className="metric-grid compact">
                <div className="mini-stat">
                  <span>Collections</span>
                  <strong>{system.collections.totalActiveCollections}</strong>
                </div>
                <div className="mini-stat">
                  <span>Total chunks</span>
                  <strong>{system.collections.totalChunks}</strong>
                </div>
              </div>

              {system.collections.items.map((collection) => (
                <Link
                  key={collection.indexVersionId}
                  to={`/workspaces/${collection.knowledgeBaseSlug}`}
                  className="resource-card interactive"
                >
                  <div className="resource-header">
                    <div>
                      <h3>{collection.knowledgeBaseName}</h3>
                      <p className="muted-copy">{collection.vectorCollectionName}</p>
                    </div>
                    <StatusPill status={collection.workspaceKind} />
                  </div>

                  <div className="metric-grid compact">
                    <div className="mini-stat">
                      <span>Chunks</span>
                      <strong>{collection.chunkCount}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Mode</span>
                      <strong>{collection.materializationMode}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Embedding</span>
                      <strong>{collection.embeddingModel}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Dimension</span>
                      <strong>{collection.embeddingDimension}</strong>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No active collections"
              copy="Build an index to make the serving materialization visible here."
            />
          )}
        </SectionCard>

        <SectionCard title="Workspace mix" eyebrow="Kinds">
          {Object.keys(system?.workspaceKinds ?? {}).length ? (
            <div className="metric-grid compact">
              {Object.entries(system?.workspaceKinds ?? {}).map(([kind, count]) => (
                <div key={kind} className="mini-stat">
                  <span>{kind}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No workspace kinds yet"
              copy="Workspace kind counts will appear once workspaces are registered."
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="page-stack">
      <section className="hero-card skeleton">
        <div className="skeleton-line wide" />
        <div className="metric-grid">
          <div className="hero-stat skeleton-box" />
          <div className="hero-stat skeleton-box" />
          <div className="hero-stat skeleton-box" />
          <div className="hero-stat skeleton-box" />
        </div>
      </section>
    </div>
  );
}
