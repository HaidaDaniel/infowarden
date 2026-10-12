import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { createSource, refreshWorkspaceSource, updateWorkspaceSourcePolicy } from '../../lib/api';
import type {
  KnowledgeBaseDetailResponse,
  KnowledgeBaseSource,
  SourcePolicyResponse,
  SourceRefreshMode,
  SourceRefreshPlan,
  SourceSyncPolicy,
} from '../../lib/types';
import type { SourceRefreshAction } from '../../components/workspace/KnowledgeBasePanels';

function defaultSourceSyncPolicy(): SourceSyncPolicy {
  return {
    triggerMode: 'manual',
    enabled: false,
    mode: 'incremental',
  };
}

function sanitizeSourceSyncPolicy(policy: SourceSyncPolicy): SourceSyncPolicy {
  return {
    triggerMode: policy.triggerMode,
    enabled: policy.enabled,
    mode: policy.mode,
    ...(policy.schedule?.trim() ? { schedule: policy.schedule.trim() } : {}),
    ...(policy.webhookSecretRef?.trim() ? { webhookSecretRef: policy.webhookSecretRef.trim() } : {}),
    ...(policy.watchDebounceMs ? { watchDebounceMs: policy.watchDebounceMs } : {}),
    ...(policy.reason?.trim() ? { reason: policy.reason.trim() } : {}),
  };
}

