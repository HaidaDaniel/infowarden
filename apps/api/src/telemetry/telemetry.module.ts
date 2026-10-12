import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TelemetryMiddleware } from './telemetry.middleware';
import { TelemetryService } from './telemetry.service';

@Global()
@Module({
  providers: [TelemetryService, TelemetryMiddleware],
  exports: [TelemetryService],
})
export class TelemetryModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TelemetryMiddleware).forRoutes('*');
  }
}
