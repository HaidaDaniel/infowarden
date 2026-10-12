import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { extractApiKey } from './api-key-auth';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    if (!this.isAuthEnabled()) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const provided = extractApiKey(request.headers || {});

    if (provided !== this.configService.get<string>('ADMIN_API_KEY')) {
      throw new UnauthorizedException('Valid API key required');
    }

    return true;
  }

  private isAuthEnabled(): boolean {
    return this.configService.get<boolean>('API_KEY_AUTH_ENABLED') === true;
  }
}
