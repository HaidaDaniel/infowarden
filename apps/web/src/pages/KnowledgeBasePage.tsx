import { Link, useParams } from 'react-router-dom';
import { JobProgress } from '../components/JobProgress';
import { SectionCard } from '../components/SectionCard';
import { StatusPill } from '../components/StatusPill';
import { VectorBackendOperationsPanel, WorkspaceResourcePanel } from '../components/workspace/ResourcePanels';
import {
  ManifestSummary,
  SourcePolicyControls,
  SourceRefreshControls,
} from '../components/workspace/KnowledgeBasePanels';
import { getApiBaseUrl } from '../lib/api';
import { useWorkspaceDetail } from '../features/workspace-detail/useWorkspaceDetail';
import { useRetrievalPlayground } from '../features/retrieval-playground/useRetrievalPlayground';
import { RetrievalPlaygroundSection } from '../features/retrieval-playground/RetrievalPlaygroundSection';
import { useRetrievalEvaluation } from '../features/retrieval-eval/useRetrievalEvaluation';
import { EvaluationSection } from '../features/retrieval-eval/EvaluationSection';
import { useWorkspaceMemory } from '../features/workspace-memory/useWorkspaceMemory';
import { WorkspaceMemorySection } from '../features/workspace-memory/WorkspaceMemorySection';
import { useWorkspaceResources } from '../features/workspace-resources/useWorkspaceResources';
import { useWorkspaceExport } from '../features/workspace-resources/useWorkspaceExport';
import { useVectorOperations } from '../features/vector-operations/useVectorOperations';
import { useSourceManagement } from '../features/source-management/useSourceManagement';
import { formatBytes, formatDateTime } from '../lib/format';

type KnowledgeBasePageProps = {
  connectionRevision?: number;
};

