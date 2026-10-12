import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { setStoredApiKey } from '../lib/api';

function emptyDashboardResponse(path: string) {
  if (path.endsWith('/admin/dashboard')) {
    return new Response(
      JSON.stringify({
        totals: { knowledgeBases: 0, sources: 0, documents: 0, activeIndexes: 0 },
        jobs: { queued: 0, running: 0, succeeded: 0, failed: 0 },
        lastSuccessfulIndexAt: null,
        recentJobs: [],
        system: {
          health: {
            status: 'healthy',
            timestamp: '2026-05-26T00:00:00.000Z',
            services: {},
          },
          queue: {
            queued: 0,
            running: 0,
            succeededLastHour: 0,
            failedLast24Hours: 0,
            pressure: 'idle',
          },
          workspaceKinds: {},
          collections: {
            totalActiveCollections: 0,
            totalChunks: 0,
            items: [],
          },
        },
      }),
    );
  }

  if (path.endsWith('/admin/knowledge-bases')) {
    return new Response(JSON.stringify({ knowledgeBases: [] }));
  }

  if (path.includes('/admin/jobs/recent')) {
    return new Response(
      JSON.stringify({
        filters: { knowledgeBaseId: null, knowledgeBaseSlug: null, sourceId: null, limit: 8 },
        jobs: [],
      }),
    );
  }

  throw new Error(`Unexpected request: ${path}`);
}

describe('App connection auth', () => {
  it('shows an actionable message when the backend requires an API key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))),
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/API key required or invalid/)).toBeInTheDocument();
      expect(screen.getByText('No API key configured.')).toBeInTheDocument();
    });
  });

  it('sends a saved admin API key on Studio API requests', async () => {
    setStoredApiKey('secret-key');
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      return Promise.resolve(emptyDashboardResponse(url));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Key saved locally for this browser.')).toBeInTheDocument();
      expect(screen.getByText('No workspaces yet')).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/admin/dashboard'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer secret-key',
        },
      }),
    );
  });
});
