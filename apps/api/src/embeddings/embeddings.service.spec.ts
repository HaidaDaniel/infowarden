import { EmbeddingsService } from './embeddings.service';

describe('EmbeddingsService', () => {
  it('uses the injected provider without manual setProvider wiring', async () => {
    const provider = {
      embedTexts: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      preflight: jest.fn().mockResolvedValue({ status: 'up' }),
      assertReady: jest.fn().mockResolvedValue(undefined),
    };
    const providersService = {
      resolveEmbeddingProvider: jest.fn().mockResolvedValue({
        source: 'environment',
        name: 'environment',
        baseUrl: 'http://embedding.local/v1',
        model: 'test-embedding',
        dimension: 3,
        apiKey: 'test-key',
        apiKeyRef: 'EMBEDDING_API_KEY',
        timeoutMs: 1000,
        protocol: 'openai_compatible',
      }),
    };
    const service = new EmbeddingsService(provider as any, providersService as any);

    await expect(service.embedTexts(['hello'])).resolves.toEqual([[0.1, 0.2, 0.3]]);
    await expect(service.preflight()).resolves.toEqual({ status: 'up' });
    await expect(service.assertReady()).resolves.toBeUndefined();
    expect(provider.embedTexts).toHaveBeenCalledWith(
      ['hello'],
      expect.objectContaining({ model: 'test-embedding' }),
    );
  });
});
