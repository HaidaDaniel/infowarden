import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderConfig, ProviderType } from '@prisma/client';
import { AppException, getErrorMessage } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';

export type RuntimeEmbeddingProviderConfig = {
  source: 'provider_config' | 'environment';
  providerConfigId?: string;
  name: string;
  baseUrl: string;
  model: string;
  dimension: number;
  apiKey?: string;
  apiKeyRef?: string;
  timeoutMs: number;
  protocol: 'openai_compatible';
  reindexRequired?: boolean;
  reindexReason?: string;
};

export type RuntimeLlmProviderConfig = {
  source: 'provider_config';
  providerConfigId: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  apiKeyRef?: string;
  timeoutMs: number;
  maxOutputTokens: number;
  temperature: number;
  protocol: 'openai_compatible';
};

export type LlmProviderOverride = {
  providerId?: string;
  providerName?: string;
  maxOutputTokens?: number;
  temperature?: number;
};

export type ProviderResolutionContext = {
  knowledgeBase?: {
    id: string;
    defaultIndexProfile?: string | null;
  };
  retrievalProfile?: {
    key?: string;
    metadata?: unknown;
  };
  indexVersion?: {
    embeddingModel?: string;
    embeddingDimension?: number;
  };
  purpose?: 'indexing' | 'retrieval' | 'health';
};

export type RerankerResolution = {
  requested: boolean;
  enabled: boolean;
  source: 'profile' | 'request' | 'none';
  providerConfigId?: string;
  requestedProviderId?: string;
  name?: string;
  requestedProviderName?: string;
  model?: string;
  topN?: number;
  fallbackAllowed: boolean;
  reason?: string;
};

export type RerankOverride = {
  enabled?: boolean;
  providerId?: string;
  providerName?: string;
  topN?: number;
  fallbackAllowed?: boolean;
};

export type RerankCandidateInput = {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
};

export type RerankScore = {
  id: string;
  score: number;
};

