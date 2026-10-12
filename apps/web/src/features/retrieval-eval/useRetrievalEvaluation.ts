import { useEffect, useState, type FormEvent } from 'react';
import { buildRerankRequest, type RerankMode } from '../../components/workspace/KnowledgeBasePanels';
import {
  compareEvalProfiles,
  compareEvalRuns,
  fetchEvalQuestions,
  fetchEvalRuns,
  importStandardBenchmark,
  runRetrievalEval,
} from '../../lib/api';
import type {
  EvalProfileComparisonResponse,
  EvalQuestion,
  EvalRun,
  EvalRunComparisonResponse,
  KnowledgeBaseDetailResponse,
  StandardBenchmarkImportResponse,
} from '../../lib/types';

export function useRetrievalEvaluation(
  identifier: string | undefined,
  connectionRevision: number,
  detail: KnowledgeBaseDetailResponse | null,
) {
  const [evalDatasetId, setEvalDatasetId] = useState('cf-smoke-mini');
  const [evalProfile, setEvalProfile] = useState('');
  const [evalCompareProfileA, setEvalCompareProfileA] = useState('');
  const [evalCompareProfileB, setEvalCompareProfileB] = useState('');
  const [evalTopK, setEvalTopK] = useState(5);
  const [evalRerankMode, setEvalRerankMode] = useState<RerankMode>('profile');
  const [evalRerankerProvider, setEvalRerankerProvider] = useState('local-cpu-reranker');
  const [evalRerankerTopN, setEvalRerankerTopN] = useState(3);
  const [evalRerankerFallbackAllowed, setEvalRerankerFallbackAllowed] = useState(true);
  const [evalQuestions, setEvalQuestions] = useState<EvalQuestion[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>([]);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalRunLoading, setEvalRunLoading] = useState(false);
  const [standardBenchmarkLoading, setStandardBenchmarkLoading] = useState(false);
  const [standardBenchmarkResult, setStandardBenchmarkResult] = useState<StandardBenchmarkImportResponse | null>(null);
  const [rerankerComparisonLoading, setRerankerComparisonLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalLatestRun, setEvalLatestRun] = useState<EvalRun | null>(null);
  const [profileComparison, setProfileComparison] = useState<EvalProfileComparisonResponse | null>(null);
  const [profileComparisonLoading, setProfileComparisonLoading] = useState(false);
  const [runComparison, setRunComparison] = useState<EvalRunComparisonResponse | null>(null);
  const [runComparisonLoading, setRunComparisonLoading] = useState(false);
  const [baselineRunId, setBaselineRunId] = useState('');
  const [candidateRunId, setCandidateRunId] = useState('');

  useEffect(() => {
    if (!detail) {
      return;
    }

    const defaultProfile =
      detail.retrievalPlayground.defaultProfileKey || detail.knowledgeBase.defaultRetrievalProfile || 'default';
    setEvalProfile((current) => current || defaultProfile);
    const profileKeys = detail.retrievalPlayground.profiles.map((profile) => profile.key);
    setEvalCompareProfileA((current) => current || profileKeys[0] || 'default');
    setEvalCompareProfileB((current) => current || profileKeys[1] || profileKeys[0] || 'default');
  }, [detail]);

  const refreshEvalData = async () => {
    if (!identifier) {
      return;
    }

    const [questionsResponse, runsResponse] = await Promise.all([
      fetchEvalQuestions(identifier, evalDatasetId),
      fetchEvalRuns(identifier, 10),
    ]);
    setEvalQuestions(questionsResponse.questions);
    setEvalRuns(runsResponse.runs);
    setEvalLatestRun(runsResponse.runs[0] ?? null);
    setBaselineRunId((current) => current || runsResponse.runs[1]?.id || runsResponse.runs[0]?.id || '');
    setCandidateRunId((current) => current || runsResponse.runs[0]?.id || '');
  };

  useEffect(() => {
    if (!identifier) {
      return;
    }

    let cancelled = false;
    const loadEval = async () => {
      setEvalLoading(true);
      try {
        const [questionsResponse, runsResponse] = await Promise.all([
          fetchEvalQuestions(identifier, evalDatasetId),
          fetchEvalRuns(identifier, 10),
        ]);
        if (!cancelled) {
          setEvalQuestions(questionsResponse.questions);
          setEvalRuns(runsResponse.runs);
          setEvalLatestRun(runsResponse.runs[0] ?? null);
          setBaselineRunId((current) => current || runsResponse.runs[1]?.id || runsResponse.runs[0]?.id || '');
          setCandidateRunId((current) => current || runsResponse.runs[0]?.id || '');
          setEvalError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setEvalQuestions([]);
          setEvalRuns([]);
          setEvalError(loadError instanceof Error ? loadError.message : 'Failed to load eval data');
        }
      } finally {
        if (!cancelled) {
          setEvalLoading(false);
        }
      }
    };

    void loadEval();
    return () => {
      cancelled = true;
    };
  }, [identifier, connectionRevision, evalDatasetId]);

  const submitStandardBenchmarkImport = async () => {
    if (!identifier) {
      return;
    }

    setStandardBenchmarkLoading(true);
    setEvalError(null);
    try {
      const result = await importStandardBenchmark(identifier, { profile: 'cpu-mini' });
      setStandardBenchmarkResult(result);
      setEvalDatasetId(result.next.datasetId);
      setEvalProfile(result.next.profileKey);
      setEvalTopK(result.next.topK);
      const [questionsResponse, runsResponse] = await Promise.all([
        fetchEvalQuestions(identifier, result.next.datasetId),
        fetchEvalRuns(identifier, 10),
      ]);
      setEvalQuestions(questionsResponse.questions);
      setEvalRuns(runsResponse.runs);
      setEvalLatestRun(runsResponse.runs[0] ?? null);
    } catch (importError) {
      setEvalError(importError instanceof Error ? importError.message : 'Failed to import standard benchmark');
    } finally {
      setStandardBenchmarkLoading(false);
    }
  };

  const submitEvalRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identifier) {
      return;
    }

    setEvalRunLoading(true);
    setEvalError(null);
    try {
      const effectiveProfileKey =
        evalProfile ||
        detail?.retrievalPlayground.defaultProfileKey ||
        detail?.knowledgeBase.defaultRetrievalProfile ||
        undefined;
      const run = await runRetrievalEval(identifier, {
        datasetId: evalDatasetId.trim() || undefined,
        profileKey: effectiveProfileKey,
        topK: evalTopK,
        rerank: buildRerankRequest(evalRerankMode, {
          providerName: evalRerankerProvider,
          topN: evalRerankerTopN,
          fallbackAllowed: evalRerankerFallbackAllowed,
        }),
      });
      setEvalLatestRun(run);
      setEvalRuns((current) => [run, ...current.filter((existing) => existing.id !== run.id)]);
      setCandidateRunId(run.id);
      setProfileComparison(null);
      setRunComparison(null);
    } catch (runError) {
      setEvalError(runError instanceof Error ? runError.message : 'Failed to run retrieval eval');
    } finally {
      setEvalRunLoading(false);
    }
  };

  const submitProfileComparison = async () => {
    if (!identifier) {
      return;
    }
    const profileKeys = [evalCompareProfileA, evalCompareProfileB].map((profile) => profile.trim()).filter(Boolean);
    if (new Set(profileKeys).size < 2) {
      setEvalError('Choose two different profiles to compare.');
      return;
    }

    setProfileComparisonLoading(true);
    setEvalError(null);
    try {
      const comparison = await compareEvalProfiles(identifier, {
        datasetId: evalDatasetId.trim() || undefined,
        topK: evalTopK,
        profileKeys,
      });
      setProfileComparison(comparison);
      setEvalRuns((current) => [
        ...comparison.runs,
        ...current.filter((run) => !comparison.runs.some((candidate) => candidate.id === run.id)),
      ]);
      if (comparison.runs.length >= 2) {
        setBaselineRunId(comparison.runs[0].id);
        setCandidateRunId(comparison.runs[1].id);
      }
      setRunComparison(null);
    } catch (compareError) {
      setEvalError(compareError instanceof Error ? compareError.message : 'Failed to compare profiles');
    } finally {
      setProfileComparisonLoading(false);
    }
  };

  const submitRerankerComparison = async () => {
    if (!identifier || !detail) {
      return;
    }
    const profileKey = evalProfile || detail.retrievalPlayground.defaultProfileKey;
    const datasetId = evalDatasetId.trim() || undefined;
    const candidateRerank = buildRerankRequest('on', {
      providerName: evalRerankerProvider,
      topN: evalRerankerTopN,
      fallbackAllowed: evalRerankerFallbackAllowed,
    });

    setRerankerComparisonLoading(true);
    setEvalError(null);
    try {
      const [baseline, candidate] = await Promise.all([
        runRetrievalEval(identifier, {
          name: `${datasetId ?? 'dataset'} ${profileKey} reranker off`,
          datasetId,
          profileKey,
          topK: evalTopK,
          rerank: { enabled: false },
        }),
        runRetrievalEval(identifier, {
          name: `${datasetId ?? 'dataset'} ${profileKey} reranker on`,
          datasetId,
          profileKey,
          topK: evalTopK,
          rerank: candidateRerank,
        }),
      ]);
      const comparison = await compareEvalRuns(identifier, {
        baselineRunId: baseline.id,
        candidateRunId: candidate.id,
      });
      setEvalRuns((current) => [
        candidate,
        baseline,
        ...current.filter((run) => run.id !== candidate.id && run.id !== baseline.id),
      ]);
      setEvalLatestRun(candidate);
      setBaselineRunId(baseline.id);
      setCandidateRunId(candidate.id);
      setRunComparison(comparison);
      setProfileComparison(null);
    } catch (compareError) {
      setEvalError(compareError instanceof Error ? compareError.message : 'Failed to compare reranker on/off');
    } finally {
      setRerankerComparisonLoading(false);
    }
  };

  const submitRunComparison = async () => {
    if (!identifier) {
      return;
    }
    if (!baselineRunId || !candidateRunId || baselineRunId === candidateRunId) {
      setEvalError('Choose two different eval runs to compare.');
      return;
    }

    setRunComparisonLoading(true);
    setEvalError(null);
    try {
      setRunComparison(await compareEvalRuns(identifier, { baselineRunId, candidateRunId }));
    } catch (compareError) {
      setEvalError(compareError instanceof Error ? compareError.message : 'Failed to compare runs');
    } finally {
      setRunComparisonLoading(false);
    }
  };

  return {
    evalDatasetId,
    setEvalDatasetId,
    evalProfile,
    setEvalProfile,
    evalCompareProfileA,
    setEvalCompareProfileA,
    evalCompareProfileB,
    setEvalCompareProfileB,
    evalTopK,
    setEvalTopK,
    evalRerankMode,
    setEvalRerankMode,
    evalRerankerProvider,
    setEvalRerankerProvider,
    evalRerankerTopN,
    setEvalRerankerTopN,
    evalRerankerFallbackAllowed,
    setEvalRerankerFallbackAllowed,
    evalQuestions,
    evalRuns,
    evalLoading,
    evalRunLoading,
    standardBenchmarkLoading,
    standardBenchmarkResult,
    rerankerComparisonLoading,
    evalError,
    setEvalError,
    evalLatestRun,
    setEvalLatestRun,
    profileComparison,
    profileComparisonLoading,
    runComparison,
    runComparisonLoading,
    baselineRunId,
    setBaselineRunId,
    candidateRunId,
    setCandidateRunId,
    refreshEvalData,
    submitStandardBenchmarkImport,
    submitEvalRun,
    submitProfileComparison,
    submitRerankerComparison,
    submitRunComparison,
  };
}
