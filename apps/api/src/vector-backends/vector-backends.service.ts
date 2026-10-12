import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VectorBackend, VectorBackendState } from '@prisma/client';
import { AppException } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { QdrantAdapter } from '../vector-index/qdrant.adapter';

const DEFAULT_BACKEND_NAME = 'default-qdrant';
const MAX_HEALTH_BODY_BYTES = 1024 * 1024;
const MAX_COLLECTIONS_INSPECTED = 100;
const DEFAULT_BACKEND_DISK_BYTES = 50 * 1024 ** 3;
const DEFAULT_BACKEND_RAM_BYTES = 4 * 1024 ** 3;
const DEFAULT_BACKEND_MAX_WORKSPACES = 25;

export type VectorBackendInput = {
  name: string;
  baseUrl: string;
  apiKeyRef?: string | null;
  tlsVerify?: boolean;
  networkPolicy?: Record<string, unknown>;
  labels?: string[];
  state?: 'enabled' | 'draining' | 'disabled';
  capacityHints?: Record<string, unknown>;
};

@Injectable()
export class VectorBackendsService implements OnModuleInit, OnModuleDestroy {
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly qdrantAdapter: QdrantAdapter,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultBackend();
    if (this.configService.get<boolean>('VECTOR_BACKEND_HEALTH_REFRESH_ENABLED')) {
      const intervalMs = this.configService.get<number>('VECTOR_BACKEND_HEALTH_REFRESH_MS', 300000);
      this.refreshTimer = setInterval(() => void this.refreshAllHealth(), intervalMs);
      this.refreshTimer.unref();
    }
  }

  onModuleDestroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }

  async list() {
    await this.ensureDefaultBackend();
    const backends = await this.prisma.vectorBackend.findMany({
      orderBy: [{ createdAt: 'asc' }],
    });
    return backends.map((backend) => this.toPublicRecord(backend));
  }

  async readModel() {
    await this.ensureDefaultBackend();
    const [backends, placements, operations] = await Promise.all([
      this.prisma.vectorBackend.findMany({
        orderBy: [{ createdAt: 'asc' }],
      }),
      this.prisma.workspaceVectorPlacement.findMany({
        include: {
          knowledgeBase: {
            select: {
              id: true,
              slug: true,
              name: true,
              workspaceKind: true,
              servingRevisionState: true,
              activeIndexVersionId: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
      }),
      this.prisma.vectorMaterializationOperation.findMany({
        where: {
          state: {
            in: [
              'planned',
              'building',
              'validating',
              'ready_for_cutover',
              'cutover_complete',
              'rollback_complete',
              'cleanup_pending',
              'failed',
            ],
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 100,
      }),
    ]);

    const placementsByBackend = new Map<string, typeof placements>();
    for (const placement of placements) {
      const items = placementsByBackend.get(placement.vectorBackendId) || [];
      items.push(placement);
      placementsByBackend.set(placement.vectorBackendId, items);
    }

    return {
      policy: {
        topology: 'independent_backends',
        oneWorkspaceOneBackend: true,
        automaticFailover: false,
        transparentSharding: false,
        replicas: false,
        note: 'Independent Qdrant backends increase workspace isolation and aggregate capacity; they are not replicas or transparent shards.',
      },
      backends: backends.map((backend) => {
        const assigned = placementsByBackend.get(backend.id) || [];
        return {
          ...this.toPublicRecord(backend),
          assignedWorkspaceCount: assigned.length,
          assignedWorkspaces: assigned.map((placement) => ({
            workspace: placement.knowledgeBase,
            placement: {
              id: placement.id,
              mode: placement.mode,
              state: placement.state,
              collectionAlias: placement.collectionAlias,
              physicalCollectionName: placement.physicalCollectionName,
              servingRevisionId: placement.servingRevisionId,
              activeIndexBuildId: placement.activeIndexBuildId,
              reasonSnapshot: placement.reasonSnapshot,
              capacitySnapshot: placement.capacitySnapshot,
              updatedAt: placement.updatedAt,
            },
            lifecycleErrors: this.lifecycleErrors(placement),
          })),
          operations: operations
            .filter(
              (operation) =>
                operation.sourceVectorBackendId === backend.id || operation.targetVectorBackendId === backend.id,
            )
            .map((operation) => ({
              id: operation.id,
              knowledgeBaseId: operation.knowledgeBaseId,
              kind: operation.kind,
              state: operation.state,
              sourceVectorBackendId: operation.sourceVectorBackendId,
              targetVectorBackendId: operation.targetVectorBackendId,
              sourceCollectionName: operation.sourceCollectionName,
              targetCollectionName: operation.targetCollectionName,
              servingRevisionId: operation.servingRevisionId,
              rollbackUntil: operation.rollbackUntil,
              cleanupAfter: operation.cleanupAfter,
              validationSummary: operation.validationSummary,
              errorSummary: operation.errorSummary,
              updatedAt: operation.updatedAt,
            })),
        };
      }),
    };
  }

  async findOne(id: string) {
    const backend = await this.prisma.vectorBackend.findUnique({
      where: { id },
    });
    if (!backend) {
      throw new AppException('vector_backend_not_found', 'Vector backend was not found', 'vector_backend_read', false, {
        backendId: id,
      });
    }
    return this.toPublicRecord(backend);
  }

  async create(input: VectorBackendInput) {
    const data = this.normalizeInput(input);
    try {
      const backend = await this.prisma.vectorBackend.create({ data });
      return this.toPublicRecord(backend);
    } catch (error) {
      this.throwDuplicateOrInvalid(error, data);
    }
  }

  async update(id: string, input: Partial<VectorBackendInput>) {
    await this.findOne(id);
    const data = this.normalizeInput(input, true);
    try {
      const backend = await this.prisma.vectorBackend.update({
        where: { id },
        data,
      });
      return this.toPublicRecord(backend);
    } catch (error) {
      this.throwDuplicateOrInvalid(error, data);
    }
  }

  async refreshAllHealth() {
    await this.ensureDefaultBackend();
    const backends = await this.prisma.vectorBackend.findMany({
      where: { state: { not: VectorBackendState.disabled } },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(backends.map((backend) => this.refreshHealthRecord(backend)));
  }

  async refreshHealth(id: string) {
    const backend = await this.prisma.vectorBackend.findUnique({
      where: { id },
    });
    if (!backend) {
      throw new AppException(
        'vector_backend_not_found',
        'Vector backend was not found',
        'vector_backend_health',
        false,
        { backendId: id },
      );
    }
    if (backend.state === VectorBackendState.disabled) {
      return this.toPublicRecord(backend);
    }
    return this.refreshHealthRecord(backend);
  }

  async ensureDefaultBackend() {
    const existing = await this.prisma.vectorBackend.findFirst({
      where: { name: DEFAULT_BACKEND_NAME },
    });
    if (existing) {
      return this.ensureDefaultCapacityHints(existing);
    }

    const baseUrl = this.normalizeBaseUrl(this.configService.get<string>('QDRANT_HTTP_URL') || this.defaultBaseUrl());
    const byUrl = await this.prisma.vectorBackend.findUnique({
      where: { baseUrl },
    });
    if (byUrl) {
      return this.ensureDefaultCapacityHints(byUrl);
    }

    return this.prisma.vectorBackend.create({
      data: {
        name: DEFAULT_BACKEND_NAME,
        baseUrl,
        apiKeyRef: this.optionalSecretRef(this.configService.get<string>('QDRANT_API_KEY_REF')),
        tlsVerify: true,
        networkPolicy: { source: 'environment_compatibility' },
        labels: ['default', 'environment'],
        state: VectorBackendState.enabled,
        capacityHints: this.defaultCapacityHints() as Prisma.InputJsonValue,
      },
    });
  }

  private async ensureDefaultCapacityHints(backend: VectorBackend) {
    if (backend.name !== DEFAULT_BACKEND_NAME) {
      return backend;
    }
    const current = this.recordValue(backend.capacityHints);
    const defaults = this.defaultCapacityHints();
    const merged = {
      ...defaults,
      ...current,
    };
    const missingRequired =
      !this.positiveNumber(current.diskBytes) ||
      !this.positiveNumber(current.ramBytes) ||
      !this.positiveNumber(current.maxWorkspaces);
    if (!missingRequired) {
      return backend;
    }
    return this.prisma.vectorBackend.update({
      where: { id: backend.id },
      data: {
        capacityHints: merged as Prisma.InputJsonValue,
      },
    });
  }

  private async refreshHealthRecord(backend: VectorBackend) {
    const startedAt = Date.now();
    try {
      const client = this.qdrantAdapter.createClientForBackendRecord(backend, this.healthTimeoutMs());
      const version = await this.fetchBoundedJson(backend, '/');
      const collections = await client.getCollections();
      const names = collections.collections.slice(0, MAX_COLLECTIONS_INSPECTED).map((item) => item.name);
      const infos = await Promise.all(
        names.map(async (name) => {
          try {
            return await client.getCollection(name);
          } catch {
            return null;
          }
        }),
      );
      const vectorCount = infos.reduce((sum, info) => sum + this.numberValue((info as any)?.points_count), 0);
      const observedResources = {
        collectionCount: collections.collections.length,
        inspectedCollectionCount: names.length,
        vectorCount,
        diskBytes: this.numberOrNull((version as any)?.result?.disk_data_size),
        checkedAt: new Date().toISOString(),
      };
      const healthMetadata = {
        healthy: true,
        compatible: Boolean(version && collections),
        version: this.stringOrNull((version as any)?.result?.version),
        latencyMs: Date.now() - startedAt,
        collectionApi: true,
        inventoryTruncated: collections.collections.length > MAX_COLLECTIONS_INSPECTED,
        bodyLimitBytes: MAX_HEALTH_BODY_BYTES,
      };
      const updated = await this.prisma.vectorBackend.update({
        where: { id: backend.id },
        data: {
          state:
            backend.state === VectorBackendState.draining ? VectorBackendState.draining : VectorBackendState.enabled,
          observedResources: observedResources as Prisma.InputJsonValue,
          healthMetadata: healthMetadata as Prisma.InputJsonValue,
          lastHealthAt: new Date(),
          lastErrorCode: null,
        },
      });
      return this.toPublicRecord(updated);
    } catch (error) {
      const code = this.healthErrorCode(error);
      const updated = await this.prisma.vectorBackend.update({
        where: { id: backend.id },
        data: {
          state: VectorBackendState.offline,
          healthMetadata: {
            healthy: false,
            compatible: false,
            latencyMs: Date.now() - startedAt,
            errorCode: code,
          } as Prisma.InputJsonValue,
          lastHealthAt: new Date(),
          lastErrorCode: code,
        },
      });
      return this.toPublicRecord(updated);
    }
  }

  private async fetchBoundedJson(backend: VectorBackend, path: string): Promise<unknown> {
    const apiKey = backend.apiKeyRef ? process.env[backend.apiKeyRef] : undefined;
    if (backend.apiKeyRef && !apiKey) {
      throw new AppException(
        'vector_backend_api_key_missing',
        'Vector backend API key is not available',
        'vector_backend_health',
        false,
        { backendId: backend.id, apiKeyRef: backend.apiKeyRef },
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.healthTimeoutMs());
    try {
      const response = await fetch(`${backend.baseUrl}${path}`, {
        headers: apiKey ? { 'api-key': apiKey } : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Qdrant health request failed with HTTP ${response.status}`);
      }
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_HEALTH_BODY_BYTES) {
        throw new Error('Qdrant health response exceeds body limit');
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > MAX_HEALTH_BODY_BYTES) {
        throw new Error('Qdrant health response exceeds body limit');
      }
      return JSON.parse(body.toString('utf8'));
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeInput(input: Partial<VectorBackendInput>, partial = false) {
    const data: Record<string, unknown> = {};
    if (!partial || input.name !== undefined) {
      const name = input.name?.trim();
      if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
        throw this.invalid('name must be 1-64 URL-safe characters');
      }
      data.name = name;
    }
    if (!partial || input.baseUrl !== undefined) {
      data.baseUrl = this.normalizeBaseUrl(input.baseUrl || '');
    }
    if (input.apiKeyRef !== undefined) data.apiKeyRef = this.optionalSecretRef(input.apiKeyRef);
    if (input.tlsVerify !== undefined) data.tlsVerify = Boolean(input.tlsVerify);
    if (input.networkPolicy !== undefined) data.networkPolicy = this.objectValue(input.networkPolicy, 'networkPolicy');
    if (input.capacityHints !== undefined) data.capacityHints = this.objectValue(input.capacityHints, 'capacityHints');
    if (input.labels !== undefined) data.labels = this.normalizeLabels(input.labels);
    if (input.state !== undefined) data.state = this.operatorState(input.state);
    return data as Prisma.VectorBackendUncheckedCreateInput;
  }

  private normalizeBaseUrl(value: string) {
    try {
      const url = new URL(value.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('invalid endpoint');
      }
      return url.toString().replace(/\/$/, '');
    } catch {
      throw this.invalid('baseUrl must be an http(s) URL without credentials, query, or fragment');
    }
  }

  private defaultBaseUrl() {
    const host = this.configService.get<string>('QDRANT_HOST', 'localhost');
    const port = this.configService.get<number>('QDRANT_PORT', 6333);
    const https = this.configService.get<boolean>('QDRANT_HTTPS', false);
    return `${https ? 'https' : 'http'}://${host}:${port}`;
  }

  private defaultCapacityHints() {
    return {
      diskBytes: this.positiveConfigNumber('VECTOR_BACKEND_DEFAULT_DISK_BYTES', DEFAULT_BACKEND_DISK_BYTES),
      ramBytes: this.positiveConfigNumber('VECTOR_BACKEND_DEFAULT_RAM_BYTES', DEFAULT_BACKEND_RAM_BYTES),
      maxWorkspaces: this.positiveConfigNumber('VECTOR_BACKEND_DEFAULT_MAX_WORKSPACES', DEFAULT_BACKEND_MAX_WORKSPACES),
      source: 'environment_default',
    };
  }

  private optionalSecretRef(value?: string | null) {
    if (!value?.trim()) return null;
    const normalized = value.trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(normalized)) {
      throw this.invalid('apiKeyRef must be an environment-variable name');
    }
    return normalized;
  }

  private normalizeLabels(labels: string[]) {
    if (!Array.isArray(labels) || labels.length > 32) throw this.invalid('labels must contain at most 32 items');
    return [...new Set(labels.map((label) => label.trim()).filter(Boolean))].map((label) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(label)) throw this.invalid('labels must be URL-safe');
      return label;
    });
  }

  private operatorState(state: string): VectorBackendState {
    if (!['enabled', 'draining', 'disabled'].includes(state)) {
      throw this.invalid('state must be enabled, draining, or disabled; offline is health-managed');
    }
    return state as VectorBackendState;
  }

  private objectValue(value: unknown, field: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw this.invalid(`${field} must be an object`);
    return value as Prisma.InputJsonValue;
  }

  private recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private positiveConfigNumber(key: string, fallback: number) {
    const value = Number(this.configService.get<number | string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private positiveNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  }

  private toPublicRecord(backend: VectorBackend) {
    const { apiKeyRef, ...safe } = backend;
    return {
      ...safe,
      hasApiKeyRef: Boolean(apiKeyRef),
      apiKeyRef: apiKeyRef ? '[configured]' : null,
    };
  }

  private lifecycleErrors(placement: { state: string; vectorBackendId: string; reasonSnapshot: Prisma.JsonValue }) {
    const reason =
      placement.reasonSnapshot &&
      typeof placement.reasonSnapshot === 'object' &&
      !Array.isArray(placement.reasonSnapshot)
        ? (placement.reasonSnapshot as Record<string, unknown>)
        : {};
    const errors = [];
    if (['degraded', 'failed', 'partially_loaded'].includes(placement.state)) {
      errors.push({
        code: typeof reason.reason === 'string' ? reason.reason : `workspace_${placement.state}`,
        state: placement.state,
        vectorBackendId: placement.vectorBackendId,
        details: reason,
      });
    }
    return errors;
  }

  private healthTimeoutMs() {
    return this.configService.get<number>('VECTOR_BACKEND_HEALTH_TIMEOUT_MS', 3000);
  }

  private healthErrorCode(error: unknown) {
    if (error instanceof AppException) return error.code;
    if ((error as Error)?.name === 'AbortError') return 'vector_backend_timeout';
    return 'vector_backend_unavailable';
  }

  private throwDuplicateOrInvalid(error: unknown, data: Record<string, unknown>): never {
    if ((error as { code?: string })?.code === 'P2002') {
      throw new AppException(
        'vector_backend_duplicate_endpoint',
        'Vector backend name or endpoint already exists',
        'vector_backend_write',
        false,
        { name: data.name, baseUrl: data.baseUrl },
      );
    }
    throw error;
  }

  private invalid(message: string) {
    return new AppException('vector_backend_invalid', message, 'vector_backend_validation', false);
  }

  private numberValue(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private numberOrNull(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private stringOrNull(value: unknown) {
    return typeof value === 'string' ? value : null;
  }
}
