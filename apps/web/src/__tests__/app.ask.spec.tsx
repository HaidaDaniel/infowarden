import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

function workspaceDetailFixture() {
  return {
    knowledgeBase: {
      id: 'kb-1',
      slug: 'career-rag',
      name: 'Career RAG',
      description: 'Profile workspace',
      workspaceKind: 'codebase',
      defaultRetrievalProfile: 'code-debug',
      activeIndexVersionId: 'idx-1',
      createdAt: '2026-05-12T16:49:36.320Z',
      updatedAt: '2026-05-12T16:56:07.305Z',
      counts: {
        sources: 1,
        documents: 1,
        indexVersions: 1,
        jobs: 0,
      },
      lastSuccessfulIndexAt: '2026-05-12T16:56:07.305Z',
      lastJobStatus: 'succeeded',
      lastErrorSummary: null,
      activeIndexVersion: {
        id: 'idx-1',
        status: 'active',
        createdAt: '2026-05-12T16:56:07.305Z',
        embeddingModel: 'qwen3-embedding-4b',
        embeddingDimension: 2560,
        vectorCollectionName: 'kb-kb-1',
        materializationMode: 'mutable_collection',
      },
      indexVersions: [],
      sources: [],
    },
    recentJobs: [],
    explorer: {
      documentLimit: 50,
      documents: [],
    },
    retrievalPlayground: {
      defaultProfileKey: 'code-debug',
      profiles: [
        {
          key: 'code-debug',
          name: 'Code Debug',
          intent: 'code_search',
          denseTopK: 10,
          scoreThreshold: null,
          neighborBefore: 1,
          neighborAfter: 1,
          tokenBudget: 1500,
          grouping: 'path',
          recencyBoost: false,
        },
      ],
      activeCollection: {
        indexVersionId: 'idx-1',
        vectorCollectionName: 'kb-kb-1',
        materializationMode: 'mutable_collection',
        embeddingModel: 'qwen3-embedding-4b',
        embeddingDimension: 2560,
        createdAt: '2026-05-12T16:56:07.305Z',
      },
      suggestedRequest: {
        queryPlaceholder: 'Find the relevant context',
        topK: 6,
        tokenBudget: 1200,
      },
    },
  };
}

function askContextItems() {
  return [
    {
      text: 'Queue pressure comes from queued and running job counts.',
      score: 0.91,
      documentId: 'doc-profile',
      chunkId: 'chunk-profile-1',
      sourceId: 'src-1',
      path: 'notes/profile.md',
      mimeType: 'text/markdown',
      language: 'markdown',
      startLine: 12,
      endLine: 18,
      tokenCount: 32,
      metadata: { sourceRevisionId: 'rev-1' },
    },
    {
      text: 'Career RAG workspace keeps project notes for interview prep.',
      score: 0.74,
      documentId: 'doc-context',
      chunkId: 'chunk-context-1',
      sourceId: 'src-2',
      path: 'projects/contextforge.md',
      mimeType: 'text/markdown',
      language: 'markdown',
      startLine: 4,
      endLine: 9,
      tokenCount: 21,
      metadata: { sourceRevisionId: 'rev-2' },
    },
  ];
}

function askBudget(mode: 'chunks' | 'rag_answer') {
  return {
    tokenizer: { id: 'qwen3-est', modelFamily: 'qwen3', approximate: true },
    requestedTokens: 1200,
    reservedTokens: {
      system: 24,
      instruction: 8,
      query: 10,
      output: mode === 'rag_answer' ? 512 : 0,
      safety: 32,
    },
    retrievalBudgetTokens: mode === 'rag_answer' ? 626 : 1126,
    usedTokens: 53,
    droppedItems: 0,
    trimmedItems: 0,
    budgetReason: 'fit',
  };
}

function askCitations() {
  return [
    {
      id: 'C1',
      chunkId: 'chunk-profile-1',
      documentId: 'doc-profile',
      sourceId: 'src-1',
      sourceRevisionId: 'rev-1',
      path: 'notes/profile.md',
      startLine: 12,
      endLine: 18,
    },
    {
      id: 'C2',
      chunkId: 'chunk-context-1',
      documentId: 'doc-context',
      sourceId: 'src-2',
      sourceRevisionId: 'rev-2',
      path: 'projects/contextforge.md',
      startLine: 4,
      endLine: 9,
    },
  ];
}