export type RerankRunResult = {
  reranked: boolean;
  fallbackUsed: boolean;
  reason?: string;
  candidateCount: number;
  scores: RerankScore[];
};

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async resolveEmbeddingProvider(context: ProviderResolutionContext = {}): Promise<RuntimeEmbeddingProviderConfig> {
    const metadata = this.normalizeMetadata(context.retrievalProfile?.metadata);
    const providers = await this.prisma.providerConfig.findMany({
      where: { type: ProviderType.embedding },
      orderBy: { createdAt: 'asc' },
    });

    const explicit = this.findExplicitProvider(providers, metadata, 'embedding');
    const byIndexVersion = this.findByIndexVersion(providers, context.indexVersion);
    const byIndexProfile = this.findByIndexProfile(providers, context.knowledgeBase?.defaultIndexProfile);
    const defaultProvider = providers.find((provider) => this.normalizeMetadata(provider.metadata).default === true);
    const selected = explicit || byIndexVersion || byIndexProfile || defaultProvider;

    if (!selected) {
      return this.environmentEmbeddingProvider(context.indexVersion);
    }

    return this.toRuntimeEmbeddingProvider(selected, context.indexVersion);
  }

  async resolveAnswerLlmProvider(override: LlmProviderOverride = {}): Promise<RuntimeLlmProviderConfig> {
    const providerId = this.stringValue(override.providerId);
    const providerName = this.stringValue(override.providerName);
    let selected: ProviderConfig | undefined;

    if (providerId || providerName) {
      selected =
        (await this.prisma.providerConfig.findFirst({
          where: {
            type: ProviderType.llm,
            ...(providerId ? { id: providerId } : { name: providerName as string }),
          },
        })) || undefined;

      if (!selected) {
        throw new AppException(
          'llm_provider_not_found',
          'Requested answer LLM provider was not found',
          'resolve_llm_provider',
          false,
          { providerId, providerName },
          HttpStatus.NOT_FOUND,
        );
      }
    } else {
      const providers = await this.prisma.providerConfig.findMany({
        where: { type: ProviderType.llm },
        orderBy: { createdAt: 'asc' },
      });
      selected =
        providers.find((provider) => this.normalizeMetadata(provider.metadata).default === true) || providers[0];
    }

    if (!selected) {
      throw new AppException(
        'llm_provider_not_configured',
        'No answer LLM ProviderConfig is configured',
        'resolve_llm_provider',
        false,
        {},
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const metadata = this.normalizeMetadata(selected.metadata);
    const protocol = this.stringValue(metadata.protocol) || 'openai_compatible';
    if (protocol !== 'openai_compatible') {
      throw new AppException(
        'llm_protocol_unsupported',
        `Answer LLM provider ${selected.name} uses unsupported protocol ${protocol}`,
        'resolve_llm_provider',
        false,
        { providerConfigId: selected.id, protocol },
      );
    }

    const apiKeyRef = selected.apiKeyRef || this.stringValue(metadata.apiKeyRef);
    const apiKey = apiKeyRef ? this.configService.get<string>(apiKeyRef) : undefined;
    if (apiKeyRef && !apiKey) {
      throw new AppException(
        'llm_api_key_missing',
        `Answer LLM secret reference ${apiKeyRef} is not configured`,
        'resolve_llm_provider',
        false,
        { providerConfigId: selected.id, apiKeyRef },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      source: 'provider_config',
      providerConfigId: selected.id,
      name: selected.name,
      baseUrl: selected.baseUrl,
      model: selected.model,
      apiKey,
      apiKeyRef,
      timeoutMs: this.clampNumber(metadata.timeoutMs, 60000, 1000, 120000),
      maxOutputTokens: this.clampNumber(override.maxOutputTokens ?? metadata.maxOutputTokens, 1024, 1, 8192),
      temperature: this.clampNumber(override.temperature ?? metadata.temperature, 0, 0, 2),
      protocol: 'openai_compatible',
    };
  }

  async resolveRerankerProvider(
    retrievalProfile?: { key?: string; metadata?: unknown },
    override?: RerankOverride,
  ): Promise<RerankerResolution> {
    const metadata = this.normalizeMetadata(retrievalProfile?.metadata);
    const profileReranker = this.normalizeMetadata(metadata.reranker);
    const overrideSource = override && Object.keys(override).length > 0;
    const fallbackAllowed =
      typeof override?.fallbackAllowed === 'boolean'
        ? override.fallbackAllowed
        : (profileReranker.fallbackAllowed ?? metadata.rerankerFallbackAllowed) !== false;

    if (override?.enabled === false) {
      return {
        requested: true,
        enabled: false,
        source: 'request',
        fallbackAllowed,
        reason: 'reranker_disabled_by_request',
      };
    }

    if (profileReranker.enabled === false && !overrideSource) {
      return {
        requested: true,
        enabled: false,
        source: 'profile',
        fallbackAllowed,
        reason: 'reranker_disabled_by_profile',
      };
    }

    const overrideId = this.stringValue(override?.providerId);
    const overrideName = this.stringValue(override?.providerName);
    const id =
      overrideId ||
      (overrideName
        ? undefined
        : this.stringValue(metadata.rerankerProviderId) ||
          this.stringValue(metadata.rerankerId) ||
          this.stringValue(profileReranker.providerId) ||
          this.stringValue(profileReranker.id));
    const name =
      overrideName ||
      (overrideId
        ? undefined
        : this.stringValue(metadata.rerankerProviderName) ||
          this.stringValue(profileReranker.providerName) ||
          this.stringValue(profileReranker.name));
    const topN =
      this.numberValue(override?.topN) ||
      this.numberValue(metadata.rerankerTopN) ||
      this.numberValue(metadata.rerankTopN) ||
      this.numberValue(profileReranker.topN);

    if (!id && !name && override?.enabled !== true && profileReranker.enabled !== true) {
      return {
        requested: false,
        enabled: false,
        source: 'none',
        fallbackAllowed,
        reason: 'no_reranker_configured',
      };
    }

    const provider =
      id || name
        ? await this.prisma.providerConfig.findFirst({
            where: {
              type: ProviderType.reranker,
              ...(id ? { id } : { name: name as string }),
            },
          })
        : await this.findDefaultRerankerProvider();

    if (!provider) {
      return {
        requested: true,
        enabled: false,
        source: overrideSource ? 'request' : 'profile',
        requestedProviderId: id,
        requestedProviderName: name,
        fallbackAllowed,
        reason: 'reranker_provider_not_found',
        topN,
      };
    }

    return {
      requested: true,
      enabled: true,
      source: overrideSource ? 'request' : 'profile',
      providerConfigId: provider.id,
      name: provider.name,
      model: provider.model,
      topN,
      fallbackAllowed,
    };
  }

  async rerankCandidates(
    query: string,
    candidates: RerankCandidateInput[],
    resolution: RerankerResolution,
  ): Promise<RerankRunResult> {
    if (candidates.length === 0) {
      return {
        reranked: false,
        fallbackUsed: false,
        reason: resolution.reason || 'reranker_not_enabled',
        candidateCount: 0,
        scores: [],
      };
    }

    if (!resolution.enabled || !resolution.providerConfigId) {
      if (
        resolution.requested &&
        resolution.reason &&
        resolution.reason !== 'reranker_disabled_by_profile' &&
        resolution.reason !== 'reranker_disabled_by_request'
      ) {
        return this.rerankerFailure(resolution, resolution.reason, candidates.length);
      }
      return {
        reranked: false,
        fallbackUsed: false,
        reason: resolution.reason || 'reranker_not_enabled',
        candidateCount: 0,
        scores: [],
      };
    }

    let attemptedCandidateCount = candidates.length;
    try {
      const provider = await this.prisma.providerConfig.findFirst({
        where: {
          id: resolution.providerConfigId,
          type: ProviderType.reranker,
        },
      });

      if (!provider) {
        return this.rerankerFailure(resolution, 'reranker_provider_not_found', candidates.length);
      }

      const metadata = this.normalizeMetadata(provider.metadata);
      const maxCandidates = Math.min(
        Math.max(
          this.numberValue(resolution.topN) ||
            this.numberValue(metadata.maxCandidates) ||
            this.numberValue(metadata.maxRerankCandidates) ||
            20,
          1,
        ),
        100,
      );
      const timeoutMs = Math.min(
        Math.max(
          this.numberValue(metadata.timeoutMs) || this.configService.get<number>('RERANKER_TIMEOUT_MS', 30000),
          1000,
        ),
        120000,
      );
      const apiKeyRef = provider.apiKeyRef || this.stringValue(metadata.apiKeyRef);
      const apiKey = apiKeyRef ? this.configService.get<string>(apiKeyRef) : undefined;
      const limitedCandidates = candidates.slice(0, maxCandidates);
      attemptedCandidateCount = limitedCandidates.length;

      if (apiKeyRef && !apiKey) {
        return this.rerankerFailure(resolution, 'reranker_api_key_missing', limitedCandidates.length);
      }

      const endpoint = this.rerankerEndpoint(provider.baseUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: provider.model,
            query,
            documents: limitedCandidates.map((candidate) => candidate.text),
            texts: limitedCandidates.map((candidate) => candidate.text),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          return this.rerankerFailure(resolution, `reranker_http_${response.status}`, limitedCandidates.length);
        }

        const payload = await response.json();
        const scores = this.parseRerankerScores(payload, limitedCandidates);
        if (scores.length === 0) {
          return this.rerankerFailure(resolution, 'reranker_invalid_response', limitedCandidates.length);
        }

        return {
          reranked: true,
          fallbackUsed: false,
          candidateCount: limitedCandidates.length,
          scores,
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return this.rerankerFailure(resolution, getErrorMessage(error, 'reranker_unavailable'), attemptedCandidateCount);
    }
  }

  private toRuntimeEmbeddingProvider(
    provider: ProviderConfig,
    indexVersion?: ProviderResolutionContext['indexVersion'],
  ): RuntimeEmbeddingProviderConfig {
    const metadata = this.normalizeMetadata(provider.metadata);
    const dimension = this.numberValue(metadata.embeddingDimension) || this.numberValue(metadata.dimension);
    const protocol = this.stringValue(metadata.protocol) || 'openai_compatible';

    if (protocol !== 'openai_compatible') {
      return this.environmentEmbeddingProvider(indexVersion, {
        reindexRequired: true,
        reindexReason: `Provider config ${provider.name} uses unsupported protocol ${protocol}`,
      });
    }

    const apiKeyRef = provider.apiKeyRef || this.stringValue(metadata.apiKeyRef);
    const apiKey = apiKeyRef ? this.configService.get<string>(apiKeyRef) : undefined;
    const resolved: RuntimeEmbeddingProviderConfig = {
      source: 'provider_config',
      providerConfigId: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      dimension: dimension || this.configService.get<number>('EMBEDDING_DIMENSION', 1536),
      apiKey,
      apiKeyRef,
      timeoutMs: this.numberValue(metadata.timeoutMs) || this.configService.get<number>('EMBEDDING_TIMEOUT_MS', 30000),
      protocol: 'openai_compatible',
    };

    if (
      indexVersion?.embeddingModel &&
      (indexVersion.embeddingModel !== resolved.model || indexVersion.embeddingDimension !== resolved.dimension)
    ) {
      resolved.reindexRequired = true;
      resolved.reindexReason =
        'Resolved embedding provider differs from the active index version; run force_reembed or rebuild_collection before serving mixed vectors.';
    }

    return resolved;
  }

  private environmentEmbeddingProvider(
    indexVersion?: ProviderResolutionContext['indexVersion'],
    overrides: Partial<RuntimeEmbeddingProviderConfig> = {},
  ): RuntimeEmbeddingProviderConfig {
    const resolved: RuntimeEmbeddingProviderConfig = {
      source: 'environment',
      name: 'environment',
      baseUrl: this.configService.get<string>('EMBEDDING_BASE_URL', 'https://api.openai.com/v1'),
      model: this.configService.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small'),
      dimension: this.configService.get<number>('EMBEDDING_DIMENSION', 1536),
      apiKey: this.configService.get<string>('EMBEDDING_API_KEY'),
      apiKeyRef: 'EMBEDDING_API_KEY',
      timeoutMs: this.configService.get<number>('EMBEDDING_TIMEOUT_MS', 30000),
      protocol: 'openai_compatible',
      ...overrides,
    };

    if (
      indexVersion?.embeddingModel &&
      (indexVersion.embeddingModel !== resolved.model || indexVersion.embeddingDimension !== resolved.dimension)
    ) {
      resolved.reindexRequired = true;
      resolved.reindexReason =
        resolved.reindexReason ||
        'Environment embedding provider differs from the active index version; run force_reembed or rebuild_collection before serving mixed vectors.';
    }

    return resolved;
  }

  private findExplicitProvider(
    providers: ProviderConfig[],
    metadata: Record<string, unknown>,
    prefix: 'embedding',
  ): ProviderConfig | undefined {
    const id = this.stringValue(metadata[`${prefix}ProviderId`]) || this.stringValue(metadata[`${prefix}Id`]);
    const name = this.stringValue(metadata[`${prefix}ProviderName`]);

    if (id) {
      return providers.find((provider) => provider.id === id);
    }

    if (name) {
      return providers.find((provider) => provider.name === name);
    }

    return undefined;
  }

  private rerankerEndpoint(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    return trimmed.endsWith('/rerank') ? trimmed : `${trimmed}/rerank`;
  }

  private parseRerankerScores(payload: unknown, candidates: RerankCandidateInput[]): RerankScore[] {
    const data = payload as any;

    if (Array.isArray(data?.scores)) {
      return data.scores
        .map((score: unknown, index: number) => ({
          id: candidates[index]?.id,
          score: Number(score),
        }))
        .filter((score: RerankScore) => score.id && Number.isFinite(score.score));
    }

    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.data)
          ? data.data
          : [];

    return rows
      .map((row: any) => {
        const index = Number(row.index);
        const score = Number(row.relevance_score ?? row.score);
        return {
          id: candidates[index]?.id,
          score,
        };
      })
      .filter((score: RerankScore) => score.id && Number.isFinite(score.score));
  }

  private rerankerFailure(resolution: RerankerResolution, reason: string, candidateCount: number): RerankRunResult {
    if (resolution.fallbackAllowed) {
      return {
        reranked: false,
        fallbackUsed: true,
        reason,
        candidateCount,
        scores: [],
      };
    }

    throw new AppException(
      'reranker_unavailable',
      'Configured reranker is unavailable and fallback is disabled',
      'rerank_candidates',
      true,
      {
        providerConfigId: resolution.providerConfigId,
        requestedProviderId: resolution.requestedProviderId,
        name: resolution.name,
        requestedProviderName: resolution.requestedProviderName,
        reason,
      },
    );
  }

  private findByIndexProfile(
    providers: ProviderConfig[],
    defaultIndexProfile?: string | null,
  ): ProviderConfig | undefined {
    if (!defaultIndexProfile) {
      return undefined;
    }

    return providers.find((provider) => {
      const metadata = this.normalizeMetadata(provider.metadata);
      return (
        provider.name === defaultIndexProfile ||
        this.stringValue(metadata.indexProfile) === defaultIndexProfile ||
        this.stringValue(metadata.defaultIndexProfile) === defaultIndexProfile ||
        this.stringValue(metadata.profileKey) === defaultIndexProfile
      );
    });
  }

  private findByIndexVersion(
    providers: ProviderConfig[],
    indexVersion?: ProviderResolutionContext['indexVersion'],
  ): ProviderConfig | undefined {
    if (!indexVersion?.embeddingModel) {
      return undefined;
    }

    return providers.find((provider) => {
      const metadata = this.normalizeMetadata(provider.metadata);
      const dimension = this.numberValue(metadata.embeddingDimension) || this.numberValue(metadata.dimension);
      return (
        provider.model === indexVersion.embeddingModel && (!dimension || dimension === indexVersion.embeddingDimension)
      );
    });
  }

  private async findDefaultRerankerProvider(): Promise<ProviderConfig | null> {
    const providers = await this.prisma.providerConfig.findMany({
      where: { type: ProviderType.reranker },
      orderBy: { createdAt: 'asc' },
    });

    return (
      providers.find((provider) => this.normalizeMetadata(provider.metadata).default === true) || providers[0] || null
    );
  }

  private normalizeMetadata(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private numberValue(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    const resolved = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(Math.max(resolved, minimum), maximum);
  }
}
