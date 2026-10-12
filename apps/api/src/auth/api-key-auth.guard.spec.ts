import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

describe('ApiKeyAuthGuard', () => {
  const handler = () => undefined;
  const controller = class TestController {};

  it('allows requests when auth is disabled', () => {
    const guard = new ApiKeyAuthGuard(
      reflector(undefined),
      config({
        API_KEY_AUTH_ENABLED: false,
      }),
    );

    expect(guard.canActivate(context({}))).toBe(true);
  });

  it('allows requests marked as public', () => {
    const guard = new ApiKeyAuthGuard(
      reflector(true),
      config({
        API_KEY_AUTH_ENABLED: true,
        ADMIN_API_KEY: 'secret',
      }),
    );

    expect(guard.canActivate(context({}))).toBe(true);
  });

  it('accepts a valid bearer token', () => {
    const guard = new ApiKeyAuthGuard(
      reflector(undefined),
      config({
        API_KEY_AUTH_ENABLED: true,
        ADMIN_API_KEY: 'secret',
      }),
    );

    expect(
      guard.canActivate(
        context({
          authorization: 'Bearer secret',
        }),
      ),
    ).toBe(true);
  });

  it('accepts a valid x-api-key header', () => {
    const guard = new ApiKeyAuthGuard(
      reflector(undefined),
      config({
        API_KEY_AUTH_ENABLED: true,
        ADMIN_API_KEY: 'secret',
      }),
    );

    expect(
      guard.canActivate(
        context({
          'x-api-key': 'secret',
        }),
      ),
    ).toBe(true);
  });

  it('rejects missing or invalid keys when auth is enabled', () => {
    const guard = new ApiKeyAuthGuard(
      reflector(undefined),
      config({
        API_KEY_AUTH_ENABLED: true,
        ADMIN_API_KEY: 'secret',
      }),
    );

    expect(() => guard.canActivate(context({}))).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(
        context({
          authorization: 'Bearer nope',
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  function context(headers: Record<string, unknown>) {
    return {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as any;
  }

  function config(values: Record<string, unknown>) {
    return {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  }

  function reflector(isPublic: boolean | undefined) {
    return {
      getAllAndOverride: jest.fn().mockReturnValue(isPublic),
    } as unknown as Reflector;
  }
});
