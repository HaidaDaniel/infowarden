import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SourceType } from '@prisma/client';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { readSourceSyncPolicy } from '../sources/source-sync-policy';
import { SourceTriggerService } from './source-trigger.service';

@Injectable()
export class SourceTriggerWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SourceTriggerWatchService.name);
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sourceTriggerService: SourceTriggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.configService.get<boolean>('SOURCE_TRIGGER_WATCH_ENABLED') !== true) {
      return;
    }

    await this.startConfiguredWatchers();
  }

  onModuleDestroy(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  async startConfiguredWatchers(): Promise<number> {
    const sources = await this.prisma.source.findMany({
      where: {
        status: 'active',
        type: { in: [SourceType.local_folder, SourceType.obsidian_vault] },
      },
    });
    let started = 0;

    for (const source of sources) {
      const policy = readSourceSyncPolicy(source.metadata);
      if (!policy || policy.enabled === false || policy.triggerMode !== 'watch') {
        continue;
      }

      if (this.watchers.has(source.id) || !this.isWatchableDirectory(source.uri)) {
        continue;
      }

      const watcher = fs.watch(source.uri, { persistent: false }, (eventType, filename) => {
        void this.enqueueDebouncedWatchRefresh(source.id, {
          eventType,
          path: filename?.toString(),
        });
      });
      watcher.on('error', (error) => {
        this.logger.warn(`Filesystem watcher failed for source ${source.id}: ${error.message}`);
      });
      this.watchers.set(source.id, watcher);
      started += 1;
    }

    return started;
  }

  async enqueueDebouncedWatchRefresh(
    sourceId: string,
    triggerMetadata: Record<string, unknown> = {},
  ): Promise<void> {
    const source = await this.sourceTriggerService.resolveSource(sourceId);
    const policy = readSourceSyncPolicy(source.metadata);
    const debounceMs = policy?.watchDebounceMs || 5000;
    const existing = this.debounceTimers.get(sourceId);

    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(sourceId);
      void this.sourceTriggerService
        .enqueueTriggeredRefreshForSource(source, 'watch', {
          ...triggerMetadata,
          debounceMs,
          watchedAt: new Date().toISOString(),
        })
        .catch((error) => {
          this.logger.warn(`Watch-triggered refresh failed for source ${sourceId}: ${error.message}`);
        });
    }, debounceMs);
    this.debounceTimers.set(sourceId, timer);
  }

  private isWatchableDirectory(uri: string): boolean {
    try {
      return fs.existsSync(uri) && fs.statSync(uri).isDirectory();
    } catch {
      return false;
    }
  }
}
