import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

describe('App import flow', () => {
  it('creates a workspace, uploads a managed source, and shows indexing progress', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, method: init?.method ?? 'GET', body: init?.body });

        if (url.endsWith('/admin/knowledge-bases')) {
          return Promise.resolve(new Response(JSON.stringify({ knowledgeBases: [] })));
        }

        if (url.endsWith('/workspaces') && init?.method === 'POST') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'kb-new',
                slug: 'research-docs',
                name: 'Research Docs',
                description: 'Uploaded papers',
                workspaceKind: 'datasets',
                defaultIndexProfile: 'dataset-default',
                defaultRetrievalProfile: 'dataset-search',
                activeIndexVersionId: null,
                createdAt: '2026-05-28T12:00:00.000Z',
                updatedAt: '2026-05-28T12:00:00.000Z',
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/research-docs/sources/upload') && init?.method === 'POST') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                workspace: {
                  id: 'kb-new',
                  slug: 'research-docs',
                  name: 'Research Docs',
                  workspaceKind: 'datasets',
                },
                upload: {
                  id: 'upload-1',
                  originalFileName: 'dataset.zip',
                  archiveFormat: 'zip',
                  sizeBytes: 512,
                  fileCount: 2,
                  contentBytes: 2048,
                  uploadedAt: '2026-05-28T12:01:00.000Z',
                },
                source: {
                  id: 'src-upload-1',
                  knowledgeBaseId: 'kb-new',
                  type: 'upload',
                  uri: 'upload://upload-1',
                  includeRules: ['**/*.md'],
                  excludeRules: [],
                  status: 'active',
                  metadata: { uploadId: 'upload-1' },
                  createdAt: '2026-05-28T12:01:00.000Z',
                  updatedAt: '2026-05-28T12:01:00.000Z',
                },
                next: {
                  enqueueIndexing: {
                    method: 'POST',
                    path: '/jobs/indexing',
                    body: {
                      knowledgeBaseId: 'kb-new',
                      sourceId: 'src-upload-1',
                      type: 'scan_source',
                    },
                  },
                },
              }),
            ),
          );
        }

        if (url.endsWith('/jobs/indexing') && init?.method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify({ id: 'job-upload-1' })));
        }

        if (url.endsWith('/jobs/indexing/job-upload-1')) {
          return Promise.resolve(new Response(JSON.stringify(createJobDetail('succeeded'))));
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/import']}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText('Workspace action'), {
      target: { value: 'new' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Research Docs' },
    });
    fireEvent.change(screen.getByLabelText('Slug'), {
      target: { value: 'research-docs' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Uploaded papers' },
    });
    fireEvent.change(screen.getByLabelText('Dataset file or ZIP'), {
      target: {
        files: [new File(['zip bytes'], 'dataset.zip', { type: 'application/zip' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and start indexing' }));

    await waitFor(() => {
      expect(screen.getByText('Managed source')).toBeInTheDocument();
      expect(screen.getByText('upload://upload-1')).toBeInTheDocument();
      expect(screen.getByText('Open job detail')).toBeInTheDocument();
      expect(screen.getByText('Indexing completed')).toBeInTheDocument();
    });

    const workspaceRequest = requests.find((request) => request.url.endsWith('/workspaces'));
    expect(JSON.parse(String(workspaceRequest?.body))).toMatchObject({
      name: 'Research Docs',
      slug: 'research-docs',
      workspaceKind: 'datasets',
    });
    const uploadRequest = requests.find((request) =>
      request.url.endsWith('/workspaces/research-docs/sources/upload'),
    );
    expect(uploadRequest?.body).toBeInstanceOf(FormData);
    const enqueueRequest = requests.find(
      (request) => request.url.endsWith('/jobs/indexing') && request.method === 'POST',
    );
    expect(JSON.parse(String(enqueueRequest?.body))).toEqual({
      knowledgeBaseId: 'kb-new',
      sourceId: 'src-upload-1',
      type: 'scan_source',
    });
  });

  it('surfaces structured managed upload errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith('/admin/knowledge-bases')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                knowledgeBases: [
                  {
                    id: 'kb-1',
                    slug: 'career-rag',
                    name: 'Career RAG',
                    description: null,
                    activeIndexVersionId: null,
                    createdAt: '2026-05-28T12:00:00.000Z',
                    updatedAt: '2026-05-28T12:00:00.000Z',
                    counts: {
                      sources: 0,
                      activeSources: 0,
                      documents: 0,
                      indexVersions: 0,
                      jobs: 0,
                    },
                    lastSuccessfulIndexAt: null,
                    lastJobStatus: null,
                    lastErrorSummary: null,
                  },
                ],
              }),
            ),
          );
        }

        if (url.endsWith('/workspaces/career-rag/sources/upload') && init?.method === 'POST') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: 'managed_upload_unsupported_file',
                  message: 'Only ZIP archives and text-like files are supported by the MVP upload importer',
                },
              }),
              { status: 400 },
            ),
          );
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/import']}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText('Dataset file or ZIP'), {
      target: {
        files: [new File(['png'], 'image.png', { type: 'image/png' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and start indexing' }));

    await waitFor(() => {
      expect(screen.getByText(/managed_upload_unsupported_file/)).toBeInTheDocument();
    });
  });
});

function createJobDetail(status: 'queued' | 'running' | 'succeeded' | 'failed') {
  return {
    id: 'job-upload-1',
    knowledgeBaseId: 'kb-new',
    sourceId: 'src-upload-1',
    type: 'scan_source',
    status,
    stats: {
      filesScanned: 2,
      filesParsed: 2,
      chunksCreated: 4,
      vectorsUpserted: 4,
      parseFailures: 0,
      added: 2,
      changed: 0,
      deleted: 0,
    },
    logs: [
      {
        level: 'info',
        message: 'Indexing completed',
        at: '2026-05-28T12:02:00.000Z',
        data: { sourceType: 'upload' },
      },
    ],
    startedAt: '2026-05-28T12:01:30.000Z',
    finishedAt: '2026-05-28T12:02:00.000Z',
    createdAt: '2026-05-28T12:01:20.000Z',
  };
}
