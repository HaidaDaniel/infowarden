import { createApiKeyAuthMiddleware } from './api-key-auth.middleware';

describe('createApiKeyAuthMiddleware', () => {
  it('passes through when disabled', () => {
    const middleware = createApiKeyAuthMiddleware({ enabled: false });
    const next = jest.fn();

    middleware(request({}), response(), next);

    expect(next).toHaveBeenCalled();
  });

  it('accepts a matching x-api-key header', () => {
    const middleware = createApiKeyAuthMiddleware({ enabled: true, apiKey: 'secret' });
    const next = jest.fn();

    middleware(request({ 'x-api-key': 'secret' }), response(), next);

    expect(next).toHaveBeenCalled();
  });

  it('rejects invalid credentials with a structured 401 response', () => {
    const middleware = createApiKeyAuthMiddleware({ enabled: true, apiKey: 'secret' });
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();

    middleware(
      request({ authorization: 'Bearer wrong' }),
      { status, json } as any,
      jest.fn(),
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'unauthorized',
          message: 'Valid API key required',
        }),
      }),
    );
  });

  function request(headers: Record<string, unknown>) {
    return {
      headers,
      originalUrl: '/api/docs',
      url: '/api/docs',
    } as any;
  }

  function response() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
  }
});
