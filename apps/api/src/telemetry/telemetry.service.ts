import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import {
  TraceContext,
  createTraceContext,
  sanitizeAttributes,
  toTraceparent,
} from './trace-context';

type SpanResult<T> = T | Promise<T>;

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly storage = new AsyncLocalStorage<TraceContext>();

  runWithContext<T>(context: TraceContext, callback: () => SpanResult<T>): SpanResult<T> {
    return this.storage.run(context, callback);
  }

  current(): TraceContext {
    return this.storage.getStore() || createTraceContext();
  }

  traceparent(): string {
    return toTraceparent(this.current());
  }

  childContext(attributes: Record<string, unknown> = {}): TraceContext {
    const parent = this.current();
    return {
      ...createTraceContext(parent),
      attributes: {
        ...parent.attributes,
        ...sanitizeAttributes(attributes),
      },
    };
  }

  async span<T>(
    name: string,
    attributes: Record<string, unknown>,
    callback: () => Promise<T>,
  ): Promise<T> {
    const context = this.childContext({
      'span.name': name,
      ...attributes,
    });
    const start = Date.now();
    return this.storage.run(context, async () => {
      try {
        const result = await callback();
        this.record('info', name, {
          ...context.attributes,
          durationMs: Date.now() - start,
          status: 'ok',
        });
        return result;
      } catch (error) {
        this.record('error', name, {
          ...context.attributes,
          durationMs: Date.now() - start,
          status: 'error',
          errorCode: (error as any)?.code || (error as any)?.response?.code || 'unhandled_error',
          errorStage: (error as any)?.stage || (error as any)?.response?.stage || name,
        });
        throw error;
      }
    });
  }

  record(level: 'info' | 'error', event: string, attributes: Record<string, unknown> = {}) {
    const context = this.current();
    const payload = {
      event,
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId: context.parentSpanId,
      ...sanitizeAttributes({
        ...context.attributes,
        ...attributes,
      }),
    };
    const message = JSON.stringify(payload);
    if (level === 'error') {
      this.logger.error(message);
    } else {
      this.logger.log(message);
    }
  }
}
