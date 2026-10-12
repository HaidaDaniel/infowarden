import { useCallback, useEffect, useState } from 'react';
import { fetchKnowledgeBaseOverview, fetchWorkspaceSourcePolicy } from '../../lib/api';
import type { KnowledgeBaseDetailResponse, SourcePolicyResponse } from '../../lib/types';

export type LoadedWorkspaceDetail = {
  response: KnowledgeBaseDetailResponse;
  policies: Record<string, SourcePolicyResponse>;
  policyErrors: Record<string, string | null>;
};

export async function loadWorkspaceDetail(identifier: string): Promise<LoadedWorkspaceDetail> {
  const response = await fetchKnowledgeBaseOverview(identifier);
  const policyResults = await Promise.all(
    response.knowledgeBase.sources.map(async (source) => {
      try {
        return {
          sourceId: source.id,
          policy: await fetchWorkspaceSourcePolicy(identifier, source.id),
          error: null,
        };
      } catch (loadError) {
        return {
          sourceId: source.id,
          policy: null,
          error: loadError instanceof Error ? loadError.message : 'Failed to load source policy',
        };
      }
    }),
  );

  const policies: Record<string, SourcePolicyResponse> = {};
  const policyErrors: Record<string, string | null> = {};
  for (const result of policyResults) {
    if (result.policy) {
      policies[result.sourceId] = result.policy;
    }
    policyErrors[result.sourceId] = result.error;
  }

  return { response, policies, policyErrors };
}

export function useWorkspaceDetail(identifier: string | undefined, connectionRevision: number) {
  const [detail, setDetail] = useState<KnowledgeBaseDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourcePolicies, setSourcePolicies] = useState<Record<string, SourcePolicyResponse>>({});
  const [sourcePolicyErrors, setSourcePolicyErrors] = useState<Record<string, string | null>>({});

  const reloadDetail = useCallback(async () => {
    if (!identifier) {
      return;
    }

    const { response, policies, policyErrors } = await loadWorkspaceDetail(identifier);
    setDetail(response);
    setSourcePolicies(policies);
    setSourcePolicyErrors(policyErrors);
  }, [identifier]);

  useEffect(() => {
    if (!identifier) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const loaded = await loadWorkspaceDetail(identifier);
        if (!cancelled) {
          setDetail(loaded.response);
          setSourcePolicies(loaded.policies);
          setSourcePolicyErrors(loaded.policyErrors);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load workspace');
        }
      }
    };

    void load();
    const intervalId = window.setInterval(() => void load(), 10000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [identifier, connectionRevision]);

  return {
    detail,
    error,
    setDetail,
    setSourcePolicies,
    setSourcePolicyErrors,
    sourcePolicies,
    sourcePolicyErrors,
    reloadDetail,
  };
}
