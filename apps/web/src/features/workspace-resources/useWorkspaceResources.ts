import { useEffect, useState } from 'react';
import { fetchWorkspaceResources, loadWorkspace, unloadWorkspace } from '../../lib/api';
import type { WorkspaceResourceStatus } from '../../lib/types';

export function useWorkspaceResources(identifier: string | undefined, connectionRevision: number) {
  const [resourceStatus, setResourceStatus] = useState<WorkspaceResourceStatus | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceActionLoading, setResourceActionLoading] = useState<'load' | 'unload' | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);

  const reloadResourceStatus = async () => {
    if (!identifier) {
      return;
    }
    setResourceStatus(await fetchWorkspaceResources(identifier));
  };

  useEffect(() => {
    if (!identifier) {
      return;
    }

    let cancelled = false;
    const loadResources = async () => {
      setResourceLoading(true);
      try {
        const resources = await fetchWorkspaceResources(identifier);
        if (!cancelled) {
          setResourceStatus(resources);
          setResourceError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setResourceStatus(null);
          setResourceError(loadError instanceof Error ? loadError.message : 'Failed to load resource status');
        }
      } finally {
        if (!cancelled) {
          setResourceLoading(false);
        }
      }
    };

    void loadResources();
    return () => {
      cancelled = true;
    };
  }, [identifier, connectionRevision]);

  const handleWorkspaceLifecycle = async (action: 'load' | 'unload') => {
    if (!identifier) {
      return;
    }
    setResourceActionLoading(action);
    setResourceError(null);
    try {
      if (action === 'load') {
        await loadWorkspace(identifier, {
          storageProfile: resourceStatus?.activeIndexVersion?.storageProfile || resourceStatus?.estimate.storageProfile,
        });
      } else {
        await unloadWorkspace(identifier);
      }
      await reloadResourceStatus();
    } catch (lifecycleError) {
      setResourceError(lifecycleError instanceof Error ? lifecycleError.message : `Failed to ${action} workspace`);
    } finally {
      setResourceActionLoading(null);
    }
  };

  return {
    resourceStatus,
    resourceLoading,
    resourceActionLoading,
    resourceError,
    reloadResourceStatus,
    handleWorkspaceLifecycle,
  };
}
