import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

describe('App empty dashboard', () => {
  it('shows empty states when the admin endpoints have no data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);

        if (url.endsWith('/admin/dashboard')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                totals: { knowledgeBases: 0, sources: 0, documents: 0, activeIndexes: 0 },
                jobs: { queued: 0, running: 0, succeeded: 0, failed: 0 },
                lastSuccessfulIndexAt: null,
                recentJobs: [],
              }),
            ),
          );
        }

        if (url.endsWith('/admin/knowledge-bases')) {
          return Promise.resolve(new Response(JSON.stringify({ knowledgeBases: [] })));
        }

        if (url.includes('/admin/jobs/recent')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                filters: { knowledgeBaseId: null, knowledgeBaseSlug: null, sourceId: null, limit: 8 },
                jobs: [],
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
      expect(screen.getByText('No workspaces yet')).toBeInTheDocument();
      expect(screen.getByText('No indexing jobs yet')).toBeInTheDocument();
    });
  });
});
