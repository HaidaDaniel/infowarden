import { useEffect, useRef, useState, type FormEvent } from 'react';
import { buildRerankRequest, type RerankMode } from '../../components/workspace/KnowledgeBasePanels';
import { runRetrievalPlayground } from '../../lib/api';
import type { KnowledgeBaseDetailResponse, RetrievalTraceResponse } from '../../lib/types';
import { isLexicalRetrievalProfile } from './retrieval-presets';

export function useRetrievalPlayground(identifier: string | undefined, detail: KnowledgeBaseDetailResponse | null) {
  const [playgroundQuery, setPlaygroundQuery] = useState('');
  const [playgroundProfile, setPlaygroundProfile] = useState('');
  const [playgroundTopK, setPlaygroundTopK] = useState(6);
  const [playgroundTokenBudget, setPlaygroundTokenBudget] = useState(1200);
  const [playgroundPathPrefix, setPlaygroundPathPrefix] = useState('');
  const [playgroundLanguage, setPlaygroundLanguage] = useState('');
  const [playgroundBranch, setPlaygroundBranch] = useState('');
  const [playgroundRerankMode, setPlaygroundRerankMode] = useState<RerankMode>('profile');
  const [playgroundRerankerProvider, setPlaygroundRerankerProvider] = useState('local-cpu-reranker');
  const [playgroundRerankerTopN, setPlaygroundRerankerTopN] = useState(3);
  const [playgroundRerankerFallbackAllowed, setPlaygroundRerankerFallbackAllowed] = useState(true);
  const [playgroundTrace, setPlaygroundTrace] = useState<RetrievalTraceResponse | null>(null);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const [playgroundLoading, setPlaygroundLoading] = useState(false);

  const initializedWorkspace = useRef<string | null>(null);

  useEffect(() => {
    if (
      !detail ||
      !identifier ||
      (identifier !== detail.knowledgeBase.id && identifier !== detail.knowledgeBase.slug) ||
      initializedWorkspace.current === detail.knowledgeBase.id
    ) {
      return;
    }

    initializedWorkspace.current = detail.knowledgeBase.id;
    const suggestedProfile =
      detail.retrievalPlayground.defaultProfileKey || detail.knowledgeBase.defaultRetrievalProfile || 'default';
    setPlaygroundProfile(suggestedProfile);
    setPlaygroundTopK(detail.retrievalPlayground.suggestedRequest.topK);
    setPlaygroundTokenBudget(detail.retrievalPlayground.suggestedRequest.tokenBudget);
    setPlaygroundQuery(detail.retrievalPlayground.suggestedRequest.queryPlaceholder);
    setPlaygroundPathPrefix('');
    setPlaygroundLanguage('');
    setPlaygroundBranch('');
    setPlaygroundRerankMode('profile');
    setPlaygroundTrace(null);
    setPlaygroundError(null);
  }, [detail, identifier]);

  useEffect(() => {
    if (isLexicalRetrievalProfile(playgroundProfile) && playgroundRerankMode === 'on') {
      setPlaygroundRerankMode('off');
    }
  }, [playgroundProfile, playgroundRerankMode]);

  const submitPlayground = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!identifier || !playgroundQuery.trim()) {
      return;
    }

    setPlaygroundLoading(true);
    try {
      const trace = await runRetrievalPlayground(identifier, {
        query: playgroundQuery,
        profileKey: playgroundProfile || undefined,
        topK: playgroundTopK,
        tokenBudget: playgroundTokenBudget,
        pathPrefix: playgroundPathPrefix.trim() || undefined,
        language: playgroundLanguage.trim() || undefined,
        branch: playgroundBranch.trim() || undefined,
        rerank: buildRerankRequest(playgroundRerankMode, {
          providerName: playgroundRerankerProvider,
          topN: playgroundRerankerTopN,
          fallbackAllowed: playgroundRerankerFallbackAllowed,
        }),
      });
      setPlaygroundTrace(trace);
      setPlaygroundError(null);
    } catch (loadError) {
      setPlaygroundError(loadError instanceof Error ? loadError.message : 'Failed to run retrieval playground');
    } finally {
      setPlaygroundLoading(false);
    }
  };

  return {
    playgroundQuery,
    setPlaygroundQuery,
    playgroundProfile,
    setPlaygroundProfile,
    playgroundTopK,
    setPlaygroundTopK,
    playgroundTokenBudget,
    setPlaygroundTokenBudget,
    playgroundPathPrefix,
    setPlaygroundPathPrefix,
    playgroundLanguage,
    setPlaygroundLanguage,
    playgroundBranch,
    setPlaygroundBranch,
    playgroundRerankMode,
    setPlaygroundRerankMode,
    playgroundRerankerProvider,
    setPlaygroundRerankerProvider,
    playgroundRerankerTopN,
    setPlaygroundRerankerTopN,
    playgroundRerankerFallbackAllowed,
    setPlaygroundRerankerFallbackAllowed,
    playgroundTrace,
    playgroundError,
    playgroundLoading,
    submitPlayground,
  };
}
