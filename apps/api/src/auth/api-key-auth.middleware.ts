import { extractApiKey } from './api-key-auth';

interface ApiKeyAuthRequest {
  headers: Record<string, unknown>;
  originalUrl?: string;
  url?: string;
}

interface ApiKeyAuthResponse {
  status(code: number): ApiKeyAuthResponse;
  json(body: unknown): void;
}

type ApiKeyAuthNext = () => void;

export function createApiKeyAuthMiddleware(options: {
  enabled: boolean;
  apiKey?: string;
}) {
  return (request: ApiKeyAuthRequest, response: ApiKeyAuthResponse, next: ApiKeyAuthNext) => {
    if (!options.enabled) {
      return next();
    }

    const provided = extractApiKey(request.headers as Record<string, unknown>);
    if (provided === options.apiKey) {
      return next();
    }

    response.status(401).json({
      error: {
        code: 'unauthorized',
        message: 'Valid API key required',
        stage: 'request',
        retryable: false,
        details: {},
      },
      path: request.originalUrl || request.url,
      timestamp: new Date().toISOString(),
    });
  };
}
