import { StatusPill } from '../StatusPill';
import { formatBytes, formatDateTime } from '../../lib/format';
import type { VectorBackendsReadModel, WorkspaceResourceStatus, WorkspaceVectorPlacement } from '../../lib/types';

type VectorBackendOperationAction = 'pin' | 'move' | 'full_rebuild' | 'build' | 'cutover' | 'rollback' | 'cleanup';

export function WorkspaceResourcePanel({ resources }: { resources: WorkspaceResourceStatus }) {
  const estimate = resources.estimate;
  const split = resources.resources;
  return (
    <div className="card-stack">
      <div className="metric-grid compact">
        <Metric label="Lifecycle" value={resources.lifecycle.status} />
        <Metric label="Collection" value={resources.lifecycle.collectionAvailable ? 'available' : 'missing'} />
        <Metric label="Backend" value={String(resources.lifecycle.vectorBackendId ?? 'unknown')} />
        <Metric label="Storage" value={String(estimate.storageProfile)} />
        <Metric label="Dimension" value={String(estimate.embeddingDimension)} />
        <Metric label="Chunks" value={estimate.estimatedChunks.toLocaleString()} />
        <Metric label="Raw vectors" value={formatBytes(estimate.rawVectorBytes)} />
        <Metric
          label="Qdrant disk"
          value={`${formatBytes(estimate.qdrantDiskBytesLow)}-${formatBytes(estimate.qdrantDiskBytesHigh)}`}
        />
        <Metric label="RAM pressure" value={formatBytes(estimate.estimatedRamBytes)} />
      </div>
      <p className="muted-copy compact-copy">
        Active collection: {resources.lifecycle.vectorCollectionName ?? 'none'}.
      </p>
      {split ? (
        <div className="resource-footer">
          <span>Requested {String(split.requested.storageProfile ?? 'n/a')}</span>
          <span>Allocated {String(split.allocated.vectorBackendId ?? 'n/a')}</span>
          <span>Observed {String(split.observed.vectorBackendId ?? 'n/a')}</span>
        </div>
      ) : null}
      {resources.estimate.warnings.length ? (
        <div className="notice-banner">
          <strong>Capacity warnings:</strong>{' '}
          {resources.estimate.warnings.map((warning) => `${warning.code}: ${warning.message}`).join(' ')}
        </div>
      ) : (
        <p className="muted-copy compact-copy">No capacity warnings for the current estimate.</p>
      )}
    </div>
  );
}