function askResponseFixture(mode: 'chunks' | 'rag_answer') {
  const items = askContextItems();
  const budget = askBudget(mode);
  const contextPackage = {
    count: items.length,
    budget: { requestedTokens: 1200, estimatedTokens: 53 },
    groups: [
      { title: 'notes/profile.md', kind: 'docs', items: [items[0]] },
      { title: 'projects/contextforge.md', kind: 'docs', items: [items[1]] },
    ],
  };

  return {
    mode,
    knowledgeBaseId: 'kb-1',
    indexVersionId: 'idx-1',
    query: 'Where is queue pressure explained?',
    retrievalTraceId: 'trace-ask-1',
    retrievalTrace: {
      knowledgeBaseId: 'kb-1',
      indexVersionId: 'idx-1',
      query: 'Where is queue pressure explained?',
      retrievalProfile: {
        key: 'code-debug',
        name: 'Code Debug',
        intent: 'code_search',
        denseTopK: 10,
        lexicalEnabled: false,
        lexicalTopK: 0,
        neighborBefore: 1,
        neighborAfter: 1,
        tokenBudget: 1500,
        grouping: 'path',
        recencyBoost: false,
      },
      stages: {
        denseCandidates: items,
        filteredCandidates: items,
        dedupedCandidates: items,
        expandedCandidates: items,
        finalCandidates: items,
      },
      contextPackage,
      diagnostics: {
        serving: {
          servingRevisionId: 'serving-1',
          sourceRevisionIds: ['rev-1', 'rev-2'],
          vectorBackendId: 'backend-1',
          collectionName: 'kb-kb-1',
          filterPlacement: 'pre_topk',
        },
        denseCandidates: items.length,
        lexicalCandidates: 0,
        mergedCandidates: items.length,
        filteredCandidates: items.length,
        droppedByFilters: 0,
        droppedDuplicates: 0,
        droppedNearDuplicates: 0,
        expandedNeighbors: 0,
        neighborExpansionQueries: 0,
        finalCount: items.length,
        reranked: false,
        rerankerFallbackUsed: false,
        rerankerCandidateCount: 0,
        budget,
      },
    },
    contextPackage,
    citations: askCitations(),
    sourceIds: ['src-1', 'src-2'],
    ...(mode === 'rag_answer'
      ? {
          answer:
            'Queue pressure is derived from queued and running job counts [C1], with career notes kept in the workspace [C2].',
          provider: {
            providerConfigId: 'prov-1',
            name: 'local-llm',
            model: 'qwen3-14b',
            protocol: 'openai_compatible',
          },
        }
      : {}),
    diagnostics: {
      retrievalLatencyMs: 42,
      generationLatencyMs: mode === 'rag_answer' ? 830 : 0,
      totalLatencyMs: mode === 'rag_answer' ? 876 : 45,
      estimatedInputTokens: mode === 'rag_answer' ? 405 : 0,
      ...(mode === 'rag_answer'
        ? {
            inputTokens: 410,
            outputTokens: 64,
            estimatedOutputTokens: 40,
            maxOutputTokens: 512,
            temperature: 0.2,
            finishReason: 'stop',
          }
        : {}),
      retrievalBudget: budget,
    },
  };
}

function stubAskFetch(askBodies: Array<Record<string, unknown>>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/admin/knowledge-bases/career-rag')) {
        return Promise.resolve(new Response(JSON.stringify(workspaceDetailFixture())));
      }

      if (url.endsWith('/workspaces/career-rag/ask') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        askBodies.push(body);

        if (typeof body.query === 'string' && body.query.includes('provider down')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: 'llm_unavailable',
                  message: 'Answer LLM provider is unavailable',
                  stage: 'generate_answer',
                  retryable: true,
                  details: { providerConfigId: 'prov-1', model: 'qwen3-14b' },
                },
                path: '/workspaces/career-rag/ask',
                timestamp: '2026-06-05T09:00:00.000Z',
              }),
              { status: 503 },
            ),
          );
        }

        if (typeof body.query === 'string' && body.query.includes('budget empty')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: 'answer_output_budget_empty',
                  message: 'Retrieval profile reserves no tokens for answer generation',
                  stage: 'prepare_answer_budget',
                  retryable: false,
                  details: { reservedOutputTokens: 0 },
                },
                path: '/workspaces/career-rag/ask',
                timestamp: '2026-06-05T09:00:00.000Z',
              }),
              { status: 422 },
            ),
          );
        }

        const mode = (body.mode as 'chunks' | 'rag_answer' | undefined) ?? 'chunks';
        return Promise.resolve(new Response(JSON.stringify(askResponseFixture(mode))));
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    }),
  );
}

