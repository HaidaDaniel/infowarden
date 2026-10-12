import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { parseScheduleIntervalMs, readSourceSyncPolicy } from '../sources/source-sync-policy';
import { SourceTriggerService } from './source-trigger.service';

@Injectable()
export class SourceTriggerSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SourceTriggerSchedulerService.name);
  private readonly lastRuns = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sourceTriggerService: SourceTriggerService,
  ) {}

  onModuleInit(): void {
    if (this.configService.get<boolean>('SOURCE_TRIGGER_SCHEDULER_ENABLED') !== true) {
      return;
    }

    const pollMs = this.configService.get<number>('SOURCE_TRIGGER_SCHEDULER_POLL_MS') || 60000;
    this.timer = setInterval(() => {
      void this.runDueScheduledRefreshes().catch((error) => {
        this.logger.error('Scheduled source refresh scan failed', error);
      });
    }, pollMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runDueScheduledRefreshes(now = new Date()) {
    const sources = await this.prisma.source.findMany({
      where: { status: 'active' },
    });
    const enqueued: Array<{ sourceId: string; jobId: string }> = [];

    for (const source of sources) {
      const policy = readSourceSyncPolicy(source.metadata);
      if (!policy || policy.enabled === false || policy.triggerMode !== 'schedule') {
        continue;
      }

      const intervalMs = policy.schedule ? parseScheduleIntervalMs(policy.schedule) : undefined;
      if (!intervalMs) {
        continue;
      }

      const lastRun = this.lastRuns.get(source.id) || 0;
      if (now.getTime() - lastRun < intervalMs) {
        continue;
      }

      const result = await this.sourceTriggerService.enqueueTriggeredRefreshForSource(
        source,
        'schedule',
        {
          schedule: policy.schedule,
          scheduledAt: now.toISOString(),
        },
      );
      this.lastRuns.set(source.id, now.getTime());
      enqueued.push({ sourceId: source.id, jobId: result.job.id });
    }

    return enqueued;
  }
}
