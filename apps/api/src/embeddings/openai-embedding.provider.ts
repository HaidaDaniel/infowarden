import { HttpStatus, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EmbeddingProvider } from './embedding-provider.interface';
import {
  EmbeddingErrorDetails,
  EmbeddingFailureStage,
  EmbeddingProviderException,
} from './embedding-provider.error';
import { RuntimeEmbeddingProviderConfig } from '../providers/providers.service';

export interface EmbeddingPreflightResult {
  status: 'up' | 'down' | 'not_configured';
  model: string;
  dimension: number;
  baseUrl: string;
  error?: {
    code: string;
    message: string;
    stage: EmbeddingFailureStage;
    retryable: boolean;
    details?: EmbeddingErrorDetails;
  };
}

type EmbeddingResponseItem = {
  index: number;
  embedding: number[];
};

@Injectable()
export class OpenAICompatibleProvider implements EmbeddingProvider {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  getType(): string {
    return 'openai_compatible';
  }

  getModel(runtimeConfig?: RuntimeEmbeddingProviderConfig): string {
    return runtimeConfig?.model || this.configService.get('EMBEDDING_MODEL', 'text-embedding-3-small');
  }

  getDimension(runtimeConfig?: RuntimeEmbeddingProviderConfig): number {
    return runtimeConfig?.dimension || this.configService.get('EMBEDDING_DIMENSION', 1536);
  }

  getBaseUrl(runtimeConfig?: RuntimeEmbeddingProviderConfig): string {
    return runtimeConfig?.baseUrl || this.configService.get('EMBEDDING_BASE_URL', 'https://api.openai.com/v1');
  }

  async preflight(runtimeConfig?: RuntimeEmbeddingProviderConfig): Promise<EmbeddingPreflightResult> {
    try {
      await this.requestEmbeddings(['contextforge embedding preflight'], 'preflight', runtimeConfig);
      return {
        status: 'up',
        model: this.getModel(runtimeConfig),
        dimension: this.getDimension(runtimeConfig),
        baseUrl: this.getBaseUrl(runtimeConfig),
      };
    } catch (error) {
      const normalized = this.normalizeError(error, 'preflight', runtimeConfig);
      return {
        status: normalized.code === 'embedding_api_key_missing' ? 'not_configured' : 'down',
        model: this.getModel(runtimeConfig),
        dimension: this.getDimension(runtimeConfig),
        baseUrl: this.getBaseUrl(runtimeConfig),
        error: {
          code: normalized.code,
          message: (normalized.getResponse() as any).message,
          stage: normalized.stage,
          retryable: normalized.retryable,
          details: normalized.details,
        },
      };
    }
  }

