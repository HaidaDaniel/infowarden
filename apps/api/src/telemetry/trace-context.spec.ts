import {
  createTraceContext,
  parseTraceparent,
  sanitizeAttributes,
  toTraceparent,
} from './trace-context';

describe('trace context', () => {
  it('parses and emits W3C traceparent headers', () => {
    const parsed = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    expect(parsed).toMatchObject({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
      sampled: true,
    });

    const child = createTraceContext(parsed);
    expect(child.traceId).toBe(parsed?.traceId);
    expect(toTraceparent(child)).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('drops secrets and content-like fields from telemetry attributes', () => {
    expect(
      sanitizeAttributes({
        vectorBackendId: 'default-qdrant',
        apiKey: 'secret',
        authorization: 'Bearer secret',
        chunkText: 'source content',
        documentBody: 'body',
        count: 3,
      }),
    ).toEqual({
      vectorBackendId: 'default-qdrant',
      count: 3,
    });
  });

  it('redacts secret-like values, URL credentials, and structured payloads', () => {
    expect(
      sanitizeAttributes({
        providerError: 'upstream said Authorization: Bearer sk-test-secret',
        callbackUrl: 'https://user:pass@example.test/v1?api_key=sk-test-secret&q=ok',
        sourceUrl: 'https://example.test/search?q=source%20content',
        payloadSummary: { body: 'source content', nested: ['raw'] },
        safeMetadata: { nested: 'value' },
        ids: ['a', 'b', 'c'],
        model: 'BAAI/bge-small-en-v1.5',
      }),
    ).toEqual({
      providerError: '[redacted]',
      callbackUrl: 'https://example.test/v1?api_key=%5Bredacted%5D&q=ok',
      sourceUrl: 'https://example.test/search?q=%5Bredacted%5D',
      safeMetadata: '[object]',
      ids: '[array:3]',
      model: 'BAAI/bge-small-en-v1.5',
    });
  });
});
