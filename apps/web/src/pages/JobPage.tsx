import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchJobDetail } from '../lib/api';
import { formatDateTime, formatRelativeDuration } from '../lib/format';
import type { JobDetailResponse } from '../lib/types';
import { SectionCard } from '../components/SectionCard';
import { StatusPill } from '../components/StatusPill';

function isTerminal(status: string) {
  return status === 'succeeded' || status === 'failed';
}

type JobPageProps = {
  connectionRevision?: number;
};

export function JobPage({ connectionRevision = 0 }: JobPageProps) {
  const { jobId } = useParams();
  const [job, setJob] = useState<JobDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    const load = async () => {
      try {
        const response = await fetchJobDetail(jobId);
        if (!cancelled) {
          setJob(response);
          setError(null);
          if (intervalId && isTerminal(response.status)) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load job detail');
        }
      }
    };

    void load();
    intervalId = window.setInterval(() => void load(), 3000);

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [jobId, connectionRevision]);

  if (!jobId) {
    return (
      <SectionCard title="Missing job id" eyebrow="Routing">
        Route parameter is missing.
      </SectionCard>
    );
  }

  if (error && !job) {
    return (
      <SectionCard title="Job unavailable" eyebrow="Queue detail">
        <div className="card-stack">
          <p role="alert">{error}</p>
          <p className="muted-copy">Existing workspace data is unchanged. Return to the dashboard and retry later.</p>
          <p>
            <Link to="/">Back to dashboard</Link>
          </p>
        </div>
      </SectionCard>
    );
  }

  if (!job) {
    return (
      <SectionCard title="Loading job" eyebrow="Queue detail">
        <p role="status" aria-live="polite">
          Fetching indexing job detail...
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Indexing job</p>
          <h2>{job.id}</h2>
          <p className="hero-copy">
            Inspect raw stats and logs without leaving the Studio shell. Active jobs keep polling until they settle.
          </p>
        </div>
        <div className="hero-meta">
          <StatusPill status={job.status} />
          <p>Workspace: {job.knowledgeBaseId}</p>
          <p>Source: {job.sourceId ?? 'None'}</p>
          <p>Duration: {formatRelativeDuration(job.startedAt, job.finishedAt)}</p>
        </div>
      </section>

      {job.status === 'failed' ? (
        <div className="notice-banner" role="alert">
          <strong>Indexing failed.</strong> Inspect the error logs below, restore the provider or correct the source,
          then retry from the workspace Sources section. Check its current serving state before retrieving.
          <p>
            <Link className="secondary-button compact-button" to={`/workspaces/${job.knowledgeBaseId}`}>
              Open workspace to retry
            </Link>
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="notice-banner" role="status" aria-live="polite">
          <strong>Job refresh warning:</strong> {error} Existing workspace data remains available; reload or open the
          workspace to continue.
        </div>
      ) : null}

      <div className="dashboard-grid">
        <SectionCard title="Stats" eyebrow="Progress snapshot">
          <div className="metric-grid compact">
            {Object.entries(job.stats).map(([key, value]) => (
              <div key={key} className="mini-stat">
                <span>{key}</span>
                <strong>{String(value)}</strong>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Timeline" eyebrow="Timestamps">
          <div className="card-stack">
            <div className="resource-card">
              <div className="mini-stat">
                <span>Created</span>
                <strong>{formatDateTime(job.createdAt)}</strong>
              </div>
              <div className="mini-stat">
                <span>Started</span>
                <strong>{formatDateTime(job.startedAt)}</strong>
              </div>
              <div className="mini-stat">
                <span>Finished</span>
                <strong>{formatDateTime(job.finishedAt)}</strong>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Logs" eyebrow="Worker output">
        {job.logs.length === 0 ? (
          <p className="muted-copy">No logs recorded for this job yet.</p>
        ) : (
          <div className="log-list">
            {job.logs.map((entry, index) => (
              <article key={`${entry.at}-${index}`} className={`log-entry ${entry.level}`}>
                <div className="log-header">
                  <strong>{entry.level}</strong>
                  <span>{formatDateTime(entry.at)}</span>
                </div>
                <p>{entry.message}</p>
                {entry.data ? <pre>{JSON.stringify(entry.data, null, 2)}</pre> : null}
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
