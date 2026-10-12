import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SectionCard } from '../components/SectionCard';
import { ApiRequestError, askWorkspace, fetchKnowledgeBaseOverview } from '../lib/api';
import type {
  AskBudgetDiagnostics,
  AskMode,
  AskRequest,
  AskResponse,
  KnowledgeBaseDetailResponse,
  RetrievalTraceItem,
} from '../lib/types';

type AskPageProps = {
  connectionRevision?: number;
};

type AskSourceGroup = {
  key: string;
  label: string;
  revision: string | null;
  items: RetrievalTraceItem[];
};

function itemRevision(item: RetrievalTraceItem): string | null {
  const revision = item.metadata.sourceRevisionId;
  return typeof revision === 'string' && revision ? revision : null;
}

function groupChunksBySource(items: RetrievalTraceItem[]): AskSourceGroup[] {
  const groups = new Map<string, AskSourceGroup>();
  for (const item of items) {
    const key = item.sourceId ?? item.path ?? 'unknown-source';
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(key, {
      key,
      label: item.sourceId ?? item.path ?? 'Unknown source',
      revision: itemRevision(item),
      items: [item],
    });
  }
  return Array.from(groups.values());
}

export function AskPage({ connectionRevision = 0 }: AskPageProps) {
  const { identifier } = useParams();
  const [detail, setDetail] = useState<KnowledgeBaseDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [askMode, setAskMode] = useState<AskMode>('rag_answer');
  const [askQuery, setAskQuery] = useState('');
  const [askProfile, setAskProfile] = useState('');
  const [askTopK, setAskTopK] = useState(6);
  const [askTokenBudget, setAskTokenBudget] = useState(1200);
  const [askPathPrefix, setAskPathPrefix] = useState('');
  const [askLanguage, setAskLanguage] = useState('');
  const [askBranch, setAskBranch] = useState('');
  const [llmProviderName, setLlmProviderName] = useState('');
  const [llmMaxOutputTokens, setLlmMaxOutputTokens] = useState('');
  const [llmTemperature, setLlmTemperature] = useState('');
  const [askResponse, setAskResponse] = useState<AskResponse | null>(null);
  const [askError, setAskError] = useState<Error | null>(null);
  const [askLoading, setAskLoading] = useState(false);

  useEffect(() => {
    if (!identifier) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetchKnowledgeBaseOverview(identifier);
        if (cancelled) {
          return;
        }
        setDetail(response);
        setDetailError(null);
        setAskProfile(
          (current) =>
            current ||
            response.retrievalPlayground.defaultProfileKey ||
            response.knowledgeBase.defaultRetrievalProfile ||
            '',
        );
        setAskTopK(response.retrievalPlayground.suggestedRequest.topK);
        setAskTokenBudget(response.retrievalPlayground.suggestedRequest.tokenBudget);
      } catch (loadError) {
        if (!cancelled) {
          setDetailError(loadError instanceof Error ? loadError.message : 'Failed to load workspace');
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [identifier, connectionRevision]);

  const sourceGroups = useMemo(() => {
    if (!askResponse) {
      return [];
    }
    return groupChunksBySource(askResponse.contextPackage.groups.flatMap((group) => group.items));
  }, [askResponse]);

  const submitAsk = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identifier || !askQuery.trim()) {
      return;
    }

    setAskLoading(true);
    setAskError(null);
    try {
      const request: AskRequest = {
        query: askQuery,
        mode: askMode,
        profileKey: askProfile || undefined,
        topK: askTopK,
        tokenBudget: askTokenBudget,
      };
      const filters: AskRequest['filters'] = {};
      if (askPathPrefix.trim()) {
        filters.pathPrefix = askPathPrefix.trim();
      }
      if (askLanguage.trim()) {
        filters.language = askLanguage.trim();
      }
      if (askBranch.trim()) {
        filters.branch = askBranch.trim();
      }
      if (Object.keys(filters).length > 0) {
        request.filters = filters;
      }
      if (askMode === 'rag_answer') {
        const llm: AskRequest['llm'] = {};
        if (llmProviderName.trim()) {
          llm.providerName = llmProviderName.trim();
        }
        const maxOutputTokens = Number(llmMaxOutputTokens);
        if (llmMaxOutputTokens.trim() && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
          llm.maxOutputTokens = Math.floor(maxOutputTokens);
        }
        const temperature = Number(llmTemperature);
        if (llmTemperature.trim() && Number.isFinite(temperature)) {
          llm.temperature = temperature;
        }
        if (Object.keys(llm).length > 0) {
          request.llm = llm;
        }
      }
      const response = await askWorkspace(identifier, request);
      setAskResponse(response);
    } catch (error) {
      setAskResponse(null);
      setAskError(error instanceof Error ? error : new Error('Ask request failed'));
    } finally {
      setAskLoading(false);
    }
  };

  if (!identifier) {
    return (
      <SectionCard title="Missing workspace" eyebrow="Ask">
        Route parameter is missing.
      </SectionCard>
    );
  }

  const workspaceHref = `/workspaces/${detail?.knowledgeBase.slug ?? identifier}`;

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Workspace Ask</p>
          <h2>{detail?.knowledgeBase.name ?? identifier}</h2>
          <p className="hero-copy">
            Ask the workspace: retrieve chunks or generate one citation-preserving RAG answer through the backend /ask
            endpoint. Studio only renders the backend result.
          </p>
          <div className="button-row">
            <Link className="secondary-button compact-button" to={workspaceHref}>
              Back to workspace
            </Link>
          </div>
        </div>
      </section>

      <SectionCard title="Ask" eyebrow="Answer playground">
        <form className="playground-form" onSubmit={submitAsk}>
          <label className="form-field form-field-wide">
            <span>Query</span>
            <textarea
              value={askQuery}
              onChange={(event) => setAskQuery(event.target.value)}
              rows={3}
              placeholder="What should InfoWarden answer from this workspace?"
            />
          </label>

          <label className="form-field">
            <span>Mode</span>
            <select value={askMode} onChange={(event) => setAskMode(event.target.value as AskMode)}>
              <option value="chunks">chunks (retrieval only)</option>
              <option value="rag_answer">rag_answer (generated answer)</option>
            </select>
          </label>

          <label className="form-field">
            <span>Profile</span>
            <select value={askProfile} onChange={(event) => setAskProfile(event.target.value)}>
              {(detail?.retrievalPlayground.profiles ?? []).map((profile) => (
                <option key={profile.key} value={profile.key}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Top K</span>
            <input
              type="number"
              min={1}
              max={50}
              value={askTopK}
              onChange={(event) => setAskTopK(Number(event.target.value))}
            />
          </label>

          <label className="form-field">
            <span>Token budget</span>
            <input
              type="number"
              min={50}
              max={4000}
              step={50}
              value={askTokenBudget}
              onChange={(event) => setAskTokenBudget(Number(event.target.value))}
            />
          </label>

          <label className="form-field">
            <span>Path prefix</span>
            <input
              value={askPathPrefix}
              placeholder="src/"
              onChange={(event) => setAskPathPrefix(event.target.value)}
            />
          </label>

          <label className="form-field">
            <span>Language</span>
            <input
              value={askLanguage}
              placeholder="markdown"
              onChange={(event) => setAskLanguage(event.target.value)}
            />
          </label>

          <label className="form-field">
            <span>Branch</span>
            <input value={askBranch} placeholder="main" onChange={(event) => setAskBranch(event.target.value)} />
          </label>

          {askMode === 'rag_answer' ? (
            <>
              <label className="form-field">
                <span>LLM provider</span>
                <input
                  value={llmProviderName}
                  placeholder="default provider"
                  onChange={(event) => setLlmProviderName(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Max output tokens</span>
                <input
                  type="number"
                  min={1}
                  value={llmMaxOutputTokens}
                  placeholder="provider default"
                  onChange={(event) => setLlmMaxOutputTokens(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Temperature</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={2}
                  value={llmTemperature}
                  placeholder="provider default"
                  onChange={(event) => setLlmTemperature(event.target.value)}
                />
              </label>
            </>
          ) : null}

          <div className="playground-actions">
            <button type="submit" className="primary-button" disabled={askLoading || !askQuery.trim()}>
              {askLoading ? 'Running…' : 'Run ask'}
            </button>
            <p className="muted-copy">
              {askMode === 'rag_answer'
                ? 'One retrieval pass plus one provider call; the backend reserves the answer output budget before packaging.'
                : 'Retrieval only; no LLM provider is resolved or called.'}
            </p>
          </div>
        </form>

        {detailError ? (
          <div className="notice-banner" role="alert">
            <strong>Workspace overview unavailable:</strong> {detailError}
          </div>
        ) : null}

        {askError ? <AskErrorBanner error={askError} workspaceHref={workspaceHref} /> : null}

        {askResponse ? (
          <div className="page-stack">
            <AskResultHeader response={askResponse} />
            {askResponse.mode === 'chunks' ? (
              <SectionCard title="Retrieved chunks" eyebrow="Chunks mode">
                {sourceGroups.length === 0 ? (
                  <p className="muted-copy">No chunks were retrieved for this query.</p>
                ) : (
                  <div className="card-stack">
                    {sourceGroups.map((group) => (
                      <div key={group.key} className="resource-card">
                        <div className="resource-header">
                          <div>
                            <h3>{group.label}</h3>
                            <p className="muted-copy">
                              {group.items.length} chunk{group.items.length === 1 ? '' : 's'}
                              {group.revision ? ` · revision ${group.revision}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="card-stack">
                          {group.items.map((item) => (
                            <ChunkCard key={`${item.chunkId}-${item.score}`} item={item} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            ) : (
              <AskAnswerSection response={askResponse} />
            )}
            <AskTraceSection response={askResponse} workspaceHref={workspaceHref} />
          </div>
        ) : (
          <div className="empty-state">
            <h3>No ask run yet</h3>
            <p className="muted-copy">
              Enter a query, pick chunks or rag_answer mode, and run the backend /ask endpoint.
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function AskResultHeader({ response }: { response: AskResponse }) {
  const { diagnostics } = response;
  return (
    <div className="metric-grid compact">
      <div className="mini-stat">
        <span>Mode</span>
        <strong>{response.mode}</strong>
      </div>
      <div className="mini-stat">
        <span>Index</span>
        <strong>{response.indexVersionId}</strong>
      </div>
      <div className="mini-stat">
        <span>Context chunks</span>
        <strong>{response.contextPackage.count}</strong>
      </div>
      <div className="mini-stat">
        <span>Sources</span>
        <strong>{response.sourceIds.length}</strong>
      </div>
      <div className="mini-stat">
        <span>Retrieval</span>
        <strong>{diagnostics.retrievalLatencyMs} ms</strong>
      </div>
      <div className="mini-stat">
        <span>Generation</span>
        <strong>{diagnostics.generationLatencyMs} ms</strong>
      </div>
      <div className="mini-stat">
        <span>Total</span>
        <strong>{diagnostics.totalLatencyMs} ms</strong>
      </div>
    </div>
  );
}

function ChunkCard({ item }: { item: RetrievalTraceItem }) {
  const revision = itemRevision(item);
  return (
    <article className="trace-card">
      <div className="resource-header">
        <div>
          <h3>{item.path ?? item.documentId}</h3>
          <p className="muted-copy">
            Score {item.score.toFixed(3)}
            {item.startLine !== undefined || item.endLine !== undefined
              ? ` · lines ${item.startLine ?? '?'}-${item.endLine ?? '?'}`
              : ''}
          </p>
        </div>
        <span>{item.tokenCount ?? 'n/a'} tok</span>
      </div>
      <div className="resource-footer">
        {item.sourceId ? <span>Source: {item.sourceId}</span> : null}
        {revision ? <span>Revision: {revision}</span> : null}
        <span>Chunk: {item.chunkId}</span>
      </div>
      <pre className="trace-text">{item.text}</pre>
    </article>
  );
}

function AskAnswerSection({ response }: { response: AskResponse }) {
  const { diagnostics } = response;
  return (
    <>
      <SectionCard title="Answer" eyebrow="Generated with citations">
        {response.answer ? (
          <div className="card-stack">
            <div className="trace-card">
              <p>{response.answer}</p>
            </div>
            {response.citations.length > 0 ? (
              <div className="trace-card">
                <h3>Citations</h3>
                <p className="muted-copy">Provenance for each citation label used in the answer.</p>
                <div className="card-stack">
                  {response.citations.map((citation) => (
                    <div key={citation.id} className="resource-card">
                      <div className="resource-header">
                        <div>
                          <h3>{citation.id}</h3>
                          <p className="muted-copy">{citation.path ?? citation.documentId}</p>
                        </div>
                        <span>
                          {citation.startLine !== undefined || citation.endLine !== undefined
                            ? `lines ${citation.startLine ?? '?'}-${citation.endLine ?? '?'}`
                            : 'no line range'}
                        </span>
                      </div>
                      <div className="resource-footer">
                        <span>Document: {citation.documentId}</span>
                        <span>Chunk: {citation.chunkId}</span>
                        {citation.sourceId ? <span>Source: {citation.sourceId}</span> : null}
                        {citation.sourceRevisionId ? <span>Revision: {citation.sourceRevisionId}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="muted-copy">No citations were returned for this answer.</p>
            )}
          </div>
        ) : (
          <p className="muted-copy">The backend returned no answer text.</p>
        )}
      </SectionCard>

      {response.provider ? (
        <SectionCard title="Provider" eyebrow="Answer model">
          <div className="metric-grid compact">
            <div className="mini-stat">
              <span>Provider</span>
              <strong>{response.provider.name}</strong>
            </div>
            <div className="mini-stat">
              <span>Model</span>
              <strong>{response.provider.model}</strong>
            </div>
            <div className="mini-stat">
              <span>Protocol</span>
              <strong>{response.provider.protocol}</strong>
            </div>
            <div className="mini-stat">
              <span>Config</span>
              <strong>{response.provider.providerConfigId}</strong>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Diagnostics" eyebrow="Tokens and budget">
        <div className="metric-grid compact">
          <div className="mini-stat">
            <span>Input tokens</span>
            <strong>
              {diagnostics.inputTokens ?? 'n/a'} (est {diagnostics.estimatedInputTokens})
            </strong>
          </div>
          <div className="mini-stat">
            <span>Output tokens</span>
            <strong>
              {diagnostics.outputTokens ?? 'n/a'} (est {diagnostics.estimatedOutputTokens ?? 'n/a'})
            </strong>
          </div>
          <div className="mini-stat">
            <span>Max output</span>
            <strong>{diagnostics.maxOutputTokens ?? 'n/a'}</strong>
          </div>
          <div className="mini-stat">
            <span>Temperature</span>
            <strong>{diagnostics.temperature ?? 'n/a'}</strong>
          </div>
          <div className="mini-stat">
            <span>Finish reason</span>
            <strong>{diagnostics.finishReason ?? 'n/a'}</strong>
          </div>
        </div>
        <AskBudgetPanel budget={diagnostics.retrievalBudget} />
      </SectionCard>
    </>
  );
}

function AskBudgetPanel({ budget }: { budget: AskBudgetDiagnostics }) {
  const { reservedTokens } = budget;
  return (
    <div className="metric-grid compact">
      <div className="mini-stat">
        <span>Requested</span>
        <strong>{budget.requestedTokens}</strong>
      </div>
      <div className="mini-stat">
        <span>Retrieval budget</span>
        <strong>{budget.retrievalBudgetTokens}</strong>
      </div>
      <div className="mini-stat">
        <span>Used</span>
        <strong>{budget.usedTokens}</strong>
      </div>
      <div className="mini-stat">
        <span>Reserved</span>
        <strong>
          sys {reservedTokens.system} / instr {reservedTokens.instruction} / query {reservedTokens.query} / out{' '}
          {reservedTokens.output} / safety {reservedTokens.safety}
        </strong>
      </div>
      <div className="mini-stat">
        <span>Dropped items</span>
        <strong>{budget.droppedItems}</strong>
      </div>
      <div className="mini-stat">
        <span>Trimmed items</span>
        <strong>{budget.trimmedItems}</strong>
      </div>
      <div className="mini-stat">
        <span>Tokenizer</span>
        <strong>{budget.tokenizer.id}</strong>
      </div>
      <div className="mini-stat">
        <span>Budget reason</span>
        <strong>{budget.budgetReason}</strong>
      </div>
    </div>
  );
}

function AskTraceSection({ response, workspaceHref }: { response: AskResponse; workspaceHref: string }) {
  const { diagnostics } = response.retrievalTrace;
  return (
    <SectionCard title="Retrieval trace" eyebrow="Backend trace">
      <div className="metric-grid compact">
        <div className="mini-stat">
          <span>Trace ID</span>
          <strong>{response.retrievalTraceId}</strong>
        </div>
        <div className="mini-stat">
          <span>Profile</span>
          <strong>{response.retrievalTrace.retrievalProfile.key}</strong>
        </div>
        <div className="mini-stat">
          <span>Dense</span>
          <strong>{diagnostics.denseCandidates}</strong>
        </div>
        <div className="mini-stat">
          <span>Filtered</span>
          <strong>{diagnostics.filteredCandidates}</strong>
        </div>
        <div className="mini-stat">
          <span>Deduped</span>
          <strong>{response.retrievalTrace.stages.dedupedCandidates.length}</strong>
        </div>
        <div className="mini-stat">
          <span>Final</span>
          <strong>{diagnostics.finalCount}</strong>
        </div>
        <div className="mini-stat">
          <span>Reranked</span>
          <strong>{diagnostics.reranked ? 'yes' : 'no'}</strong>
        </div>
        <div className="mini-stat">
          <span>Collection</span>
          <strong>{diagnostics.serving.collectionName}</strong>
        </div>
        <div className="mini-stat">
          <span>Serving revision</span>
          <strong>{diagnostics.serving.servingRevisionId}</strong>
        </div>
      </div>
      <p className="muted-copy">
        <Link to={workspaceHref}>Open the workspace retrieval playground</Link> to re-run the query and inspect the full
        stage-by-stage trace.
      </p>
    </SectionCard>
  );
}

function AskErrorBanner({ error, workspaceHref }: { error: Error; workspaceHref: string }) {
  const structured = error instanceof ApiRequestError ? error : null;
  const details = structured?.details;
  return (
    <div className="notice-banner" role="alert" aria-live="assertive">
      <strong>{`Ask error${structured?.code ? `: ${structured.code}` : ''}:`}</strong> {error.message}
      {structured?.stage ? <span> · stage {structured.stage}</span> : null}
      {structured?.retryable ? <span> · retryable</span> : null}
      {details && Object.keys(details).length > 0 ? (
        <pre className="trace-text">{JSON.stringify(details, null, 2)}</pre>
      ) : null}
      <p className="muted-copy">
        The workspace and existing retrieval data are unchanged. Retry the request or{' '}
        <Link to={workspaceHref}>return to the workspace retrieval playground</Link>.
      </p>
    </div>
  );
}
