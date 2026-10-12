import { HttpException, HttpStatus } from '@nestjs/common';

export type EmbeddingErrorCode =
  | 'embedding_api_key_missing'
  | 'embedding_invalid_credentials'
  | 'embedding_forbidden'
  | 'embedding_model_not_found'
  | 'embedding_provider_unreachable'
  | 'embedding_dns_failure'
  | 'embedding_connection_refused'
  | 'embedding_tls_failure'
  | 'embedding_timeout'
  | 'embedding_rate_limited'
  | 'embedding_invalid_response'
  | 'embedding_empty_response'
  | 'embedding_dimension_mismatch'
  | 'embedding_unsupported_batch_size'
  | 'embedding_provider_error';

export type EmbeddingFailureStage = 'config' | 'preflight' | 'embed';

export interface EmbeddingErrorDetails {
  baseUrl?: string;
  model?: string;
  expectedDimension?: number;
  actualDimension?: number;
  statusCode?: number;
  providerCode?: string;
  providerMessage?: string;
}

export class EmbeddingProviderException extends HttpException {
  constructor(
    readonly code: EmbeddingErrorCode,
    message: string,
    readonly stage: EmbeddingFailureStage,
    readonly retryable: boolean,
    readonly details: EmbeddingErrorDetails = {},
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        code,
        message,
        stage,
        retryable,
        details,
      },
      status,
    );
  }
}
