import { Inject, Injectable, Optional } from '@nestjs/common';
import { OpenAICompatibleProvider } from './openai-embedding.provider';
import {
  ProviderResolutionContext,
  ProvidersService,
  RuntimeEmbeddingProviderConfig,
} from '../providers/providers.service';
import { TelemetryService } from '../telemetry/telemetry.service';

@Injectable()
export class EmbeddingsService {
  constructor(
    private readonly provider: OpenAICompatibleProvider,
    private readonly providersService: ProvidersService,
    @Optional()
    @Inject(TelemetryService)
    private readonly telemetry?: Pick<TelemetryService, 'span'>,
  ) {}

  async embedTexts(
    texts: string[],
    contextOrConfig?: ProviderResolutionContext | RuntimeEmbeddingProviderConfig,
  ): Promise<number[][]> {
    const runtimeConfig = await this.resolveRuntimeConfig(contextOrConfig);
    const run = () => this.provider.embedTexts(texts, runtimeConfig);
    return this.telemetry
      ? this.telemetry.span(
          'embedding.request',
          {
            providerSource: runtimeConfig.source,
            providerConfigId: runtimeConfig.providerConfigId,
            model: runtimeConfig.model,
            dimension: runtimeConfig.dimension,
            batchSize: texts.length,
          },
          run,
        )
      : run();
  }

  async preflight(contextOrConfig?: ProviderResolutionContext | RuntimeEmbeddingProviderConfig) {
    const runtimeConfig = await this.resolveRuntimeConfig(contextOrConfig);
    return this.provider.preflight(runtimeConfig);
  }

  async assertReady(contextOrConfig?: ProviderResolutionContext | RuntimeEmbeddingProviderConfig) {
    const runtimeConfig = await this.resolveRuntimeConfig(contextOrConfig);
    return this.provider.assertReady(runtimeConfig);
  }

  async resolveProvider(
    context: ProviderResolutionContext = {},
  ): Promise<RuntimeEmbeddingProviderConfig> {
    return this.providersService.resolveEmbeddingProvider(context);
  }

  private async resolveRuntimeConfig(
    contextOrConfig?: ProviderResolutionContext | RuntimeEmbeddingProviderConfig,
  ): Promise<RuntimeEmbeddingProviderConfig> {
    if (contextOrConfig && 'source' in contextOrConfig) {
      return contextOrConfig;
    }

    return this.resolveProvider((contextOrConfig || {}) as ProviderResolutionContext);
  }
}
