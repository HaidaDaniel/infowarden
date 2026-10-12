import { Logger } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { createTraceContext, parseTraceparent } from './trace-context';

describe('TelemetryService', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('keeps one trace across request, job, retrieval, provider, and backend events without leaking samples', async () => {
    const telemetry = new TelemetryService();
    const root = createTraceContext(
      parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'),
    );

    await telemetry.runWithContext(root, async () => {
      telemetry.record('info', 'http.request', {
        'http.route': '/knowledge-bases/kb-1/search',
        requestBody: 'source content should not be logged',
      });

      await telemetry.span(
        'bullmq.process',
        {
          jobId: 'job-1',
          jobType: 'scan_source',
          attempt: 2,
        },
        async () => {
          telemetry.record('info', 'retrieval.pipeline', {
            knowledgeBaseId: 'kb-1',
            servingRevisionId: 'srv-1',
            profileKey: 'hybrid',
            vectorBackendId: 'qdrant-b',
            collectionName: 'kb-kb-1-active',
            queryText: 'private source query',
          });

          await telemetry.span(
            'embedding.request',
            {
              providerConfigId: 'provider-1',
              providerSource: 'provider_config',
              model: 'BAAI/bge-small-en-v1.5',
              providerError: 'upstream returned Authorization: Bearer sk-test-secret',
            },
            async () => undefined,
          );

          telemetry.record('info', 'qdrant.search', {
            vectorBackendId: 'qdrant-b',
            collectionName: 'kb-kb-1-active',
            payload: { chunkText: 'source content' },
            url: 'https://user:pass@qdrant.example/collections?api_key=sk-test-secret',
          });
        },
      );
    });

    const events = logSpy.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(new Set(events.map((event) => event.traceId))).toEqual(
      new Set(['4bf92f3577b34da6a3ce929d0e0e4736']),
    );

    const serialized = JSON.stringify(events);
    expect(serialized).toContain('http.request');
    expect(serialized).toContain('bullmq.process');
    expect(serialized).toContain('retrieval.pipeline');
    expect(serialized).toContain('embedding.request');
    expect(serialized).toContain('qdrant.search');
    expect(serialized).toContain('job-1');
    expect(serialized).toContain('srv-1');
    expect(serialized).toContain('provider-1');
    expect(serialized).toContain('qdrant-b');
    expect(serialized).not.toContain('sk-test-secret');
    expect(serialized).not.toContain('source content');
    expect(serialized).not.toContain('private source query');
    expect(serialized).not.toContain('user:pass');
  });
});