export function KnowledgeBasePage({ connectionRevision = 0 }: KnowledgeBasePageProps) {
  const { identifier } = useParams();

  const workspaceDetail = useWorkspaceDetail(identifier, connectionRevision);
  const {
    detail,
    error,
    sourcePolicies,
    sourcePolicyErrors,
    setSourcePolicies,
    setSourcePolicyErrors: setWorkspaceSourcePolicyErrors,
    reloadDetail,
  } = workspaceDetail;
  const retrievalPlayground = useRetrievalPlayground(identifier, detail);
  const retrievalEvaluation = useRetrievalEvaluation(identifier, connectionRevision, detail);
  const memory = useWorkspaceMemory(identifier, connectionRevision);
  const resources = useWorkspaceResources(identifier, connectionRevision);
  const {
    resourceStatus,
    resourceLoading,
    resourceActionLoading,
    resourceError,
    reloadResourceStatus,
    handleWorkspaceLifecycle,
  } = resources;
  const exportState = useWorkspaceExport(identifier, connectionRevision);
  const { exportManifest, exportManifestError, exportManifestLoading } = exportState;
  const vectorOperations = useVectorOperations(identifier, connectionRevision, reloadResourceStatus);
  const {
    vectorBackends,
    vectorPlacement,
    vectorOpsLoading,
    vectorOpsAction,
    vectorOpsError,
    targetBackendId,
    setTargetBackendId,
    handleVectorOperation,
  } = vectorOperations;
  const sourceManagement = useSourceManagement(
    identifier,
    detail?.knowledgeBase ?? null,
    sourcePolicies,
    setSourcePolicies,
    setWorkspaceSourcePolicyErrors,
    reloadDetail,
  );
  const {
    sourceRefreshReasons,
    sourceRefreshLoading,
    sourceRefreshErrors,
    sourceRefreshPlans,
    sourceRefreshJobs,
    sourcePolicyLoading,
    sourcePolicySuccess,
    obsidianVaultUri,
    setObsidianVaultUri,
    obsidianCreateLoading,
    obsidianCreateError,
    obsidianCreateSuccess,
    getSourceRefreshMode,
    getSourcePolicyDraft,
    setSourcePolicyDrafts,
    setSourcePolicyErrors,
    setSourcePolicySuccess,
    setSourceRefreshErrors,
    setSourceRefreshModes,
    setSourceRefreshReasons,
    saveSourcePolicy,
    submitObsidianSource,
    runSourceRefresh,
  } = sourceManagement;
  if (!identifier) {
    return (
      <SectionCard title="Missing workspace" eyebrow="Routing">
        Route parameter is missing.
      </SectionCard>
    );
  }

  if (error && !detail) {
    return (
      <SectionCard title="Workspace unavailable" eyebrow="Admin detail">
        <p role="alert">{error}</p>
      </SectionCard>
    );
  }

  if (!detail) {
    return (
      <SectionCard title="Loading workspace" eyebrow="Admin detail">
        <p role="status">Fetching workspace overview...</p>
      </SectionCard>
    );
  }

  const knowledgeBase = detail.knowledgeBase;
  const exportManifestUrl = `${getApiBaseUrl()}/workspaces/${knowledgeBase.slug}/export-manifest`;
  const recentFailures = detail.recentJobs.filter((job) => job.status === 'failed' || job.lastErrorSummary);

  const downloadManifest = () => {
    if (!exportManifest) {
      return;
    }

    const blob = new Blob([JSON.stringify(exportManifest, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${knowledgeBase.slug}-workspace-export-manifest.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Workspace detail</p>
          <h2>{knowledgeBase.name}</h2>
          <p className="hero-copy">{knowledgeBase.description ?? knowledgeBase.slug}</p>
          <div className="button-row">
            <Link className="secondary-button compact-button" to={`/workspaces/${knowledgeBase.slug}/ask`}>
              Open Ask playground
            </Link>
          </div>
        </div>
        <div className="metric-grid">
          <div className="hero-stat">
            <span>Sources</span>
            <strong>{knowledgeBase.counts.sources}</strong>
          </div>
          <div className="hero-stat">
            <span>Documents</span>
            <strong>{knowledgeBase.counts.documents}</strong>
          </div>
          <div className="hero-stat">
            <span>Index versions</span>
            <strong>{knowledgeBase.counts.indexVersions}</strong>
          </div>
          <div className="hero-stat">
            <span>Active index</span>
            <strong>{knowledgeBase.activeIndexVersion?.id ?? 'None'}</strong>
          </div>
          <div className="hero-stat">
            <span>Workspace kind</span>
            <strong>{knowledgeBase.workspaceKind}</strong>
          </div>
        </div>
      </section>

      <nav className="workspace-nav" aria-label="Workspace sections">
        <a href="#retrieval-playground">Retrieval</a>
        <a href="#sources">Sources &amp; jobs</a>
        <a href="#documents">Documents</a>
        <a href="#memory">Memory</a>
        <a href="#evaluation">Evaluation</a>
        <a href="#resources">Resources</a>
        <a href="#portability">Export</a>
      </nav>
      <RetrievalPlaygroundSection detail={detail} state={retrievalPlayground} />

      <div className="dashboard-grid">
        <SectionCard id="sources" title="Sources" eyebrow="Source state">
          <div className="card-stack">
            <form className="resource-card source-create-form" onSubmit={submitObsidianSource}>
              <div className="resource-header">
                <div>
                  <h3>Add Obsidian vault</h3>
                  <p className="muted-copy">Register a local vault as a read-only source of truth for indexing.</p>
                </div>
              </div>

              <div className="source-refresh-grid source-policy-grid">
                <label className="form-field">
                  <span>Obsidian vault path</span>
                  <input
                    value={obsidianVaultUri}
                    placeholder="/data/notes/vault"
                    onChange={(event) => setObsidianVaultUri(event.target.value)}
                    disabled={obsidianCreateLoading}
                  />
                </label>
                <label className="form-field">
                  <span>Truth policy</span>
                  <input aria-label="Truth policy" value="read_only / writes disabled" disabled readOnly />
                </label>
              </div>

              <div className="playground-actions source-refresh-actions">
                <button type="submit" className="primary-button compact-button" disabled={obsidianCreateLoading}>
                  {obsidianCreateLoading ? 'Adding...' : 'Add vault'}
                </button>
                {obsidianCreateError ? (
                  <span className="error-copy" role="alert">
                    {obsidianCreateError}
                  </span>
                ) : null}
                {obsidianCreateSuccess ? (
                  <span className="success-copy" role="status">
                    {obsidianCreateSuccess}
                  </span>
                ) : null}
              </div>
            </form>

            {knowledgeBase.sources.map((source) => (
              <div key={source.id} className="resource-card">
                <div className="resource-header">
                  <div>
                    <h3>{source.type}</h3>
                    <p className="muted-copy">{source.uri}</p>
                  </div>
                  <StatusPill status={source.lastJob?.status ?? source.status} />
                </div>

                <div className="metric-grid compact">
                  <div className="mini-stat">
                    <span>Documents</span>
                    <strong>{source.documentCount}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>Last sync</span>
                    <strong>{formatDateTime(source.lastSyncedAt)}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>Last success</span>
                    <strong>{formatDateTime(source.lastSuccessfulIndexAt)}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>Snapshot bytes</span>
                    <strong>{formatBytes(source.lastSnapshot?.contentBytes)}</strong>
                  </div>
                </div>

                {source.lastSnapshot ? (
                  <div className="trace-card">
                    <div className="resource-footer">
                      <span>Snapshot: {source.lastSnapshot.snapshotType}</span>
                      <span>Files: {source.lastSnapshot.fileCount}</span>
                      <span>Ref: {source.lastSnapshot.ref ?? 'n/a'}</span>
                    </div>
                  </div>
                ) : null}

                {source.lastJob ? <JobProgress progress={source.lastJob.progress} /> : null}

                <SourcePolicyControls
                  source={source}
                  policy={sourcePolicies[source.id] ?? null}
                  draft={getSourcePolicyDraft(source.id)}
                  loading={sourcePolicyLoading[source.id] ?? false}
                  error={sourcePolicyErrors[source.id] ?? null}
                  success={sourcePolicySuccess[source.id] ?? null}
                  onDraftChange={(syncPolicy) => {
                    setSourcePolicyDrafts((current) => ({ ...current, [source.id]: syncPolicy }));
                    setSourcePolicyErrors((current) => ({ ...current, [source.id]: null }));
                    setSourcePolicySuccess((current) => ({ ...current, [source.id]: null }));
                  }}
                  onSave={() => saveSourcePolicy(source)}
                />

                <SourceRefreshControls
                  source={source}
                  mode={getSourceRefreshMode(source.id)}
                  reason={sourceRefreshReasons[source.id] ?? ''}
                  loading={sourceRefreshLoading[source.id] ?? null}
                  error={sourceRefreshErrors[source.id] ?? null}
                  plan={sourceRefreshPlans[source.id] ?? null}
                  job={sourceRefreshJobs[source.id] ?? null}
                  onModeChange={(mode) => {
                    setSourceRefreshModes((current) => ({ ...current, [source.id]: mode }));
                    setSourceRefreshErrors((current) => ({ ...current, [source.id]: null }));
                  }}
                  onReasonChange={(reason) => {
                    setSourceRefreshReasons((current) => ({ ...current, [source.id]: reason }));
                  }}
                  onDryRun={() => runSourceRefresh(source, true)}
                  onRefresh={() => runSourceRefresh(source, false)}
                />

                <div className="resource-footer">
                  {source.lastJob ? (
                    <Link to={`/jobs/${source.lastJob.id}`}>Open job {source.lastJob.id}</Link>
                  ) : (
                    <span className="muted-copy">No recent job bound to this source.</span>
                  )}
                  {source.lastErrorSummary ? (
                    <span className="error-copy" role="alert">
                      {source.lastErrorSummary.message}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Recent jobs" eyebrow="Queue timeline">
          <div className="card-stack">
            {detail.recentJobs.map((job) => (
              <Link key={job.id} to={`/jobs/${job.id}`} className="resource-card interactive">
                <div className="resource-header">
                  <div>
                    <h3>{job.type}</h3>
                    <p className="muted-copy">{formatDateTime(job.createdAt)}</p>
                  </div>
                  <StatusPill status={job.status} />
                </div>
                <JobProgress progress={job.progress} />
                <div className="resource-footer">
                  <span>{job.source?.uri ?? 'No source'}</span>
                  {job.lastErrorSummary ? (
                    <span className="error-copy" role="alert">
                      {job.lastErrorSummary.message}
                    </span>
                  ) : (
                    <span className="muted-copy">Healthy recent run</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="dashboard-grid">
        <SectionCard id="documents" title="Documents" eyebrow="Workspace explorer">
          {detail.explorer.documents.length === 0 ? (
            <p className="muted-copy">No indexed documents are available for this workspace yet.</p>
          ) : (
            <div className="card-stack">
              <p className="muted-copy compact-copy">
                Showing {detail.explorer.documents.length} documents from the backend read model
                {knowledgeBase.counts.documents > detail.explorer.documents.length
                  ? `, limited to ${detail.explorer.documentLimit}.`
                  : '.'}
              </p>
              {detail.explorer.documents.map((document) => (
                <article key={document.id} className="resource-card">
                  <div className="resource-header">
                    <div>
                      <h3>{document.path}</h3>
                      <p className="muted-copy">{document.mimeType}</p>
                    </div>
                    <StatusPill status={document.status} />
                  </div>
                  <div className="metric-grid compact">
                    <div className="mini-stat">
                      <span>Chunks</span>
                      <strong>{document.chunkCount}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Source</span>
                      <strong>{document.sourceId}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Updated</span>
                      <strong>{formatDateTime(document.updatedAt)}</strong>
                    </div>
                  </div>
                  <p className="muted-copy compact-copy">Hash: {document.contentHash}</p>
                  {Object.keys(document.metadata).length > 0 ? (
                    <pre
                      className="trace-text"
                      tabIndex={0}
                      role="group"
                      aria-label={`Document metadata: ${document.path}`}
                    >
                      {JSON.stringify(document.metadata, null, 2)}
                    </pre>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Index versions" eyebrow="Serving history">
          {knowledgeBase.indexVersions.length === 0 ? (
            <p className="muted-copy">No index versions have been recorded yet.</p>
          ) : (
            <div className="card-stack">
              {knowledgeBase.indexVersions.map((indexVersion) => (
                <article key={indexVersion.id} className="resource-card">
                  <div className="resource-header">
                    <div>
                      <h3>{indexVersion.id}</h3>
                      <p className="muted-copy">{indexVersion.vectorCollectionName}</p>
                    </div>
                    <StatusPill status={indexVersion.status} />
                  </div>
                  <div className="metric-grid compact">
                    <div className="mini-stat">
                      <span>Model</span>
                      <strong>{indexVersion.embeddingModel}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Dimension</span>
                      <strong>{indexVersion.embeddingDimension}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Mode</span>
                      <strong>{indexVersion.materializationMode}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Created</span>
                      <strong>{formatDateTime(indexVersion.createdAt)}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Recent failures" eyebrow="Operator attention">
        {recentFailures.length === 0 ? (
          <p className="muted-copy">No recent failure signal for this workspace.</p>
        ) : (
          <div className="card-stack">
            {recentFailures.map((job) => (
              <Link key={job.id} to={`/jobs/${job.id}`} className="resource-card interactive">
                <div className="resource-header">
                  <div>
                    <h3>{job.type}</h3>
                    <p className="muted-copy">{job.lastErrorSummary?.message ?? 'Failed job'}</p>
                  </div>
                  <StatusPill status={job.status} />
                </div>
                <div className="resource-footer">
                  <span>{formatDateTime(job.lastLogAt ?? job.finishedAt ?? job.createdAt)}</span>
                  <span>{job.lastErrorSummary?.code ?? 'no_code'}</span>
                  <span>{job.lastErrorSummary?.stage ?? 'no_stage'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      <WorkspaceMemorySection state={memory} />
      <EvaluationSection detail={detail} state={retrievalEvaluation} />
      <SectionCard id="resources" title="Resources" eyebrow="Workspace lifecycle">
        <div className="resource-card">
          <div className="resource-header">
            <div>
              <h3>Serving index</h3>
              <p className="muted-copy">
                Track Qdrant storage profile, estimated RAM pressure, and loaded workspace state.
              </p>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                disabled={resourceActionLoading !== null || resourceStatus?.lifecycle.status === 'loaded'}
                onClick={() => handleWorkspaceLifecycle('load')}
              >
                {resourceActionLoading === 'load' ? 'Loading...' : 'Load'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={resourceActionLoading !== null || resourceStatus?.lifecycle.status !== 'loaded'}
                onClick={() => handleWorkspaceLifecycle('unload')}
              >
                {resourceActionLoading === 'unload' ? 'Unloading...' : 'Unload'}
              </button>
            </div>
          </div>
          {resourceLoading ? <p className="muted-copy">Loading resource status...</p> : null}
          {resourceError ? (
            <div className="notice-banner" role="alert">
              <strong>Resource status unavailable:</strong> {resourceError}
            </div>
          ) : null}
          {resourceStatus ? <WorkspaceResourcePanel resources={resourceStatus} /> : null}
        </div>
        <VectorBackendOperationsPanel
          readModel={vectorBackends}
          placement={vectorPlacement}
          loading={vectorOpsLoading}
          action={vectorOpsAction}
          error={vectorOpsError}
          targetBackendId={targetBackendId}
          onTargetBackendIdChange={setTargetBackendId}
          onAction={handleVectorOperation}
        />
      </SectionCard>

      <SectionCard id="portability" title="Portability" eyebrow="Export manifest">
        <div className="resource-card">
          <div className="resource-header">
            <div>
              <h3>Workspace export manifest</h3>
              <p className="muted-copy">
                Inspect portable metadata, source definitions, retrieval profiles, memory entries, and plan-only restore
                guidance for this workspace.
              </p>
            </div>
            <button type="button" className="primary-button" disabled={!exportManifest} onClick={downloadManifest}>
              Download JSON
            </button>
          </div>
          <code>{exportManifestUrl}</code>
          {exportManifestLoading ? <p className="muted-copy">Loading export manifest...</p> : null}
          {exportManifestError ? (
            <div className="notice-banner" role="alert">
              <strong>Manifest unavailable:</strong> {exportManifestError}
            </div>
          ) : null}
          {exportManifest ? <ManifestSummary manifest={exportManifest} /> : null}
        </div>
      </SectionCard>
    </div>
  );
}