describe('App Ask playground', () => {
  it('runs chunks mode and groups retrieved chunks by source with provenance', async () => {
    const askBodies: Array<Record<string, unknown>> = [];
    stubAskFetch(askBodies);

    render(
      <MemoryRouter initialEntries={['/workspaces/career-rag/ask']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Career RAG' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: 'Open the workspace retrieval playground' })).not.toBeInTheDocument();
    expect(screen.getByText('No ask run yet')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Query'), {
      target: { value: 'Where is queue pressure explained?' },
    });
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'chunks' } });
    fireEvent.change(screen.getByLabelText('Path prefix'), { target: { value: 'notes/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run ask' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Retrieved chunks' })).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'src-1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'src-2' })).toBeInTheDocument();
    expect(screen.getAllByText('notes/profile.md').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/lines 12-18/).length).toBeGreaterThan(0);
    expect(screen.getByText('Revision: rev-1')).toBeInTheDocument();
    expect(screen.getByText('Revision: rev-2')).toBeInTheDocument();
    expect(screen.getByText('trace-ask-1')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();

    expect(askBodies).toEqual([
      {
        query: 'Where is queue pressure explained?',
        mode: 'chunks',
        profileKey: 'code-debug',
        topK: 6,
        tokenBudget: 1200,
        filters: { pathPrefix: 'notes/' },
      },
    ]);
  });

  it('runs rag_answer mode and displays answer, citations, provider, and diagnostics', async () => {
    const askBodies: Array<Record<string, unknown>> = [];
    stubAskFetch(askBodies);

    render(
      <MemoryRouter initialEntries={['/workspaces/career-rag/ask']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Career RAG' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Query'), {
      target: { value: 'Where is queue pressure explained?' },
    });
    fireEvent.change(screen.getByLabelText('LLM provider'), { target: { value: 'local-llm-2' } });
    fireEvent.change(screen.getByLabelText('Max output tokens'), { target: { value: '1024' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run ask' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Answer' })).toBeInTheDocument();
    });

    expect(screen.getByText(/Queue pressure is derived from queued and running job counts/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Citations' })).toBeInTheDocument();
    expect(screen.getAllByText('C1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('C2').length).toBeGreaterThan(0);
    expect(screen.getByText('local-llm')).toBeInTheDocument();
    expect(screen.getByText('qwen3-14b')).toBeInTheDocument();
    expect(screen.getByText('openai_compatible')).toBeInTheDocument();
    expect(screen.getByText('830 ms')).toBeInTheDocument();
    expect(screen.getByText('876 ms')).toBeInTheDocument();
    expect(screen.getByText(/est 405/)).toBeInTheDocument();
    expect(screen.getByText('512')).toBeInTheDocument();
    expect(screen.getByText('stop')).toBeInTheDocument();
    expect(screen.getByText(/sys 24 \/ instr 8 \/ query 10 \/ out 512 \/ safety 32/)).toBeInTheDocument();
    expect(screen.getByText('626')).toBeInTheDocument();
    expect(screen.getByText('trace-ask-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the workspace retrieval playground' })).toHaveAttribute(
      'href',
      '/workspaces/career-rag',
    );

    expect(askBodies).toEqual([
      {
        query: 'Where is queue pressure explained?',
        mode: 'rag_answer',
        profileKey: 'code-debug',
        topK: 6,
        tokenBudget: 1200,
        llm: { providerName: 'local-llm-2', maxOutputTokens: 1024 },
      },
    ]);
  });

  it('displays structured provider and budget errors from the backend', async () => {
    const askBodies: Array<Record<string, unknown>> = [];
    stubAskFetch(askBodies);

    render(
      <MemoryRouter initialEntries={['/workspaces/career-rag/ask']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Career RAG' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'provider down' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run ask' }));

    await waitFor(() => {
      expect(screen.getByText('Ask error: llm_unavailable:')).toBeInTheDocument();
    });
    const providerBanner = screen.getByText('Ask error: llm_unavailable:').parentElement as HTMLElement;
    expect(providerBanner).toHaveTextContent('Answer LLM provider is unavailable');
    expect(providerBanner).toHaveTextContent('stage generate_answer');
    expect(providerBanner).toHaveTextContent('retryable');
    expect(providerBanner).toHaveTextContent('"providerConfigId": "prov-1"');

    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'budget empty' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run ask' }));

    await waitFor(() => {
      expect(screen.getByText('Ask error: answer_output_budget_empty:')).toBeInTheDocument();
    });
    const budgetBanner = screen.getByText('Ask error: answer_output_budget_empty:').parentElement as HTMLElement;
    expect(budgetBanner).toHaveTextContent('Retrieval profile reserves no tokens for answer generation');
    expect(budgetBanner).toHaveTextContent('stage prepare_answer_budget');

    expect(askBodies.length).toBe(2);
  });
});
