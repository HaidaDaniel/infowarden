import { useEffect, useState } from 'react';
import { fetchWorkspaceExportManifest } from '../../lib/api';
import type { WorkspaceExportManifest } from '../../lib/types';

export function useWorkspaceExport(identifier: string | undefined, connectionRevision: number) {
  const [exportManifest, setExportManifest] = useState<WorkspaceExportManifest | null>(null);
  const [exportManifestError, setExportManifestError] = useState<string | null>(null);
  const [exportManifestLoading, setExportManifestLoading] = useState(false);

  useEffect(() => {
    if (!identifier) {
      return;
    }

    let cancelled = false;
    const loadManifest = async () => {
      setExportManifestLoading(true);
      try {
        const manifest = await fetchWorkspaceExportManifest(identifier);
        if (!cancelled) {
          setExportManifest(manifest);
          setExportManifestError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setExportManifest(null);
          setExportManifestError(loadError instanceof Error ? loadError.message : 'Failed to load export manifest');
        }
      } finally {
        if (!cancelled) {
          setExportManifestLoading(false);
        }
      }
    };

    void loadManifest();
    return () => {
      cancelled = true;
    };
  }, [identifier, connectionRevision]);

  return {
    exportManifest,
    exportManifestError,
    exportManifestLoading,
  };
}
