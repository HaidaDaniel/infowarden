import { HttpException, HttpStatus } from '@nestjs/common';

export interface AppErrorBody {
  code: string;
  message: string;
  stage?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    readonly stage: string,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
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

export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === 'string') {
    return error;
  }
  return fallback;
}

export function getErrorCode(error: unknown): string | undefined {
  const anyError = error as any;
  return anyError?.code || anyError?.response?.code || anyError?.response?.error?.code;
}

export function sanitizeErrorDetails(details: Record<string, unknown> = {}) {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (/key|token|secret|authorization|password/i.test(key)) {
      safe[key] = '[redacted]';
    } else {
      safe[key] = value;
    }
  }
  return safe;
}
