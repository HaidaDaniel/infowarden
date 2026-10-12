import { Body, Controller, Headers, HttpStatus, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/public.decorator';
import { AppException } from '../common/app-error';
import { SourceTriggerService } from './source-trigger.service';

const WEBHOOK_SECRET_HEADER = 'x-contextforge-webhook-secret';

@ApiTags('source-triggers')
@Controller()
export class SourceTriggerController {
  constructor(
    private readonly configService: ConfigService,
    private readonly sourceTriggerService: SourceTriggerService,
  ) {}

  @Post('workspaces/:identifier/sources/:sourceId/webhook')
  @Public()
  @ApiOperation({ summary: 'Trigger a workspace source refresh from an authenticated webhook' })
  @ApiResponse({ status: 201, description: 'Webhook refresh job enqueued' })
  async triggerWorkspaceSourceWebhook(
    @Param('identifier') identifier: string,
    @Param('sourceId') sourceId: string,
    @Headers(WEBHOOK_SECRET_HEADER) secret: string | string[] | undefined,
    @Body() body: Record<string, unknown> = {},
  ) {
    this.assertWebhookSecret(secret);
    return this.sourceTriggerService.enqueueTriggeredRefresh(identifier, sourceId, 'webhook', {
      webhookEvent: this.summarizeWebhookBody(body),
    });
  }

  @Post('knowledge-bases/:identifier/sources/:sourceId/webhook')
  @Public()
  @ApiOperation({ summary: 'Trigger a knowledge-base source refresh from an authenticated webhook' })
  @ApiResponse({ status: 201, description: 'Webhook refresh job enqueued' })
  async triggerKnowledgeBaseSourceWebhook(
    @Param('identifier') identifier: string,
    @Param('sourceId') sourceId: string,
    @Headers(WEBHOOK_SECRET_HEADER) secret: string | string[] | undefined,
    @Body() body: Record<string, unknown> = {},
  ) {
    this.assertWebhookSecret(secret);
    return this.sourceTriggerService.enqueueTriggeredRefresh(identifier, sourceId, 'webhook', {
      webhookEvent: this.summarizeWebhookBody(body),
    });
  }

  private assertWebhookSecret(secret: string | string[] | undefined): void {
    const expected = this.configService.get<string>('SOURCE_TRIGGER_WEBHOOK_SECRET')?.trim();
    if (!expected) {
      throw new AppException(
        'source_webhook_secret_not_configured',
        'SOURCE_TRIGGER_WEBHOOK_SECRET is required before webhook triggers can be used',
        'source_webhook',
        false,
        {},
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const provided = Array.isArray(secret) ? secret[0] : secret;
    if (!provided || !this.secretsMatch(provided, expected)) {
      throw new AppException(
        'source_webhook_unauthorized',
        'Webhook secret is missing or invalid',
        'source_webhook',
        false,
        {},
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private secretsMatch(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    return (
      providedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(providedBuffer, expectedBuffer)
    );
  }

  private summarizeWebhookBody(body: Record<string, unknown>): Record<string, unknown> {
    return {
      event:
        typeof body.event === 'string'
          ? body.event
          : typeof body.ref === 'string'
            ? 'git_ref_update'
            : 'webhook',
      ref: typeof body.ref === 'string' ? body.ref : undefined,
      before: typeof body.before === 'string' ? body.before : undefined,
      after: typeof body.after === 'string' ? body.after : undefined,
    };
  }
}
