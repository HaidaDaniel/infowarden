import { ProviderType } from '@prisma/client';
import { ProvidersService } from './providers.service';

describe('ProvidersService', () => {
  it('falls back to environment embedding config when no stored provider matches', async () => {
    const { service, prisma } = createService();
    prisma.providerConfig.findMany.mockResolvedValue([]);

    await expect(service.resolveEmbeddingProvider()).resolves.toMatchObject({
      source: 'environment',
      model: 'env-embedding',
      dimension: 384,
      apiKey: 'env-key',
      apiKeyRef: 'EMBEDDING_API_KEY',
    });
  });

  it('resolves an explicit retrieval profile embedding provider config', async () => {
    const { service, prisma } = createService({ LOCAL_EMBEDDING_KEY: 'local-key' });
    prisma.providerConfig.findMany.mockResolvedValue([
      providerConfig({
        id: 'provider-1',
        name: 'local-provider',
        model: 'local-embedding',
        apiKeyRef: 'LOCAL_EMBEDDING_KEY',
        metadata: {
          embeddingDimension: 768,
          timeoutMs: 5000,
        },
      }),
    ]);

    await expect(
      service.resolveEmbeddingProvider({
        retrievalProfile: {
          key: 'docs-qa',
          metadata: {
            embeddingProviderId: 'provider-1',
          },
        },
      }),
    ).resolves.toMatchObject({
      source: 'provider_config',
      providerConfigId: 'provider-1',
      name: 'local-provider',
      model: 'local-embedding',
      dimension: 768,
      apiKey: 'local-key',
      apiKeyRef: 'LOCAL_EMBEDDING_KEY',
      timeoutMs: 5000,
    });
  });

  it('marks reindex required when the resolved embedding provider differs from the active index', async () => {
    const { service, prisma } = createService({ LOCAL_EMBEDDING_KEY: 'local-key' });
    prisma.providerConfig.findMany.mockResolvedValue([
      providerConfig({
        model: 'new-embedding',
        apiKeyRef: 'LOCAL_EMBEDDING_KEY',
        metadata: { default: true, embeddingDimension: 1024 },
      }),
    ]);

    await expect(
      service.resolveEmbeddingProvider({
        indexVersion: {
          embeddingModel: 'old-embedding',
          embeddingDimension: 384,
        },
      }),
    ).resolves.toMatchObject({
      source: 'provider_config',
      model: 'new-embedding',
      dimension: 1024,
      reindexRequired: true,
    });
  });

  it('prefers the provider matching the active index over the workspace default index profile', async () => {
    const { service, prisma } = createService({ LOCAL_EMBEDDING_KEY: 'local-key' });
    prisma.providerConfig.findMany.mockResolvedValue([
      providerConfig({
        id: 'cpu-provider',
        name: 'cpu-provider',
        model: 'cpu-embedding',
        apiKeyRef: 'LOCAL_EMBEDDING_KEY',
        metadata: {
          default: true,
          defaultIndexProfile: 'default',
          embeddingDimension: 384,
        },
      }),
      providerConfig({
        id: 'external-provider',
        name: 'external-provider',
        model: 'external-embedding',
        apiKeyRef: 'LOCAL_EMBEDDING_KEY',
        metadata: { default: false, embeddingDimension: 1024 },
      }),
    ]);

    await expect(
      service.resolveEmbeddingProvider({
        knowledgeBase: { id: 'kb-1', defaultIndexProfile: 'default' },
        indexVersion: {
          embeddingModel: 'external-embedding',
          embeddingDimension: 1024,
        },
      }),
    ).resolves.toMatchObject({
      providerConfigId: 'external-provider',
      model: 'external-embedding',
      dimension: 1024,
    });
  });

  it('surfaces missing referenced provider secrets without falling back to raw environment defaults', async () => {
    const { service, prisma } = createService();
    prisma.providerConfig.findMany.mockResolvedValue([
      providerConfig({
        apiKeyRef: 'MISSING_EMBEDDING_KEY',
        metadata: { default: true, embeddingDimension: 384 },
      }),
    ]);

    await expect(service.resolveEmbeddingProvider()).resolves.toMatchObject({
      source: 'provider_config',
      apiKeyRef: 'MISSING_EMBEDDING_KEY',
      apiKey: undefined,
    });
  });

  it('resolves the default answer LLM ProviderConfig and its environment secret reference', async () => {
    const { service, prisma } = createService({ ANSWER_LLM_KEY: 'llm-secret' });
    prisma.providerConfig.findMany.mockResolvedValue([
      providerConfig({
        id: 'llm-1',
        type: ProviderType.llm,
        name: 'answer-llm',
        model: 'small-instruct',
        apiKeyRef: 'ANSWER_LLM_KEY',
        metadata: {
          default: true,
          timeoutMs: 15000,
          maxOutputTokens: 700,
          temperature: 0.2,
        },
      }),
    ]);

    await expect(service.resolveAnswerLlmProvider()).resolves.toMatchObject({
      source: 'provider_config',
      providerConfigId: 'llm-1',
      name: 'answer-llm',
      model: 'small-instruct',
      apiKey: 'llm-secret',
      apiKeyRef: 'ANSWER_LLM_KEY',
      timeoutMs: 15000,
      maxOutputTokens: 700,
      temperature: 0.2,
      protocol: 'openai_compatible',
    });
  });

  it('fails clearly when no answer LLM ProviderConfig exists', async () => {
    const { service, prisma } = createService();
    prisma.providerConfig.findMany.mockResolvedValue([]);

    await expect(service.resolveAnswerLlmProvider()).rejects.toMatchObject({
      code: 'llm_provider_not_configured',
      stage: 'resolve_llm_provider',
    });
  });

  it('resolves optional reranker providers from retrieval profile metadata', async () => {
    const { service, prisma } = createService();
    prisma.providerConfig.findFirst.mockResolvedValue(
      providerConfig({
        id: 'reranker-1',
        type: ProviderType.reranker,
        name: 'local-reranker',
        model: 'rerank-model',
      }),
    );

    await expect(
      service.resolveRerankerProvider({
        key: 'docs-qa',
        metadata: {
          rerankerProviderId: 'reranker-1',
          rerankerFallbackAllowed: true,
        },
      }),
    ).resolves.toEqual({
      requested: true,
      enabled: true,
      source: 'profile',
      providerConfigId: 'reranker-1',
      name: 'local-reranker',
      model: 'rerank-model',
      fallbackAllowed: true,
    });
  });

  it('does not force reranking when no reranker provider is configured', async () => {
    const { service } = createService();

    await expect(service.resolveRerankerProvider({ metadata: {} })).resolves.toEqual({
      requested: false,
      enabled: false,
      source: 'none',
      fallbackAllowed: true,
      reason: 'no_reranker_configured',
    });
  });

  it('lets request overrides disable profile reranking', async () => {
    const { service } = createService();

    await expect(
      service.resolveRerankerProvider(
        {
          metadata: {
            rerankerProviderName: 'local-reranker',
          },
        },
        { enabled: false },
      ),
    ).resolves.toEqual({
      requested: true,
      enabled: false,
      source: 'request',
      fallbackAllowed: true,
      reason: 'reranker_disabled_by_request',
    });
  });

  it('uses a configured default provider for a built-in reranker profile alias', async () => {
    const { service, prisma } = createService();
    prisma.providerConfig.findMany.mockResolvedValue([
      providerConfig({
        id: 'reranker-default',
        type: ProviderType.reranker,
        name: 'local-reranker',
        model: 'qwen-reranker',
        metadata: { default: true },
      }),
    ]);

    await expect(
      service.resolveRerankerProvider({ key: 'dense-reranker', metadata: { reranker: { enabled: true } } }),
    ).resolves.toMatchObject({
      requested: true,
      enabled: true,
      source: 'profile',
      providerConfigId: 'reranker-default',
      model: 'qwen-reranker',
    });
  });

  it('keeps nested reranker provider failure explicit and fallback-capable', async () => {
    const { service } = createService();

    await expect(
      service.resolveRerankerProvider({
        metadata: { reranker: { enabled: true, providerId: 'missing', fallbackAllowed: true } },
      }),
    ).resolves.toMatchObject({
      requested: true,
      enabled: false,
      source: 'profile',
      requestedProviderId: 'missing',
      fallbackAllowed: true,
      reason: 'reranker_provider_not_found',
    });

    await expect(
      service.rerankCandidates('query', [{ id: 'chunk-1', text: 'candidate' }], {
        requested: true,
        enabled: false,
        source: 'profile',
        fallbackAllowed: true,
        reason: 'reranker_provider_not_found',
      }),
    ).resolves.toMatchObject({
      reranked: false,
      fallbackUsed: true,
      candidateCount: 1,
      reason: 'reranker_provider_not_found',
    });

    await expect(
      service.rerankCandidates('query', [{ id: 'chunk-1', text: 'candidate' }], {
        requested: true,
        enabled: false,
        source: 'profile',
        fallbackAllowed: false,
        reason: 'reranker_provider_not_found',
      }),
    ).rejects.toMatchObject({ code: 'reranker_unavailable' });
  });

  it('honors an explicit nested profile reranker disable', async () => {
    const { service, prisma } = createService();

    await expect(
      service.resolveRerankerProvider({
        metadata: { reranker: { enabled: false, providerId: 'should-not-load' } },
      }),
    ).resolves.toMatchObject({
      requested: true,
      enabled: false,
      source: 'profile',
      reason: 'reranker_disabled_by_profile',
    });
    expect(prisma.providerConfig.findFirst).not.toHaveBeenCalled();
  });

  it('lets a selector-only request override replace a disabled profile', async () => {
    const { service, prisma } = createService();
    prisma.providerConfig.findFirst.mockResolvedValue(
      providerConfig({
        id: 'override-reranker',
        type: ProviderType.reranker,
        name: 'override-reranker',
        model: 'override-model',
      }),
    );

    await expect(
      service.resolveRerankerProvider(
        { metadata: { reranker: { enabled: false } } },
        { providerName: 'override-reranker', topN: 5 },
      ),
    ).resolves.toMatchObject({
      requested: true,
      enabled: true,
      source: 'request',
      providerConfigId: 'override-reranker',
      topN: 5,
    });
  });

  it('gives a provider-name override precedence over a disabled profile provider id', async () => {
    const { service, prisma } = createService();
    prisma.providerConfig.findFirst.mockResolvedValue(
      providerConfig({
        id: 'override-reranker',
        type: ProviderType.reranker,
        name: 'override-reranker',
        model: 'override-model',
      }),
    );

    await expect(
      service.resolveRerankerProvider(
        { metadata: { reranker: { enabled: false, providerId: 'disabled-profile-provider' } } },
        { providerName: 'override-reranker' },
      ),
    ).resolves.toMatchObject({
      requested: true,
      enabled: true,
      source: 'request',
      providerConfigId: 'override-reranker',
    });

    expect(prisma.providerConfig.findFirst).toHaveBeenCalledWith({
      where: { type: ProviderType.reranker, name: 'override-reranker' },
    });
  });

  it('lets request overrides enable the default reranker provider and topN', async () => {
    const { service, prisma } = createService();
    prisma.providerConfig.findMany.mockResolvedValue([
      providerConfig({
        id: 'reranker-default',
        type: ProviderType.reranker,
        name: 'local-cpu-reranker',
        model: 'cross-encoder/ms-marco-MiniLM-L6-v2',
        metadata: { default: true },
      }),
    ]);

    await expect(service.resolveRerankerProvider({ metadata: {} }, { enabled: true, topN: 3 })).resolves.toMatchObject({
      requested: true,
      enabled: true,
      source: 'request',
      providerConfigId: 'reranker-default',
      name: 'local-cpu-reranker',
      model: 'cross-encoder/ms-marco-MiniLM-L6-v2',
      topN: 3,
    });
  });

  it('bounds reranker candidates with request topN', async () => {
    const { service, prisma } = createService();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ scores: [0.9] }),
    } as any);
    prisma.providerConfig.findFirst.mockResolvedValue(
      providerConfig({
        id: 'reranker-1',
        type: ProviderType.reranker,
        name: 'local-reranker',
        model: 'cross-encoder/ms-marco-MiniLM-L6-v2',
        apiKeyRef: null,
      }),
    );

    await expect(
      service.rerankCandidates(
        'query',
        [
          { id: 'a', text: 'first' },
          { id: 'b', text: 'second' },
        ],
        {
          requested: true,
          enabled: true,
          source: 'request',
          providerConfigId: 'reranker-1',
          name: 'local-reranker',
          topN: 1,
          fallbackAllowed: true,
        },
      ),
    ).resolves.toMatchObject({
      reranked: true,
      candidateCount: 1,
      scores: [{ id: 'a', score: 0.9 }],
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      documents: ['first'],
    });
    fetchMock.mockRestore();
  });
});

function createService(env: Record<string, unknown> = {}) {
  const prisma = {
    providerConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      const values: Record<string, unknown> = {
        EMBEDDING_BASE_URL: 'http://env-embedding.local/v1',
        EMBEDDING_MODEL: 'env-embedding',
        EMBEDDING_DIMENSION: 384,
        EMBEDDING_API_KEY: 'env-key',
        EMBEDDING_TIMEOUT_MS: 10000,
        ...env,
      };
      return values[key] ?? fallback;
    }),
  };

  return {
    service: new ProvidersService(prisma as any, config as any),
    prisma,
  };
}

function providerConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-default',
    type: ProviderType.embedding,
    name: 'default-embedding',
    baseUrl: 'http://provider.local/v1',
    model: 'provider-embedding',
    apiKeyRef: 'EMBEDDING_API_KEY',
    metadata: {},
    createdAt: new Date('2026-05-31T00:00:00.000Z'),
    updatedAt: new Date('2026-05-31T00:00:00.000Z'),
    ...overrides,
  };
}
