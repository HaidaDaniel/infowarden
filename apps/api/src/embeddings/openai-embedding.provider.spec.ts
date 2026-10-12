import { of, throwError } from 'rxjs';
import { OpenAICompatibleProvider } from './openai-embedding.provider';

describe('OpenAICompatibleProvider', () => {
  it('preflights successfully with a valid embedding response', async () => {
    const http = createHttp({
      data: {
        data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      },
    });
    const provider = createProvider(http);

    await expect(provider.preflight()).resolves.toMatchObject({
      status: 'up',
      model: 'test-embedding',
      dimension: 3,
      baseUrl: 'http://embedding.local:8080/v1',
    });
    expect(http.post).toHaveBeenCalledWith(
      'http://embedding.local:8080/v1/embeddings',
      expect.objectContaining({
        model: 'test-embedding',
      }),
      expect.objectContaining({
        timeout: 1000,
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
  });

  it('reports missing API key as not configured', async () => {
    const provider = createProvider(createHttp(), { EMBEDDING_API_KEY: '' });

    await expect(provider.preflight()).resolves.toMatchObject({
      status: 'not_configured',
      error: {
        code: 'embedding_api_key_missing',
        stage: 'config',
        retryable: false,
      },
    });
  });

  it('maps invalid credentials', async () => {
    const provider = createProvider(
      createHttpError({
        response: {
          status: 401,
          data: { error: { message: 'bad key' } },
        },
      }),
    );

    await expect(provider.embedTexts(['hello'])).rejects.toMatchObject({
      code: 'embedding_invalid_credentials',
      stage: 'embed',
      retryable: false,
    });
  });

  it('maps unavailable models', async () => {
    const provider = createProvider(
      createHttpError({
        response: {
          status: 404,
          data: { error: { message: 'model not found' } },
        },
      }),
    );

    await expect(provider.embedTexts(['hello'])).rejects.toMatchObject({
      code: 'embedding_model_not_found',
    });
  });

  it('maps timeout and unreachable provider failures', async () => {
    const timeoutProvider = createProvider(createHttpError({ code: 'ECONNABORTED' }));
    const dnsProvider = createProvider(createHttpError({ code: 'ENOTFOUND' }));

    await expect(timeoutProvider.embedTexts(['hello'])).rejects.toMatchObject({
      code: 'embedding_timeout',
      retryable: true,
    });
    await expect(dnsProvider.embedTexts(['hello'])).rejects.toMatchObject({
      code: 'embedding_dns_failure',
      retryable: true,
    });
  });

  it('rejects invalid response shapes and dimension mismatches', async () => {
    const invalidProvider = createProvider(createHttp({ data: { result: [] } }));
    const mismatchProvider = createProvider(
      createHttp({
        data: {
          data: [{ index: 0, embedding: [0.1, 0.2] }],
        },
      }),
    );

    await expect(invalidProvider.embedTexts(['hello'])).rejects.toMatchObject({
      code: 'embedding_invalid_response',
    });
    await expect(mismatchProvider.embedTexts(['hello'])).rejects.toMatchObject({
      code: 'embedding_dimension_mismatch',
      details: expect.objectContaining({
        expectedDimension: 3,
        actualDimension: 2,
      }),
    });
  });
});

function createProvider(http: any, overrides: Record<string, string | number> = {}) {
  const values = {
    EMBEDDING_API_KEY: 'test-key',
    EMBEDDING_BASE_URL: 'http://embedding.local:8080/v1',
    EMBEDDING_MODEL: 'test-embedding',
    EMBEDDING_DIMENSION: 3,
    EMBEDDING_TIMEOUT_MS: 1000,
    ...overrides,
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback,
    ),
  };

  return new OpenAICompatibleProvider(http, config as any);
}

function createHttp(response: any = { data: { data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] } }) {
  return {
    post: jest.fn().mockReturnValue(of(response)),
  };
}

function createHttpError(error: any) {
  return {
    post: jest.fn().mockReturnValue(throwError(() => error)),
  };
}