export function useSourceManagement(
  identifier: string | undefined,
  knowledgeBase: KnowledgeBaseDetailResponse['knowledgeBase'] | null,
  sourcePolicies: Record<string, SourcePolicyResponse>,
  setSourcePolicies: Dispatch<SetStateAction<Record<string, SourcePolicyResponse>>>,
  setSourcePolicyErrors: Dispatch<SetStateAction<Record<string, string | null>>>,
  reloadDetail: () => Promise<void>,
) {
  const [sourceRefreshModes, setSourceRefreshModes] = useState<Record<string, SourceRefreshMode>>({});
  const [sourceRefreshReasons, setSourceRefreshReasons] = useState<Record<string, string>>({});
  const [sourceRefreshLoading, setSourceRefreshLoading] = useState<Record<string, SourceRefreshAction | null>>({});
  const [sourceRefreshErrors, setSourceRefreshErrors] = useState<Record<string, string | null>>({});
  const [sourceRefreshPlans, setSourceRefreshPlans] = useState<Record<string, SourceRefreshPlan | null>>({});
  const [sourceRefreshJobs, setSourceRefreshJobs] = useState<
    Record<string, { id: string; mode: SourceRefreshMode } | null>
  >({});
  const [sourcePolicyDrafts, setSourcePolicyDrafts] = useState<Record<string, SourceSyncPolicy>>({});
  const [sourcePolicyLoading, setSourcePolicyLoading] = useState<Record<string, boolean>>({});
  const [sourcePolicySuccess, setSourcePolicySuccess] = useState<Record<string, string | null>>({});
  const [obsidianVaultUri, setObsidianVaultUri] = useState('');
  const [obsidianCreateLoading, setObsidianCreateLoading] = useState(false);
  const [obsidianCreateError, setObsidianCreateError] = useState<string | null>(null);
  const [obsidianCreateSuccess, setObsidianCreateSuccess] = useState<string | null>(null);

  const getSourceRefreshMode = (sourceId: string) => sourceRefreshModes[sourceId] ?? 'incremental';
  const getSourcePolicyDraft = (sourceId: string) =>
    sourcePolicyDrafts[sourceId] ?? sourcePolicies[sourceId]?.syncPolicy ?? defaultSourceSyncPolicy();

  const saveSourcePolicy = async (source: KnowledgeBaseSource) => {
    if (!identifier) {
      return;
    }

    const policy = sourcePolicies[source.id];
    const syncPolicy = sanitizeSourceSyncPolicy(getSourcePolicyDraft(source.id));
    setSourcePolicyLoading((current) => ({ ...current, [source.id]: true }));
    setSourcePolicyErrors((current) => ({ ...current, [source.id]: null }));
    setSourcePolicySuccess((current) => ({ ...current, [source.id]: null }));

    try {
      const updated = await updateWorkspaceSourcePolicy(identifier, source.id, {
        sourceTruthPolicy: {
          truthMode: policy?.sourceTruthPolicy.truthMode ?? 'read_only',
          writePolicy: policy?.sourceTruthPolicy.writePolicy ?? 'disabled',
          reason: policy?.sourceTruthPolicy.reason,
        },
        syncPolicy,
      });
      setSourcePolicies((current) => ({ ...current, [source.id]: updated }));
      setSourcePolicyDrafts((current) => ({ ...current, [source.id]: updated.syncPolicy }));
      setSourcePolicySuccess((current) => ({ ...current, [source.id]: 'Source policy saved.' }));
    } catch (saveError) {
      setSourcePolicyErrors((current) => ({
        ...current,
        [source.id]: saveError instanceof Error ? saveError.message : 'Failed to save source policy',
      }));
    } finally {
      setSourcePolicyLoading((current) => ({ ...current, [source.id]: false }));
    }
  };

  const submitObsidianSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!knowledgeBase) {
      return;
    }
    if (!obsidianVaultUri.trim()) {
      setObsidianCreateError('Vault path is required.');
      return;
    }

    setObsidianCreateLoading(true);
    setObsidianCreateError(null);
    setObsidianCreateSuccess(null);
    try {
      await createSource({
        knowledgeBaseSlug: knowledgeBase.slug,
        type: 'obsidian_vault',
        uri: obsidianVaultUri.trim(),
      });
      setObsidianVaultUri('');
      setObsidianCreateSuccess('Obsidian vault source created.');
      await reloadDetail();
    } catch (createError) {
      setObsidianCreateError(
        createError instanceof Error ? createError.message : 'Failed to create Obsidian vault source',
      );
    } finally {
      setObsidianCreateLoading(false);
    }
  };

  const runSourceRefresh = async (source: KnowledgeBaseSource, dryRun: boolean) => {
    if (!identifier) {
      return;
    }

    const mode = getSourceRefreshMode(source.id);
    const reason = sourceRefreshReasons[source.id]?.trim();
    const action: SourceRefreshAction = dryRun ? 'dryRun' : 'refresh';
    setSourceRefreshLoading((current) => ({ ...current, [source.id]: action }));
    setSourceRefreshErrors((current) => ({ ...current, [source.id]: null }));

    try {
      const response = await refreshWorkspaceSource(identifier, source.id, {
        mode,
        reason: reason || undefined,
        dryRun,
      });
      if (response.dryRun) {
        setSourceRefreshPlans((current) => ({ ...current, [source.id]: response }));
        setSourceRefreshJobs((current) => ({ ...current, [source.id]: null }));
      } else {
        setSourceRefreshPlans((current) => ({ ...current, [source.id]: null }));
        setSourceRefreshJobs((current) => ({
          ...current,
          [source.id]: { id: response.job.id, mode: response.mode },
        }));
        await reloadDetail();
      }
    } catch (refreshError) {
      setSourceRefreshErrors((current) => ({
        ...current,
        [source.id]: refreshError instanceof Error ? refreshError.message : 'Failed to refresh source',
      }));
    } finally {
      setSourceRefreshLoading((current) => ({ ...current, [source.id]: null }));
    }
  };

  return {
    sourceRefreshModes,
    sourceRefreshReasons,
    sourceRefreshLoading,
    sourceRefreshErrors,
    sourceRefreshPlans,
    sourceRefreshJobs,
    sourcePolicyDrafts,
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
    setSourceRefreshErrors,
    setSourceRefreshModes,
    setSourceRefreshReasons,
    setSourcePolicySuccess,
    saveSourcePolicy,
    submitObsidianSource,
    runSourceRefresh,
  };
}
