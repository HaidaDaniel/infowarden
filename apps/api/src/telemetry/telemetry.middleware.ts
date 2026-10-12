import { Injectable, NestMiddleware } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { createTraceContext, parseTraceparent, toTraceparent } from './trace-context';

@Injectable()
export class TelemetryMiddleware implements NestMiddleware {
  constructor(private readonly telemetry: TelemetryService) {}

  use(req: any, res: any, next: () => void) {
    const context = createTraceContext(parseTraceparent(req.headers.traceparent));
    context.attributes = {
      'http.method': req.method,
      'http.route': req.path,
    };

    res.setHeader('traceparent', toTraceparent(context));
    const start = Date.now();
    res.on('finish', () => {
      void this.telemetry.runWithContext(context, () => {
        this.telemetry.record(res.statusCode >= 500 ? 'error' : 'info', 'http.request', {
          'http.status_code': res.statusCode,
          durationMs: Date.now() - start,
        });
      });
    });

    void this.telemetry.runWithContext(context, next);
  }
}
