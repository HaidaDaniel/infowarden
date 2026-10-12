import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AppErrorBody, sanitizeErrorDetails } from './app-error';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse();
    const request = context.getRequest();
    const status = this.getStatus(exception);
    const error = this.toErrorBody(exception, status);

    response.status(status).json({
      error,
      path: request?.url,
      timestamp: new Date().toISOString(),
    });
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private toErrorBody(exception: unknown, status: number): AppErrorBody {
    if (exception instanceof HttpException) {
      const raw = exception.getResponse();
      if (typeof raw === 'object' && raw !== null) {
        const body = raw as any;
        if (body.code) {
          return {
            code: body.code,
            message: body.message || exception.message,
            stage: body.stage,
            retryable: Boolean(body.retryable),
            details: sanitizeErrorDetails(body.details || {}),
          };
        }

        return {
          code: this.defaultCodeForStatus(status),
          message: Array.isArray(body.message) ? body.message.join('; ') : body.message || exception.message,
          stage: 'request',
          retryable: false,
          details: {},
        };
      }

      return {
        code: this.defaultCodeForStatus(status),
        message: String(raw || exception.message),
        stage: 'request',
        retryable: false,
        details: {},
      };
    }

    return {
      code: 'internal_error',
      message: 'Internal server error',
      stage: 'runtime',
      retryable: false,
      details: {},
    };
  }

  private defaultCodeForStatus(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) {
      return 'validation_failed';
    }
    if (status === HttpStatus.NOT_FOUND) {
      return 'not_found';
    }
    if (status === HttpStatus.UNAUTHORIZED) {
      return 'unauthorized';
    }
    if (status === HttpStatus.FORBIDDEN) {
      return 'forbidden';
    }
    return status >= 500 ? 'server_error' : 'request_failed';
  }
}
