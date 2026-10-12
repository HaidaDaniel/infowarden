import {
  SourceSyncPolicyDto,
  SourceSyncRefreshMode,
  SourceSyncTriggerMode,
  SourceTruthMode,
  SourceTruthPolicyDto,
  SourceWritePolicy,
} from './dto/update-source.dto';

export type SourceSyncPolicy = {
  triggerMode: SourceSyncTriggerMode;
  enabled: boolean;
  schedule?: string;
  webhookSecretRef?: string;
  watchDebounceMs?: number;
  mode: SourceSyncRefreshMode;
  reason?: string;
};

export type SourceTruthPolicy = {
  truthMode: SourceTruthMode;
  writePolicy: SourceWritePolicy;
  reason?: string;
};

const DEFAULT_REFRESH_MODE: SourceSyncRefreshMode = 'incremental';
const DEFAULT_WATCH_DEBOUNCE_MS = 5000;
const DEFAULT_TRUTH_MODE: SourceTruthMode = 'read_only';
const DEFAULT_WRITE_POLICY: SourceWritePolicy = 'disabled';

export function normalizePlainMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  return { ...(metadata as Record<string, unknown>) };
}

export function normalizeSourceSyncPolicy(policy: SourceSyncPolicyDto): SourceSyncPolicy {
  return {
    triggerMode: policy.triggerMode,
    enabled: policy.enabled !== false,
    ...(policy.schedule !== undefined ? { schedule: policy.schedule.trim() } : {}),
    ...(policy.webhookSecretRef !== undefined
      ? { webhookSecretRef: policy.webhookSecretRef.trim() }
      : {}),
    watchDebounceMs: policy.watchDebounceMs || DEFAULT_WATCH_DEBOUNCE_MS,
    mode: policy.mode || DEFAULT_REFRESH_MODE,
    ...(policy.reason !== undefined ? { reason: policy.reason.trim() } : {}),
  };
}

export function normalizeSourceTruthPolicy(policy: SourceTruthPolicyDto = {}): SourceTruthPolicy {
  return {
    truthMode: policy.truthMode || DEFAULT_TRUTH_MODE,
    writePolicy: policy.writePolicy || DEFAULT_WRITE_POLICY,
    ...(policy.reason !== undefined ? { reason: policy.reason.trim() } : {}),
  };
}

export function readSourceTruthPolicy(metadata: unknown): SourceTruthPolicy {
  const value = normalizePlainMetadata(metadata);
  const policy = value.sourceTruthPolicy;

  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return normalizeSourceTruthPolicy();
  }

  const raw = policy as Record<string, unknown>;
  return normalizeSourceTruthPolicy({
    truthMode: raw.truthMode === 'read_only' ? raw.truthMode : undefined,
    writePolicy: raw.writePolicy === 'disabled' ? raw.writePolicy : undefined,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
  });
}

export function readSourceSyncPolicy(metadata: unknown): SourceSyncPolicy | undefined {
  const value = normalizePlainMetadata(metadata);
  const policy = value.syncPolicy;

  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return undefined;
  }

  const raw = policy as Record<string, unknown>;
  if (
    raw.triggerMode !== 'manual' &&
    raw.triggerMode !== 'schedule' &&
    raw.triggerMode !== 'webhook' &&
    raw.triggerMode !== 'watch'
  ) {
    return undefined;
  }

  return normalizeSourceSyncPolicy({
    triggerMode: raw.triggerMode,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : undefined,
    schedule: typeof raw.schedule === 'string' ? raw.schedule : undefined,
    webhookSecretRef:
      typeof raw.webhookSecretRef === 'string' ? raw.webhookSecretRef : undefined,
    watchDebounceMs:
      typeof raw.watchDebounceMs === 'number' ? raw.watchDebounceMs : undefined,
    mode:
      raw.mode === 'incremental' ||
      raw.mode === 'force_reembed' ||
      raw.mode === 'force_rechunk' ||
      raw.mode === 'rebuild_collection'
        ? raw.mode
        : undefined,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
  });
}

export function parseScheduleIntervalMs(schedule: string): number | undefined {
  const value = schedule.trim().toLowerCase();
  const match = value.match(/^(?:every\s+)?(\d+)\s*(ms|s|m|h|d)$/);

  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === 'ms'
      ? 1
      : unit === 's'
        ? 1000
        : unit === 'm'
          ? 60 * 1000
          : unit === 'h'
            ? 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;

  return amount * multiplier;
}
