import { HttpStatus } from '@nestjs/common';
import { SourceType } from '@prisma/client';
import { AppException } from '../common/app-error';
import { SourceTriggerController } from './source-trigger.controller';
import { SourceTriggerSchedulerService } from './source-trigger-scheduler.service';
import { SourceTriggerService } from './source-trigger.service';
import { SourceTriggerWatchService } from './source-trigger-watch.service';

describe('Source trigger automation', () => {
  const source = {
    id: 'source-1',
    knowledgeBaseId: 'kb-1',
    type: SourceType.git_repo,
    uri: 'https://github.com/example/repo.git',
    status: 'active',
    metadata: {
      syncPolicy: {
        triggerMode: 'schedule',
        enabled: true,
        schedule: '5m',
        mode: 'incremental',
        reason: 'periodic refresh',
      },
    },
  };

  it('enqueues due scheduled refreshes through the normal queue', async () => {
    const prisma = {
      source: {
        findMany: jest.fn().mockResolvedValue([source]),
      },
    };
    const queue = {
      enqueueIndexingJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };
    const triggerService = new SourceTriggerService(
      {} as any,
      {} as any,
      queue as any,
    );
    const scheduler = new SourceTriggerSchedulerService(
      config({ SOURCE_TRIGGER_SCHEDULER_ENABLED: false }),
      prisma as any,
      triggerService,
    );

    await expect(scheduler.runDueScheduledRefreshes(new Date('2026-05-28T10:00:00Z'))).resolves.toEqual([
      { sourceId: 'source-1', jobId: 'job-1' },
    ]);
    expect(queue.enqueueIndexingJob).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        sourceId: 'source-1',
        refresh: expect.objectContaining({
          mode: 'incremental',
          reason: 'periodic refresh',
          trigger: 'schedule',
          triggerMetadata: expect.objectContaining({
            schedule: '5m',
            scheduledAt: '2026-05-28T10:00:00.000Z',
          }),
        }),
      }),
    );
  });

  it('skips scheduled refreshes when auto-refresh policy is disabled', async () => {
    const prisma = {
      source: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...source,
            metadata: {
              syncPolicy: {
                triggerMode: 'schedule',
                enabled: false,
                schedule: '5m',
                mode: 'incremental',
              },
            },
          },
        ]),
      },
    };
    const queue = {
      enqueueIndexingJob: jest.fn(),
    };
    const triggerService = new SourceTriggerService(
      {} as any,
      {} as any,
      queue as any,
    );
    const scheduler = new SourceTriggerSchedulerService(
      config({ SOURCE_TRIGGER_SCHEDULER_ENABLED: false }),
      prisma as any,
      triggerService,
    );

    await expect(scheduler.runDueScheduledRefreshes(new Date('2026-05-28T10:00:00Z'))).resolves.toEqual([]);
    expect(queue.enqueueIndexingJob).not.toHaveBeenCalled();
  });

  it('rejects explicitly disabled webhook trigger policies', async () => {
    const service = new SourceTriggerService({} as any, {} as any, {
      enqueueIndexingJob: jest.fn(),
    } as any);

    await expect(
      service.enqueueTriggeredRefreshForSource(
        {
          ...source,
          metadata: {
            syncPolicy: {
              triggerMode: 'webhook',
              enabled: false,
              mode: 'incremental',
            },
          },
        } as any,
        'webhook',
      ),
    ).rejects.toMatchObject({
      code: 'source_trigger_not_enabled',
    });
  });

  it('authenticates webhook triggers before enqueueing', async () => {
    const triggerService = {
      enqueueTriggeredRefresh: jest.fn().mockResolvedValue({ job: { id: 'job-2' } }),
    };
    const controller = new SourceTriggerController(
      config({ SOURCE_TRIGGER_WEBHOOK_SECRET: 'secret' }),
      triggerService as any,
    );

    try {
      await controller.triggerWorkspaceSourceWebhook('career-rag', 'source-1', 'wrong', {
        ref: 'refs/heads/main',
        after: 'abc123',
      });
      throw new Error('Expected webhook auth to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe('source_webhook_unauthorized');
      expect((error as AppException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    }

    await controller.triggerWorkspaceSourceWebhook(
      'career-rag',
      'source-1',
      'secret',
      { ref: 'refs/heads/main', after: 'abc123' },
    );

    expect(triggerService.enqueueTriggeredRefresh).toHaveBeenCalledWith(
      'career-rag',
      'source-1',
      'webhook',
      {
        webhookEvent: {
          event: 'git_ref_update',
          ref: 'refs/heads/main',
          before: undefined,
          after: 'abc123',
        },
      },
    );
  });

  it('debounces watch refresh events', async () => {
    jest.useFakeTimers();
    const watchSource = {
      ...source,
      type: SourceType.local_folder,
      uri: '/tmp/docs',
      metadata: {
        syncPolicy: {
          triggerMode: 'watch',
          enabled: true,
          watchDebounceMs: 1000,
          mode: 'incremental',
        },
      },
    };
    const triggerService = {
      resolveSource: jest.fn().mockResolvedValue(watchSource),
      enqueueTriggeredRefreshForSource: jest.fn().mockResolvedValue({ job: { id: 'job-3' } }),
    };
    const watchService = new SourceTriggerWatchService(
      config({ SOURCE_TRIGGER_WATCH_ENABLED: false }),
      {} as any,
      triggerService as any,
    );

    await watchService.enqueueDebouncedWatchRefresh('source-1', { path: 'a.md' });
    await watchService.enqueueDebouncedWatchRefresh('source-1', { path: 'b.md' });
    jest.advanceTimersByTime(999);
    expect(triggerService.enqueueTriggeredRefreshForSource).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(triggerService.enqueueTriggeredRefreshForSource).toHaveBeenCalledTimes(1);
    expect(triggerService.enqueueTriggeredRefreshForSource).toHaveBeenCalledWith(
      watchSource,
      'watch',
      expect.objectContaining({
        path: 'b.md',
        debounceMs: 1000,
      }),
    );
    watchService.onModuleDestroy();
    jest.useRealTimers();
  });

  it('rejects triggers when the source policy is not enabled for that trigger', async () => {
    const service = new SourceTriggerService({} as any, {} as any, {
      enqueueIndexingJob: jest.fn(),
    } as any);

    await expect(service.enqueueTriggeredRefreshForSource(source as any, 'webhook')).rejects.toBeInstanceOf(
      AppException,
    );
  });

  function config(values: Record<string, unknown>) {
    return {
      get: jest.fn((key: string) => values[key]),
    } as any;
  }
});
