import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { VectorBackend } from "@prisma/client";
import { QdrantClient } from "@qdrant/js-client-rest";
import { AppException, getErrorMessage } from "../common/app-error";
import { PrismaService } from "../prisma/prisma.service";
import {
  QdrantCollectionOptions,
  qdrantOptionsForStorageProfile,
  StorageProfile,
} from "./storage-profile";
import { TelemetryService } from "../telemetry/telemetry.service";

export interface VectorPayload {
  knowledgeBaseId?: string;
  sourceId?: string;
  sourceRevisionId?: string;
  workspaceServingRevisionId?: string;
  indexBuildId?: string;
  parserVersion?: string;
  chunkerVersion?: string;
  contentHash?: string;
  payloadSchemaVersion?: string;
  vectorBackendId?: string;
  vectorPointId?: string;
  documentId: string;
  chunkId: string;
  indexVersionId: string;
  text?: string;
  tokenCount?: number;
  chunkIndex?: number;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchHit {
  id: string;
  score: number;
  payload: VectorPayload;
}

export interface VectorSearchFilters {
  sourceRevisionIds?: string[];
  pathPrefix?: string;
  language?: string;
  branch?: string;
  metadata?: Record<string, unknown>;
}

const REQUIRED_PAYLOAD_INDEXES: Array<{ fieldName: string; fieldSchema: 'keyword' | 'text' }> = [
  { fieldName: 'sourceRevisionId', fieldSchema: 'keyword' },
  { fieldName: 'metadata.path', fieldSchema: 'text' },
  { fieldName: 'metadata.language', fieldSchema: 'keyword' },
  { fieldName: 'metadata.branch', fieldSchema: 'keyword' },
];

@Injectable()
export class QdrantAdapter implements OnModuleInit, OnModuleDestroy {
  private client: QdrantClient;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(TelemetryService)
    private readonly telemetry?: Pick<TelemetryService, "record">,
  ) {
    const host = process.env.QDRANT_HOST || "localhost";
    const port = parseInt(process.env.QDRANT_PORT || "6333", 10);
    const https =
      (process.env.QDRANT_HTTPS || "false").toLowerCase() === "true";

    this.client = this.createClient({
      host,
      port,
      https,
      timeout: 30000,
    });
  }

  async createClientForBackend(
    backendId: string,
    timeout = 30000,
  ): Promise<QdrantClient> {
    const backend = await this.prisma.vectorBackend.findUnique({
      where: { id: backendId },
    });
    if (!backend) {
      throw new AppException(
        "vector_backend_not_found",
        "Vector backend was not found",
        "qdrant_backend_resolution",
        false,
        { backendId },
      );
    }
    return this.createClientForBackendRecord(backend, timeout);
  }

  createClientForBackendRecord(
    backend: Pick<VectorBackend, "id" | "baseUrl" | "apiKeyRef">,
    timeout = 30000,
  ): QdrantClient {
    const apiKey = backend.apiKeyRef
      ? process.env[backend.apiKeyRef]
      : undefined;
    if (backend.apiKeyRef && !apiKey) {
      throw new AppException(
        "vector_backend_api_key_missing",
        "Vector backend API key is not available",
        "qdrant_backend_resolution",
        false,
        { backendId: backend.id, apiKeyRef: backend.apiKeyRef },
      );
    }
    return this.createClient({ url: backend.baseUrl, apiKey, timeout });
  }

  private createClient(options: ConstructorParameters<typeof QdrantClient>[0]) {
    return new QdrantClient(options);
  }

  async onModuleInit() {
    try {
      await this.client.getCollections();
    } catch (error) {
      console.warn(
        "Qdrant connection failed, adapter will operate in offline mode",
      );
    }
  }

  async onModuleDestroy() {
    // Cleanup if needed
  }