  async assertReady(runtimeConfig?: RuntimeEmbeddingProviderConfig): Promise<void> {
    const result = await this.preflight(runtimeConfig);
    if (result.status !== 'up') {
      const error = result.error;
      throw new EmbeddingProviderException(
        (error?.code as any) || 'embedding_provider_error',
        error?.message || 'Embedding provider is not ready',
        (error?.stage as EmbeddingFailureStage) || 'preflight',
        Boolean(error?.retryable),
        (error?.details as any) || this.baseDetails(runtimeConfig),
        result.status === 'not_configured'
          ? HttpStatus.BAD_REQUEST
          : HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async embedTexts(
    texts: string[],
    runtimeConfig?: RuntimeEmbeddingProviderConfig,
  ): Promise<number[][]> {
    return this.requestEmbeddings(texts, 'embed', runtimeConfig);
  }

  private async requestEmbeddings(
    texts: string[],
    stage: EmbeddingFailureStage,
    runtimeConfig?: RuntimeEmbeddingProviderConfig,
  ): Promise<number[][]> {
    const apiKey = runtimeConfig?.apiKey ?? this.configService.get('EMBEDDING_API_KEY');
    const apiKeyRef = runtimeConfig?.apiKeyRef || 'EMBEDDING_API_KEY';
    const baseUrl = this.getBaseUrl(runtimeConfig);

    if (!apiKey) {
      throw new EmbeddingProviderException(
        'embedding_api_key_missing',
        `${apiKeyRef} is not configured`,
        'config',
        false,
        this.baseDetails(runtimeConfig),
      );
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${baseUrl.replace(/\/$/, '')}/embeddings`,
          {
            model: this.getModel(runtimeConfig),
            input: texts,
          },
          {
            timeout: runtimeConfig?.timeoutMs || this.configService.get('EMBEDDING_TIMEOUT_MS', 30000),
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const data = response.data;

      if (!data.data || !Array.isArray(data.data)) {
        throw new EmbeddingProviderException(
          'embedding_invalid_response',
          'Embedding provider returned an invalid response shape',
          stage,
          false,
          this.baseDetails(runtimeConfig),
          HttpStatus.BAD_GATEWAY,
        );
      }

      if (data.data.length === 0) {
        throw new EmbeddingProviderException(
          'embedding_empty_response',
          'Embedding provider returned no embeddings',
          stage,
          true,
          this.baseDetails(runtimeConfig),
          HttpStatus.BAD_GATEWAY,
        );
      }

      const embeddingItems = data.data as EmbeddingResponseItem[];
      const embeddings = embeddingItems
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);

      const expectedDimension = this.getDimension(runtimeConfig);
      for (const embedding of embeddings) {
        if (!Array.isArray(embedding)) {
          throw new EmbeddingProviderException(
            'embedding_invalid_response',
            'Embedding provider returned an invalid embedding item',
            stage,
            false,
            this.baseDetails(runtimeConfig),
            HttpStatus.BAD_GATEWAY,
          );
        }
        if (embedding.length !== expectedDimension) {
          throw new EmbeddingProviderException(
            'embedding_dimension_mismatch',
            `Embedding dimension mismatch: expected ${expectedDimension}, got ${embedding.length}`,
            stage,
            false,
            {
              ...this.baseDetails(runtimeConfig),
              expectedDimension,
              actualDimension: embedding.length,
            },
          );
        }
      }

      return embeddings;
    } catch (error) {
      throw this.normalizeError(error, stage, runtimeConfig);
    }
  }

  private normalizeError(
    error: unknown,
    stage: EmbeddingFailureStage,
    runtimeConfig?: RuntimeEmbeddingProviderConfig,
  ): EmbeddingProviderException {
    if (error instanceof EmbeddingProviderException) {
      return error;
    }

    const anyError = error as any;
    const statusCode = anyError?.response?.status;
    const providerMessage = this.extractProviderMessage(anyError);
    const providerCode = anyError?.response?.data?.error?.code || anyError?.code;
    const details = {
      ...this.baseDetails(runtimeConfig),
      statusCode,
      providerCode,
      providerMessage,
    };

    if (statusCode === 401) {
      return new EmbeddingProviderException(
        'embedding_invalid_credentials',
        'Embedding provider rejected the configured credentials',
        stage,
        false,
        details,
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (statusCode === 403) {
      return new EmbeddingProviderException(
        'embedding_forbidden',
        'Embedding provider credentials do not have access to this model or endpoint',
        stage,
        false,
        details,
        HttpStatus.FORBIDDEN,
      );
    }
    if (statusCode === 404 || /model.*not.*found|not.*found.*model/i.test(providerMessage)) {
      return new EmbeddingProviderException(
        'embedding_model_not_found',
        'Embedding model was not found at the configured provider',
        stage,
        false,
        details,
      );
    }
    if (statusCode === 429) {
      return new EmbeddingProviderException(
        'embedding_rate_limited',
        'Embedding provider rate limit was reached',
        stage,
        true,
        details,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (
      statusCode === 413 ||
      /batch|too many|maximum context|max input/i.test(providerMessage)
    ) {
      return new EmbeddingProviderException(
        'embedding_unsupported_batch_size',
        'Embedding provider rejected the request size or batch size',
        stage,
        false,
        details,
      );
    }

    const code = anyError?.code;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return new EmbeddingProviderException(
        'embedding_timeout',
        'Embedding provider request timed out',
        stage,
        true,
        details,
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return new EmbeddingProviderException(
        'embedding_dns_failure',
        'Embedding provider host could not be resolved',
        stage,
        true,
        details,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (code === 'ECONNREFUSED') {
      return new EmbeddingProviderException(
        'embedding_connection_refused',
        'Embedding provider refused the connection',
        stage,
        true,
        details,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (/CERT|TLS|SSL/i.test(code || providerMessage)) {
      return new EmbeddingProviderException(
        'embedding_tls_failure',
        'Embedding provider TLS handshake failed',
        stage,
        false,
        details,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
      return new EmbeddingProviderException(
        'embedding_provider_unreachable',
        'Embedding provider is unreachable from this server',
        stage,
        true,
        details,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return new EmbeddingProviderException(
      'embedding_provider_error',
      providerMessage || 'Embedding provider request failed',
      stage,
      Boolean(statusCode && statusCode >= 500),
      details,
      statusCode && statusCode >= 500 ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST,
    );
  }

  private baseDetails(runtimeConfig?: RuntimeEmbeddingProviderConfig) {
    return {
      baseUrl: this.getBaseUrl(runtimeConfig),
      model: this.getModel(runtimeConfig),
      expectedDimension: this.getDimension(runtimeConfig),
      providerConfigId: runtimeConfig?.providerConfigId,
      providerSource: runtimeConfig?.source,
      apiKeyRef: runtimeConfig?.apiKeyRef,
    };
  }

  private extractProviderMessage(error: any): string {
    return (
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      ''
    );
  }
}
