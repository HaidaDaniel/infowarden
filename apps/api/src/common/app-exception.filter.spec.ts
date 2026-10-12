import { BadRequestException } from '@nestjs/common';
import { AppException } from './app-error';
import { AppExceptionFilter } from './app-exception.filter';

describe('AppExceptionFilter', () => {
  it('formats known app errors with a stable shape', () => {
    const response = runFilter(
      new AppException('queue_unavailable', 'Queue is unavailable', 'enqueue', true, {
        apiKey: 'secret',
        queue: 'indexing',
      }),
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'queue_unavailable',
          message: 'Queue is unavailable',
          stage: 'enqueue',
          retryable: true,
          details: {
            apiKey: '[redacted]',
            queue: 'indexing',
          },
        },
        path: '/jobs/indexing',
        timestamp: expect.any(String),
      }),
    );
  });

  it('formats validation errors', () => {
    const response = runFilter(new BadRequestException(['name must be a string']));

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'validation_failed',
          stage: 'request',
        }),
      }),
    );
  });

  it('sanitizes unknown server errors', () => {
    const response = runFilter(new Error('database password leaked here'));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'internal_error',
          message: 'Internal server error',
          stage: 'runtime',
          retryable: false,
          details: {},
        },
      }),
    );
  });
});

function runFilter(exception: unknown) {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/jobs/indexing' }),
    }),
  };
  new AppExceptionFilter().catch(exception, host as any);
  return response;
}