  async createCollection(
    collectionName: string,
    vectorSize: number,
    distance: "Cosine" | "Euclid" | "Dot" = "Cosine",
    options?: Partial<QdrantCollectionOptions> & {
      storageProfile?: StorageProfile;
    },
    vectorBackendId?: string,
  ): Promise<void> {
    const effectiveOptions = {
      ...qdrantOptionsForStorageProfile(options?.storageProfile || "balanced"),
      ...options,
    };
    try {
      const client = await this.resolveClient(vectorBackendId);
      await client.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance,
          on_disk: effectiveOptions.onDiskVectors,
        },
        on_disk_payload: effectiveOptions.onDiskPayload,
        hnsw_config: {
          on_disk: effectiveOptions.onDiskHnsw,
        },
        ...(effectiveOptions.scalarQuantization
          ? {
              quantization_config: {
                scalar: {
                  type: "int8",
                  quantile: 0.99,
                  always_ram: false,
                },
              },
            }
          : {}),
      });
      await this.ensurePayloadIndexes(collectionName, vectorBackendId);
      this.telemetry?.record("info", "qdrant.collection.create", {
        collectionName,
        vectorBackendId: vectorBackendId || "default",
        vectorSize,
        distance,
        storageProfile: effectiveOptions.storageProfile || "balanced",
      });
    } catch (error) {
      throw new AppException(
        "vector_collection_create_failed",
        "Failed to create vector collection",
        "qdrant_create_collection",
        true,
        { collectionName, cause: getErrorMessage(error) },
      );
    }
  }

  async ensurePayloadIndexes(collectionName: string, vectorBackendId?: string): Promise<void> {
    const client = await this.resolveClient(vectorBackendId);
    for (const index of REQUIRED_PAYLOAD_INDEXES) {
      try {
        await client.createPayloadIndex(collectionName, {
          field_name: index.fieldName,
          field_schema: index.fieldSchema,
          wait: true,
        });
      } catch (error) {
        const message = getErrorMessage(error).toLowerCase();
        if (message.includes('already exists') || message.includes('exists')) {
          continue;
        }
        throw new AppException(
          'qdrant_payload_index_create_failed',
          'Failed to create required Qdrant payload index',
          'qdrant_payload_index',
          true,
          { collectionName, fieldName: index.fieldName, cause: getErrorMessage(error) },
        );
      }
    }
  }

  async upsertVectors(
    collectionName: string,
    vectors: number[][],
    payloads: VectorPayload[],
    vectorBackendId?: string,
  ): Promise<void> {
    const attempts = this.upsertAttempts();
    try {
      const points = vectors.map((vector, i) => ({
        id: this.generatePointId(payloads[i].vectorPointId || payloads[i].chunkId),
        vector,
        payload: {
          documentId: payloads[i].documentId,
          chunkId: payloads[i].chunkId,
          indexVersionId: payloads[i].indexVersionId,
          sourceRevisionId: payloads[i].sourceRevisionId,
          workspaceServingRevisionId: payloads[i].workspaceServingRevisionId,
          indexBuildId: payloads[i].indexBuildId,
          parserVersion: payloads[i].parserVersion,
          chunkerVersion: payloads[i].chunkerVersion,
          contentHash: payloads[i].contentHash,
          payloadSchemaVersion: payloads[i].payloadSchemaVersion,
          vectorBackendId: payloads[i].vectorBackendId,
          text: payloads[i].text || "",
          tokenCount: payloads[i].tokenCount || 0,
          chunkIndex: payloads[i].chunkIndex || 0,
          startLine: payloads[i].startLine || 0,
          endLine: payloads[i].endLine || 0,
          metadata: payloads[i].metadata || {},
        },
      }));

      const client = await this.resolveClient(vectorBackendId);
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await client.upsert(collectionName, {
            points,
            wait: true,
          });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < attempts) {
            await this.sleep(250 * attempt);
          }
        }
      }
      if (lastError) {
        throw lastError;
      }
      this.telemetry?.record("info", "qdrant.upsert", {
        collectionName,
        vectorBackendId: vectorBackendId || "default",
        pointCount: points.length,
        sourceRevisionId: payloads[0]?.sourceRevisionId,
        workspaceServingRevisionId: payloads[0]?.workspaceServingRevisionId,
        indexBuildId: payloads[0]?.indexBuildId,
      });
    } catch (error) {
      throw new AppException(
        "vector_upsert_failed",
        "Failed to upsert vectors",
        "qdrant_upsert_vectors",
        true,
        {
          collectionName,
          count: vectors.length,
          cause: getErrorMessage(error),
        },
      );
    }
  }

  private upsertAttempts() {
    const parsed = Number.parseInt(process.env.QDRANT_UPSERT_ATTEMPTS || "4", 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 8) : 4;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async deleteByDocumentId(
    collectionName: string,
    documentId: string,
  ): Promise<void> {
    try {
      const pointIds = await this.getPointIdsByFilter(collectionName, {
        documentId,
      });
      if (pointIds.length > 0) {
        await this.client.delete(collectionName, {
          points: pointIds,
        });
      }
    } catch (error) {
      throw new AppException(
        "vector_delete_failed",
        "Failed to delete vectors for document",
        "qdrant_delete_document_vectors",
        true,
        { collectionName, documentId, cause: getErrorMessage(error) },
      );
    }
  }

  async deleteByChunkIds(
    collectionName: string,
    chunkIds: string[],
  ): Promise<void> {
    if (chunkIds.length === 0) {
      return;
    }

    try {
      await this.client.delete(collectionName, {
        points: chunkIds.map((chunkId) => this.generatePointId(chunkId)),
      });
    } catch (error) {
      throw new AppException(
        "vector_delete_failed",
        "Failed to delete vectors for chunks",
        "qdrant_delete_chunk_vectors",
        true,
        {
          collectionName,
          count: chunkIds.length,
          cause: getErrorMessage(error),
        },
      );
    }
  }

  async deleteByIndexVersionId(
    collectionName: string,
    indexVersionId: string,
  ): Promise<void> {
    try {
      const pointIds = await this.getPointIdsByFilter(collectionName, {
        indexVersionId,
      });
      if (pointIds.length > 0) {
        await this.client.delete(collectionName, {
          points: pointIds,
        });
      }
    } catch (error) {
      throw new AppException(
        "vector_delete_failed",
        "Failed to delete vectors for index version",
        "qdrant_delete_index_vectors",
        true,
        { collectionName, indexVersionId, cause: getErrorMessage(error) },
      );
    }
  }

  async search(
    collectionName: string,
    queryVector: number[],
    limit: number = 10,
    scoreThreshold?: number,
    filters?: VectorSearchFilters,
    vectorBackendId?: string,
  ): Promise<SearchHit[]> {
    try {
      const client = await this.resolveClient(vectorBackendId);
      const results = await client.search(collectionName, {
        vector: queryVector,
        limit,
        score_threshold: scoreThreshold,
        filter: this.toQdrantFilter(filters),
      });
      this.telemetry?.record("info", "qdrant.search", {
        collectionName,
        vectorBackendId: vectorBackendId || "default",
        limit,
        resultCount: results.length,
        hasScoreThreshold: scoreThreshold !== undefined,
        hasFilters: Boolean(filters),
        sourceRevisionFilterCount: filters?.sourceRevisionIds?.length || 0,
      });

      return results.map((hit) => ({
        id: String(hit.id),
        score: hit.score,
        payload: hit.payload as unknown as VectorPayload,
      }));
    } catch (error) {
      throw new AppException(
        "vector_search_failed",
        "Failed to search vector collection",
        "qdrant_search",
        true,
        { collectionName, cause: getErrorMessage(error) },
      );
    }
  }

  private toQdrantFilter(filters?: VectorSearchFilters): any | undefined {
    if (!filters) {
      return undefined;
    }

    const must: any[] = [];
    const sourceRevisionConditions: any[] = [];
    if (filters.sourceRevisionIds?.length) {
      sourceRevisionConditions.push(
        ...filters.sourceRevisionIds.map((sourceRevisionId) => ({
          key: "sourceRevisionId",
          match: { value: sourceRevisionId },
        })),
      );
    }
    if (filters.pathPrefix) {
      must.push({ key: "metadata.path", match: { text: filters.pathPrefix } });
    }
    if (filters.language) {
      must.push({
        key: "metadata.language",
        match: { value: filters.language },
      });
    }
    if (filters.branch) {
      must.push({ key: "metadata.branch", match: { value: filters.branch } });
    }
    for (const [key, value] of Object.entries(filters.metadata || {})) {
      must.push({ key: `metadata.${key}`, match: { value } });
    }

    if (must.length === 0 && sourceRevisionConditions.length === 0) {
      return undefined;
    }
    return {
      ...(must.length ? { must } : {}),
      ...(sourceRevisionConditions.length
        ? { min_should: { conditions: sourceRevisionConditions, min_count: 1 } }
        : {}),
    };
  }

  async collectionExists(collectionName: string, vectorBackendId?: string): Promise<boolean> {
    try {
      const collections = await (await this.resolveClient(vectorBackendId)).getCollections();
      return collections.collections.some((c) => c.name === collectionName);
    } catch {
      return false;
    }
  }

  async deleteCollection(
    collectionName: string,
    vectorBackendId?: string,
  ): Promise<void> {
    try {
      const client = await this.resolveClient(vectorBackendId);
      if (await this.collectionExists(collectionName, vectorBackendId)) {
        await client.deleteCollection(collectionName);
      }
    } catch (error) {
      throw new AppException(
        "vector_collection_delete_failed",
        "Failed to delete vector collection",
        "qdrant_delete_collection",
        true,
        { collectionName, vectorBackendId, cause: getErrorMessage(error) },
      );
    }
  }

  async switchCollectionAlias(
    aliasName: string,
    targetCollectionName: string,
    vectorBackendId?: string,
  ): Promise<void> {
    const attempts = this.aliasSwitchAttempts();
    let lastError: unknown;
    try {
      const client = await this.resolveClient(vectorBackendId);
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const aliases = await client.getAliases();
          const existing = aliases.aliases.find((alias) => alias.alias_name === aliasName);
          if (existing?.collection_name === targetCollectionName) return;
          const actions: Array<Record<string, unknown>> = [];
          if (existing) {
            actions.push({ delete_alias: { alias_name: aliasName } });
          }
          actions.push({
            create_alias: {
              collection_name: targetCollectionName,
              alias_name: aliasName,
            },
          });
          await client.updateCollectionAliases({ actions: actions as any });
          return;
        } catch (error) {
          lastError = error;
          if (attempt >= attempts) break;
          await this.sleep(250 * attempt);
        }
      }
    } catch (error) {
      lastError = error;
    }
    throw new AppException(
      "vector_alias_switch_failed",
      "Failed to switch vector collection alias",
      "qdrant_switch_collection_alias",
      true,
      { aliasName, targetCollectionName, vectorBackendId, cause: getErrorMessage(lastError) },
    );
  }

  private aliasSwitchAttempts(): number {
    const parsed = Number.parseInt(
      process.env.QDRANT_ALIAS_SWITCH_ATTEMPTS || "4",
      10,
    );
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 8) : 4;
  }

  async listCollections(): Promise<Array<{ name: string }>> {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.map((collection) => ({
        name: collection.name,
      }));
    } catch {
      return [];
    }
  }

  async getCollectionInfo(
    collectionName: string,
    vectorBackendId?: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      if (!(await this.collectionExists(collectionName, vectorBackendId))) {
        return null;
      }
      return (await (await this.resolveClient(vectorBackendId)).getCollection(
        collectionName,
      )) as unknown as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async setPayloads(
    collectionName: string,
    updates: Array<{ chunkId: string; payload: VectorPayload }>,
    vectorBackendId?: string,
  ): Promise<void> {
    try {
      for (const update of updates) {
        await (await this.resolveClient(vectorBackendId)).overwritePayload(collectionName, {
          points: [this.generatePointId(update.payload.vectorPointId || update.chunkId)],
          payload: {
            documentId: update.payload.documentId,
            chunkId: update.payload.chunkId,
            indexVersionId: update.payload.indexVersionId,
            sourceRevisionId: update.payload.sourceRevisionId,
            workspaceServingRevisionId: update.payload.workspaceServingRevisionId,
            indexBuildId: update.payload.indexBuildId,
            parserVersion: update.payload.parserVersion,
            chunkerVersion: update.payload.chunkerVersion,
            contentHash: update.payload.contentHash,
            payloadSchemaVersion: update.payload.payloadSchemaVersion,
            vectorBackendId: update.payload.vectorBackendId,
            text: update.payload.text || "",
            tokenCount: update.payload.tokenCount || 0,
            chunkIndex: update.payload.chunkIndex || 0,
            startLine: update.payload.startLine || 0,
            endLine: update.payload.endLine || 0,
            metadata: update.payload.metadata || {},
          },
          wait: true,
        });
      }
      this.telemetry?.record("info", "qdrant.payload.update", {
        collectionName,
        vectorBackendId: vectorBackendId || "default",
        updateCount: updates.length,
      });
    } catch (error) {
      throw new AppException(
        "vector_payload_update_failed",
        "Failed to update vector payloads",
        "qdrant_update_payloads",
        true,
        {
          collectionName,
          count: updates.length,
          cause: getErrorMessage(error),
        },
      );
    }
  }

  private generatePointId(chunkId: string): string | number {
    const hash = chunkId.replace(/-/g, "");
    if (/^[0-9a-fA-F]{32,}$/.test(hash)) {
      return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    }
    return chunkId;
  }

  async deleteBySourceRevisionId(
    collectionName: string,
    sourceRevisionId: string,
    vectorBackendId?: string,
  ): Promise<void> {
    try {
      const client = await this.resolveClient(vectorBackendId);
      const result = await client.query(collectionName, {
        filter: {
          must: [{ key: "sourceRevisionId", match: { value: sourceRevisionId } }],
        },
        limit: 10_000,
      });
      if (result.points.length > 0) {
        await client.delete(collectionName, { points: result.points.map((point) => point.id) });
      }
    } catch (error) {
      throw new AppException(
        "vector_delete_failed",
        "Failed to delete vectors for source revision",
        "qdrant_delete_source_revision_vectors",
        true,
        { collectionName, sourceRevisionId, cause: getErrorMessage(error) },
      );
    }
  }

  async countBySourceRevisionId(
    collectionName: string,
    sourceRevisionId: string,
    vectorBackendId?: string,
  ): Promise<number> {
    try {
      const result = await (await this.resolveClient(vectorBackendId)).count(collectionName, {
        exact: true,
        filter: {
          must: [{ key: "sourceRevisionId", match: { value: sourceRevisionId } }],
        },
      });
      return result.count;
    } catch (error) {
      throw new AppException(
        "vector_probe_validation_failed",
        "Failed to validate source revision vectors",
        "qdrant_count_source_revision_vectors",
        true,
        { collectionName, sourceRevisionId, cause: getErrorMessage(error) },
      );
    }
  }

  async copyCollectionPoints(input: {
    sourceCollectionName: string;
    targetCollectionName: string;
    sourceVectorBackendId?: string;
    targetVectorBackendId?: string;
    startOffset?: string | number;
    batchSize?: number;
    onBatch?: (progress: {
      copied: number;
      nextOffset?: string | number;
    }) => Promise<void>;
  }): Promise<number> {
    try {
      const source = await this.resolveClient(input.sourceVectorBackendId);
      const target = await this.resolveClient(input.targetVectorBackendId);
      let offset: string | number | undefined = input.startOffset;
      let copied = 0;
      do {
        const page = await source.scroll(input.sourceCollectionName, {
          limit: input.batchSize || 256,
          with_payload: true,
          with_vector: true,
          ...(offset !== undefined ? { offset } : {}),
        });
        if (page.points.length) {
          await target.upsert(input.targetCollectionName, { points: page.points as any, wait: true });
          copied += page.points.length;
        }
        offset = page.next_page_offset as string | number | undefined;
        await input.onBatch?.({ copied, nextOffset: offset });
      } while (offset !== undefined && offset !== null);
      return copied;
    } catch (error) {
      throw new AppException("vector_collection_copy_failed", "Failed to copy candidate collection", "qdrant_copy_collection", true, {
        sourceCollectionName: input.sourceCollectionName,
        targetCollectionName: input.targetCollectionName,
        cause: getErrorMessage(error),
      });
    }
  }

  async countCollection(collectionName: string, vectorBackendId?: string): Promise<number> {
    try {
      return (await (await this.resolveClient(vectorBackendId)).count(collectionName, { exact: true })).count;
    } catch (error) {
      throw new AppException("vector_probe_validation_failed", "Failed to count collection points", "qdrant_count_collection", true, {
        collectionName,
        cause: getErrorMessage(error),
      });
    }
  }

  private async resolveClient(vectorBackendId?: string): Promise<QdrantClient> {
    return vectorBackendId ? this.createClientForBackend(vectorBackendId) : this.client;
  }

  private async getPointIdsByFilter(
    collectionName: string,
    filters: { documentId?: string; indexVersionId?: string },
  ): Promise<(string | number)[]> {
    const must: any[] = [];
    if (filters.documentId) {
      must.push({
        key: "documentId",
        match: { value: filters.documentId },
      });
    }
    if (filters.indexVersionId) {
      must.push({
        key: "indexVersionId",
        match: { value: filters.indexVersionId },
      });
    }

    const result = await this.client.query(collectionName, {
      filter: { must },
    });
    const points = result.points;

    return points.map((p) => p.id as string | number);
  }
}
