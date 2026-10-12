import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { JobProgress } from '../components/JobProgress';
import { SectionCard } from '../components/SectionCard';
import { StatusPill } from '../components/StatusPill';
import {
  createWorkspace,
  enqueueIndexingJob,
  fetchJobDetail,
  fetchKnowledgeBases,
  uploadWorkspaceSource,
} from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import type {
  JobDetailResponse,
  JobProgress as JobProgressShape,
  KnowledgeBaseCard,
  ManagedUploadSourceResponse,
  WorkspaceKind,
  WorkspaceRecord,
} from '../lib/types';

type ImportMode = 'existing' | 'new';

type ImportPageProps = {
  connectionRevision?: number;
};

const WORKSPACE_KINDS: WorkspaceKind[] = [
  'datasets',
  'docs',
  'codebase',
  'general',
  'agent_memory',
  'ops_context',
  'personal_work_history',
  'benchmarks',
  'contracts',
  'custom',
];

export function ImportPage({ connectionRevision = 0 }: ImportPageProps) {
  const [workspaces, setWorkspaces] = useState<KnowledgeBaseCard[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('existing');
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [workspaceDescription, setWorkspaceDescription] = useState('');
  const [workspaceKind, setWorkspaceKind] = useState<WorkspaceKind>('datasets');
  const [sourceName, setSourceName] = useState('');
  const [includeRules, setIncludeRules] = useState('["**/*.md","**/*.txt","**/*.json","**/*.ts"]');
  const [excludeRules, setExcludeRules] = useState('["node_modules/**","tmp/**","dist/**"]');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [createdWorkspace, setCreatedWorkspace] = useState<WorkspaceRecord | null>(null);
  const [uploadResult, setUploadResult] = useState<ManagedUploadSourceResponse | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobDetailResponse | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadWorkspaces = async () => {
      setWorkspaceLoading(true);
      try {
        const response = await fetchKnowledgeBases();
        if (!cancelled) {
          setWorkspaces(response.knowledgeBases);
          setSelectedWorkspace((current) => current || response.knowledgeBases[0]?.slug || '');
          setWorkspaceError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError(error instanceof Error ? error.message : 'Failed to load workspaces');
        }
      } finally {
        if (!cancelled) {
          setWorkspaceLoading(false);
        }
      }
    };

    void loadWorkspaces();

    return () => {
      cancelled = true;
    };
  }, [connectionRevision]);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    const loadJob = async () => {
      try {
        const response = await fetchJobDetail(jobId);
        if (!cancelled) {
          setJob(response);
          setJobError(null);
          if (isTerminalJob(response.status) && intervalId) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch (error) {
        if (!cancelled) {
          setJobError(error instanceof Error ? error.message : 'Failed to load import job');
        }
      }
    };

    void loadJob();
    intervalId = window.setInterval(() => void loadJob(), 3000);

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [jobId]);

  const selectedWorkspaceRecord = useMemo(
    () => workspaces.find((workspace) => workspace.slug === selectedWorkspace || workspace.id === selectedWorkspace),
    [selectedWorkspace, workspaces],
  );

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setImportError(null);
  };

  const submitImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!file) {
      setImportError('Choose a dataset file or ZIP archive first.');
      return;
    }

    if (mode === 'existing' && !selectedWorkspace) {
      setImportError('Choose an existing workspace or switch to creating a new one.');
      return;
    }

    if (mode === 'new' && !workspaceName.trim()) {
      setImportError('Workspace name is required when creating a new workspace.');
      return;
    }

    setSubmitting(true);
    setImportError(null);
    setCreatedWorkspace(null);
    setUploadResult(null);
    setJobId(null);
    setJob(null);
    setJobError(null);

    try {
      const workspace =
        mode === 'new'
          ? await createWorkspace({
              name: workspaceName.trim(),
              slug: workspaceSlug.trim() || undefined,
              description: workspaceDescription.trim() || undefined,
              workspaceKind,
            })
          : null;
      const identifier = workspace?.slug || selectedWorkspace;
      const upload = await uploadWorkspaceSource(identifier, {
        file,
        includeRules,
        excludeRules,
        sourceName,
      });
      const job = await enqueueIndexingJob({
        knowledgeBaseId: upload.next.enqueueIndexing.body.knowledgeBaseId,
        sourceId: upload.next.enqueueIndexing.body.sourceId,
        type: 'scan_source',
      });

      setCreatedWorkspace(workspace);
      setUploadResult(upload);
      setJobId(job.id);
      const initialJob = await fetchJobDetail(job.id);
      setJob(initialJob);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to import dataset');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Managed import</p>
          <h2>Upload a dataset into a workspace</h2>
          <p className="hero-copy">
            Create or reuse a workspace, upload one text-like file or ZIP archive, and start the normal indexing job
            from Studio.
          </p>
        </div>
        <div className="hero-meta">
          <p>Storage is managed by the API.</p>
          <p>Indexing progress polls from the job read model.</p>
        </div>
      </section>

      <div className="dashboard-grid import-grid">
        <SectionCard title="Import dataset" eyebrow="Upload wizard">
          <form className="playground-form import-form" onSubmit={submitImport}>
            <label className="form-field">
              <span>Workspace action</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}>
                <option value="existing">Reuse existing workspace</option>
                <option value="new">Create new workspace</option>
              </select>
            </label>

            {mode === 'existing' ? (
              <label className="form-field form-field-wide">
                <span>Existing workspace</span>
                <select
                  value={selectedWorkspace}
                  disabled={workspaceLoading || workspaces.length === 0}
                  onChange={(event) => setSelectedWorkspace(event.target.value)}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.slug}>
                      {workspace.name} ({workspace.slug})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="form-field">
                  <span>Name</span>
                  <input
                    value={workspaceName}
                    placeholder="Research Docs"
                    onChange={(event) => setWorkspaceName(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Slug</span>
                  <input
                    value={workspaceSlug}
                    placeholder="Optional"
                    onChange={(event) => setWorkspaceSlug(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Kind</span>
                  <select
                    value={workspaceKind}
                    onChange={(event) => setWorkspaceKind(event.target.value as WorkspaceKind)}
                  >
                    {WORKSPACE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field form-field-wide">
                  <span>Description</span>
                  <input
                    value={workspaceDescription}
                    placeholder="Optional workspace description"
                    onChange={(event) => setWorkspaceDescription(event.target.value)}
                  />
                </label>
              </>
            )}

            <label className="form-field form-field-wide">
              <span>Dataset file or ZIP</span>
              <input
                type="file"
                accept=".zip,.md,.markdown,.txt,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.xml,.yaml,.yml,.toml,.sql,.sh"
                onChange={onFileChange}
              />
            </label>

            <label className="form-field form-field-wide">
              <span>Source name</span>
              <input
                value={sourceName}
                placeholder="Optional label for this import"
                onChange={(event) => setSourceName(event.target.value)}
              />
            </label>

            <label className="form-field form-field-wide">
              <span>Include rules</span>
              <textarea rows={3} value={includeRules} onChange={(event) => setIncludeRules(event.target.value)} />
            </label>

            <label className="form-field form-field-wide">
              <span>Exclude rules</span>
              <textarea rows={3} value={excludeRules} onChange={(event) => setExcludeRules(event.target.value)} />
            </label>

            <div className="playground-actions">
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? 'Importing...' : 'Upload and start indexing'}
              </button>
              {importError ? (
                <span className="error-copy" role="alert">
                  {importError} Existing workspace data is unchanged; check the file and settings, then try again.
                </span>
              ) : null}
              {workspaceError ? (
                <span className="error-copy" role="alert">
                  {workspaceError} Reload the page to retry loading available workspaces.
                </span>
              ) : null}
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Import status" eyebrow="Backend state">
          <div className="card-stack">
            <div className="resource-card">
              <div className="resource-header">
                <div>
                  <h3>Workspace</h3>
                  <p className="muted-copy">
                    {createdWorkspace
                      ? `${createdWorkspace.name} (${createdWorkspace.slug})`
                      : selectedWorkspaceRecord
                        ? `${selectedWorkspaceRecord.name} (${selectedWorkspaceRecord.slug})`
                        : 'No workspace selected yet.'}
                  </p>
                </div>
                {createdWorkspace ? <StatusPill status={createdWorkspace.workspaceKind} /> : null}
              </div>
            </div>

            {uploadResult ? <UploadResultCard uploadResult={uploadResult} /> : null}

            {jobId ? (
              <div className="resource-card">
                <div className="resource-header">
                  <div>
                    <h3>Indexing job</h3>
                    <p className="muted-copy">{jobId}</p>
                  </div>
                  {job ? <StatusPill status={job.status} /> : null}
                </div>
                {job ? <JobProgress progress={progressFromJob(job)} /> : <p>Waiting for job detail...</p>}
                <div className="resource-footer">
                  <Link to={`/jobs/${jobId}`}>Open job detail</Link>
                  {jobError ? (
                    <span className="error-copy" role="alert">
                      {jobError} The import remains recorded; reload or open the job detail to retry the status check.
                    </span>
                  ) : null}
                  {job?.finishedAt ? <span>Finished {formatDateTime(job.finishedAt)}</span> : null}
                </div>
              </div>
            ) : (
              <p className="muted-copy">Upload a dataset to create a managed source and enqueue indexing.</p>
            )}

            {job?.logs.length ? (
              <div className="log-list">
                {job.logs.slice(-4).map((entry, index) => (
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
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function UploadResultCard({ uploadResult }: { uploadResult: ManagedUploadSourceResponse }) {
  return (
    <div className="resource-card">
      <div className="resource-header">
        <div>
          <h3>Managed source</h3>
          <p className="muted-copy">{uploadResult.source.uri}</p>
        </div>
        <StatusPill status={uploadResult.source.status} />
      </div>
      <div className="metric-grid compact">
        <div className="mini-stat">
          <span>Archive</span>
          <strong>{uploadResult.upload.archiveFormat}</strong>
        </div>
        <div className="mini-stat">
          <span>Files</span>
          <strong>{uploadResult.upload.fileCount}</strong>
        </div>
        <div className="mini-stat">
          <span>Upload size</span>
          <strong>{formatBytes(uploadResult.upload.sizeBytes)}</strong>
        </div>
        <div className="mini-stat">
          <span>Extracted</span>
          <strong>{formatBytes(uploadResult.upload.contentBytes)}</strong>
        </div>
      </div>
      <div className="resource-footer">
        <span>{uploadResult.upload.originalFileName}</span>
        <span>{formatDateTime(uploadResult.upload.uploadedAt)}</span>
      </div>
    </div>
  );
}

function progressFromJob(job: JobDetailResponse): JobProgressShape {
  const stats = job.stats;
  return {
    added: numberOrNull(stats.added),
    changed: numberOrNull(stats.changed),
    deleted: numberOrNull(stats.deleted),
    unchanged: numberOrNull(stats.unchanged),
    filesScanned: numberOrNull(stats.filesScanned),
    filesParsed: numberOrNull(stats.filesParsed),
    filesIgnored: numberOrNull(stats.filesIgnored),
    parseFailures: numberOrNull(stats.parseFailures),
    chunksCreated: numberOrNull(stats.chunksCreated),
    chunksDeleted: numberOrNull(stats.chunksDeleted),
    chunksReused: numberOrNull(stats.chunksReused),
    vectorsDeleted: numberOrNull(stats.vectorsDeleted),
    vectorsUpserted: numberOrNull(stats.vectorsUpserted),
    payloadsUpdated: numberOrNull(stats.payloadsUpdated),
    documentsCreated: numberOrNull(stats.documentsCreated),
    documentsChanged: numberOrNull(stats.documentsChanged),
    documentsDeleted: numberOrNull(stats.documentsDeleted),
    documentsSkipped: numberOrNull(stats.documentsSkipped),
    validationReportId: typeof stats.validationReportId === 'string' ? stats.validationReportId : null,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function isTerminalJob(status: string) {
  return status === 'succeeded' || status === 'failed';
}
