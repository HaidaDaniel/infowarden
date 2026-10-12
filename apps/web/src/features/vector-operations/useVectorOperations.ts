import { useEffect, useState } from 'react';
import {
  buildCompatibleVectorOperation,
  createWorkspaceVectorOperation,
  cutoverVectorOperation,
  fetchVectorBackendsReadModel,
  fetchWorkspaceVectorPlacement,
  pinWorkspaceVectorBackend,
  rollbackVectorOperation,
  scheduleVectorOperationCleanup,
} from '../../lib/api';
import type { VectorBackendsReadModel, WorkspaceVectorPlacement } from '../../lib/types';

export function useVectorOperations(
  identifier: string | undefined,
  connectionRevision: number,
  reloadResourceStatus: () => Promise<void>,
) {
  const [vectorBackends, setVectorBackends] = useState<VectorBackendsReadModel | null>(null);
  const [vectorPlacement, setVectorPlacement] = useState<WorkspaceVectorPlacement | null>(null);
  const [vectorOpsLoading, setVectorOpsLoading] = useState(false);
  const [vectorOpsAction, setVectorOpsAction] = useState<string | null>(null);
  const [vectorOpsError, setVectorOpsError] = useState<string | null>(null);
  const [targetBackendId, setTargetBackendId] = useState('');

  const reloadVectorOps = async () => {
    if (!identifier) {
      return;
    }
    const [readModel, placement] = await Promise.all([
      fetchVectorBackendsReadModel(),
      fetchWorkspaceVectorPlacement(identifier),
    ]);
    setVectorBackends(readModel);
    setVectorPlacement(placement);
    setTargetBackendId((current) => current || placement.vectorBackendId);
  };

  useEffect(() => {
    if (!identifier) {
      return;
    }

    let cancelled = false;
    const loadVectorOps = async () => {
      setVectorOpsLoading(true);
      try {
        const [readModel, placement] = await Promise.all([
          fetchVectorBackendsReadModel(),
          fetchWorkspaceVectorPlacement(identifier),
        ]);
        if (!cancelled) {
          setVectorBackends(readModel);
          setVectorPlacement(placement);
          setTargetBackendId((current) => current || placement.vectorBackendId);
          setVectorOpsError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setVectorBackends(null);
          setVectorPlacement(null);
          setVectorOpsError(
            loadError instanceof Error ? loadError.message : 'Failed to load vector backend operations',
          );
        }
      } finally {
        if (!cancelled) {
          setVectorOpsLoading(false);
        }
      }
    };

    void loadVectorOps();
    return () => {
      cancelled = true;
    };
  }, [identifier, connectionRevision]);

  const handleVectorOperation = async (action: string, operationId?: string) => {
    if (!identifier) {
      return;
    }
    setVectorOpsAction(action);
    setVectorOpsError(null);
    try {
      if (action === 'pin') {
        await pinWorkspaceVectorBackend(identifier, targetBackendId);
      } else if (action === 'move') {
        await createWorkspaceVectorOperation(identifier, {
          kind: 'backend_move',
          targetVectorBackendId: targetBackendId,
        });
      } else if (action === 'full_rebuild') {
        await createWorkspaceVectorOperation(identifier, { kind: 'full_rebuild' });
      } else if (action === 'build' && operationId) {
        await buildCompatibleVectorOperation(operationId);
      } else if (action === 'cutover' && operationId) {
        await cutoverVectorOperation(operationId);
      } else if (action === 'rollback' && operationId) {
        await rollbackVectorOperation(operationId);
      } else if (action === 'cleanup' && operationId) {
        await scheduleVectorOperationCleanup(operationId);
      }
      await reloadVectorOps();
      await reloadResourceStatus();
    } catch (operationError) {
      setVectorOpsError(operationError instanceof Error ? operationError.message : 'Vector operation failed');
    } finally {
      setVectorOpsAction(null);
    }
  };

  return {
    vectorBackends,
    vectorPlacement,
    vectorOpsLoading,
    vectorOpsAction,
    vectorOpsError,
    targetBackendId,
    setTargetBackendId,
    reloadVectorOps,
    handleVectorOperation,
  };
}