export function VectorBackendOperationsPanel({
  readModel,
  placement,
  loading,
  action,
  error,
  targetBackendId,
  onTargetBackendIdChange,
  onAction,
}: {
  readModel: VectorBackendsReadModel | null;
  placement: WorkspaceVectorPlacement | null;
  loading: boolean;
  action: string | null;
  error: string | null;
  targetBackendId: string;
  onTargetBackendIdChange: (value: string) => void;
  onAction: (action: VectorBackendOperationAction, operationId?: string) => void;
}) {
  const backends = readModel?.backends ?? [];
  const selectedBackend = backends.find((backend) => backend.id === (targetBackendId || placement?.vectorBackendId));
  const operations = backends.flatMap((backend) => backend.operations ?? []);
  const eligibleBackends = backends.filter((backend) => backend.state === 'enabled');

  return (
    <div className="resource-card">
      <div className="resource-header">
        <div>
          <h3>Vector backend operations</h3>
          <p className="muted-copy">
            Inspect placement and start explicit pin, move, rollback, and cleanup operations.
          </p>
        </div>
      </div>
      {loading ? <p className="muted-copy">Loading vector backend operations...</p> : null}
      {error ? (
        <div className="notice-banner" role="alert">
          <strong>Vector operations unavailable:</strong> {error}
        </div>
      ) : null}
      {readModel ? (
        <div className="card-stack">
          <div className="notice-banner">
            <strong>Topology:</strong> {readModel.policy.note}
          </div>
          <div className="metric-grid compact">
            <Metric label="Placement" value={placement?.state ?? 'unknown'} />
            <Metric label="Mode" value={placement?.mode ?? 'unknown'} />
            <Metric label="Backend" value={placement?.vectorBackendId ?? 'unknown'} />
            <Metric label="Serving revision" value={placement?.servingRevisionId ?? 'unknown'} />
            <Metric label="Backends" value={String(backends.length)} />
          </div>
          <p className="muted-copy compact-copy">
            Alias {placement?.collectionAlias ?? 'none'} serves physical collection{' '}
            {placement?.physicalCollectionName ?? 'none'}.
          </p>
          <label className="form-label">
            Target backend
            <select
              value={targetBackendId || placement?.vectorBackendId || ''}
              onChange={(event) => onTargetBackendIdChange(event.target.value)}
            >
              {backends.map((backend) => (
                <option key={backend.id} value={backend.id}>
                  {backend.name} ({backend.state}) {backend.hasApiKeyRef ? 'secret configured' : 'no secret'}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button
              type="button"
              className="secondary-button"
              disabled={!selectedBackend || selectedBackend.state !== 'enabled' || Boolean(action)}
              onClick={() => onAction('pin')}
            >
              {action === 'pin' ? 'Pinning...' : 'Pin'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={
                !selectedBackend ||
                selectedBackend.id === placement?.vectorBackendId ||
                selectedBackend.state !== 'enabled' ||
                Boolean(action)
              }
              onClick={() => onAction('move')}
            >
              {action === 'move' ? 'Requesting...' : 'Request move'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={Boolean(action)}
              onClick={() => onAction('full_rebuild')}
            >
              {action === 'full_rebuild' ? 'Requesting...' : 'Request rebuild'}
            </button>
          </div>
          <div className="dashboard-grid">
            {backends.map((backend) => (
              <article key={backend.id} className="resource-card">
                <div className="resource-header">
                  <div>
                    <h3>{backend.name}</h3>
                    <p className="muted-copy">{backend.baseUrl}</p>
                  </div>
                  <StatusPill status={backend.state} />
                </div>
                <div className="resource-footer">
                  <span>Workspaces {backend.assignedWorkspaceCount ?? 0}</span>
                  <span>Vectors {String(backend.observedResources?.vectorCount ?? 'n/a')}</span>
                  <span>{backend.apiKeyRef}</span>
                </div>
              </article>
            ))}
          </div>
          {eligibleBackends.length === 0 ? (
            <div className="notice-banner">No enabled compatible target backends are available for pin or move.</div>
          ) : null}
          {operations.length ? (
            <div className="card-stack">
              <h3>Recent vector operations</h3>
              {operations.map((operation) => (
                <article key={operation.id} className="resource-card">
                  <div className="resource-header">
                    <div>
                      <h3>{operation.kind}</h3>
                      <p className="muted-copy">{operation.id}</p>
                    </div>
                    <StatusPill status={operation.state} />
                  </div>
                  <div className="resource-footer">
                    <span>Target {operation.targetVectorBackendId}</span>
                    <span>Rollback {operation.rollbackUntil ? formatDateTime(operation.rollbackUntil) : 'n/a'}</span>
                    <span>Cleanup {operation.cleanupAfter ? formatDateTime(operation.cleanupAfter) : 'n/a'}</span>
                  </div>
                  {Object.keys(operation.errorSummary || {}).length ? (
                    <div className="notice-banner" role="alert">
                      <strong>Error:</strong> {JSON.stringify(operation.errorSummary)}
                    </div>
                  ) : null}
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={Boolean(action)}
                      onClick={() => onAction('build', operation.id)}
                    >
                      Build copy
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={operation.state !== 'ready_for_cutover' || Boolean(action)}
                      onClick={() => onAction('cutover', operation.id)}
                    >
                      Cut over
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={operation.state !== 'cutover_complete' || Boolean(action)}
                      onClick={() => onAction('rollback', operation.id)}
                    >
                      Rollback
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={operation.state !== 'cutover_complete' || Boolean(action)}
                      onClick={() => onAction('cleanup', operation.id)}
                    >
                      Cleanup
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-copy compact-copy">No active vector move or rebuild operations.</p>
          )}
        </div>
      ) : null}
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
