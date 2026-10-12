import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

describe('App populated states', () => {
  it('renders dashboard content from admin endpoints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);

        if (url.endsWith('/admin/dashboard')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                totals: { knowledgeBases: 1, sources: 1, documents: 25, activeIndexes: 1 },
                jobs: { queued: 0, running: 0, succeeded: 1, failed: 0 },
                lastSuccessfulIndexAt: '2026-05-12T16:56:07.305Z',
                recentJobs: [],
                system: {
                  health: {
                    status: 'healthy',
                    timestamp: '2026-05-24T18:30:00.000Z',
                    services: {
                      database: { status: 'up' },
                      redis: { status: 'up' },
                      qdrant: { status: 'up' },
                      embeddings: { status: 'up' },
                    },
                  },
                  queue: {
                    queued: 0,
                    running: 0,
                    succeededLastHour: 1,
                    failedLast24Hours: 0,
                    pressure: 'idle',
                  },
                  workspaceKinds: {
                    codebase: 1,
                  },
                  collections: {
                    totalActiveCollections: 1,
                    totalChunks: 54,
                    items: [
                      {
                        knowledgeBaseId: 'kb-1',
                        knowledgeBaseSlug: 'career-rag',
                        knowledgeBaseName: 'Career RAG',
                        workspaceKind: 'codebase',
                        indexVersionId: 'idx-1',
                        vectorCollectionName: 'kb-kb-1',
                        materializationMode: 'mutable_collection',
                        chunkCount: 54,
                        createdAt: '2026-05-12T16:56:07.305Z',
                        embeddingModel: 'qwen3-embedding-4b',
                        embeddingDimension: 2560,
                      },
                    ],
                  },
                },
              }),
            ),
          );
        }

        if (url.endsWith('/admin/knowledge-bases')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                knowledgeBases: [
                  {
                    id: 'kb-1',
                    slug: 'career-rag',
                    name: 'Career RAG',
                    description: 'Profile workspace',
                    activeIndexVersionId: 'idx-1',
                    createdAt: '2026-05-12T16:49:36.320Z',
                    updatedAt: '2026-05-12T16:56:07.305Z',
                    counts: {
                      sources: 1,
                      activeSources: 1,
                      documents: 25,
                      indexVersions: 1,
                      jobs: 1,
                    },
                    lastSuccessfulIndexAt: '2026-05-12T16:56:07.305Z',
                    lastJobStatus: 'succeeded',
                    lastErrorSummary: null,
                  },
                ],
              }),
            ),
          );
        }

        if (url.includes('/admin/jobs/recent')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                filters: { knowledgeBaseId: null, knowledgeBaseSlug: null, sourceId: null, limit: 8 },
                jobs: [
                  {
                    id: 'job-1',
                    knowledgeBase: { id: 'kb-1', slug: 'career-rag', name: 'Career RAG' },
                    source: { id: 'src-1', type: 'local_folder', uri: '/data/career', status: 'active' },
                    type: 'scan_source',
                    status: 'succeeded',
                    createdAt: '2026-05-12T16:55:57.403Z',
                    startedAt: '2026-05-12T16:55:57.412Z',
                    finishedAt: '2026-05-12T16:56:07.305Z',
                    progress: {
                      added: 25,
                      changed: 0,
                      deleted: 0,
                      unchanged: 0,
                      filesScanned: 25,
                      filesParsed: 25,
                      filesIgnored: 0,
                      parseFailures: 0,
                      chunksCreated: 54,
                      vectorsDeleted: 0,
                      vectorsUpserted: 54,
                      documentsCreated: 25,
                      documentsChanged: 0,
                      documentsDeleted: 0,
                      documentsSkipped: 0,
                      validationReportId: 'vr-1',
                    },
                    lastErrorSummary: null,
                    lastLogAt: '2026-05-12T16:56:07.305Z',
                  },
                ],
              }),
            ),
          );
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Career RAG').length).toBeGreaterThan(0);
      expect(screen.getByText('/data/career')).toBeInTheDocument();
      expect(screen.getByText('Profile workspace')).toBeInTheDocument();
    });
  });
});
