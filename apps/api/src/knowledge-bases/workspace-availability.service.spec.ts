import { WorkspaceAvailabilityService } from './workspace-availability.service';

describe('WorkspaceAvailabilityService', () => {
  const prisma = {
    indexVersion: {
      findMany: jest.fn(),
    },
  };
  const embeddingsService = {
    resolveProvider: jest.fn(),
    preflight: jest.fn(),
  };

  let service: WorkspaceAvailabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkspaceAvailabilityService(prisma as any, embeddingsService as any);
  });

  it('reports workspaces without an active index as unindexed without probing a provider', async () => {
    const result = await service.evaluate([{ id: 'kb-1', activeIndexVersionId: null }]);

    expect(result.get('kb-1')).toEqual({
      status: 'unindexed',
      reason: 'active_index_missing',
      retryable: false,
    });
    expect(prisma.indexVersion.findMany).not.toHaveBeenCalled();
    expect(embeddingsService.preflight).not.toHaveBeenCalled();
  });

  it('reports an indexed workspace as unavailable when its exact provider is down', async () => {
    prisma.indexVersion.findMany.mockResolvedValue([
      { id: 'idx-1', embeddingModel: 'external-model', embeddingDimension: 1024 },
    ]);
    embeddingsService.resolveProvider.mockResolvedValue({
      source: 'provider_config',
      providerConfigId: 'provider-1',
      name: 'external-provider',
      baseUrl: 'http://embedding.invalid/v1',
      model: 'external-model',
      dimension: 1024,
      apiKey: 'key',
      timeoutMs: 60_000,
      protocol: 'openai_compatible',
    });
    embeddingsService.preflight.mockResolvedValue({
      status: 'down',
      error: { code: 'embedding_connection_refused', retryable: true },
    });

    const result = await service.evaluate([
      { id: 'kb-1', defaultIndexProfile: 'default', activeIndexVersionId: 'idx-1' },
    ]);

    expect(embeddingsService.resolveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        indexVersion: { id: 'idx-1', embeddingModel: 'external-model', embeddingDimension: 1024 },
      }),
    );
    expect(embeddingsService.preflight).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 2_000 }));
    expect(result.get('kb-1')).toEqual({
      status: 'unavailable',
      reason: 'embedding_connection_refused',
      retryable: true,
      provider: {
        source: 'provider_config',
        name: 'external-provider',
        model: 'external-model',
        dimension: 1024,
      },
    });
  });

  it('deduplicates provider preflights and recovers dynamically without persisting state', async () => {
    prisma.indexVersion.findMany.mockResolvedValue([
      { id: 'idx-1', embeddingModel: 'cpu-model', embeddingDimension: 384 },
      { id: 'idx-2', embeddingModel: 'cpu-model', embeddingDimension: 384 },
    ]);
    embeddingsService.resolveProvider.mockResolvedValue({
      source: 'provider_config',
      providerConfigId: 'provider-cpu',
      name: 'cpu-provider',
      baseUrl: 'http://localhost:8080/v1',
      model: 'cpu-model',
      dimension: 384,
      apiKey: 'key',
      timeoutMs: 60_000,
      protocol: 'openai_compatible',
    });
    embeddingsService.preflight.mockResolvedValue({ status: 'up' });

    const result = await service.evaluate([
      { id: 'kb-1', activeIndexVersionId: 'idx-1' },
      { id: 'kb-2', activeIndexVersionId: 'idx-2' },
    ]);

    expect(embeddingsService.preflight).toHaveBeenCalledTimes(1);
    expect(result.get('kb-1')?.status).toBe('available');
    expect(result.get('kb-2')?.status).toBe('available');
    expect(prisma.indexVersion).not.toHaveProperty('update');
  });
});
