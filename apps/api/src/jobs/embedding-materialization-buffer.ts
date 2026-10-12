import { AppException } from '../common/app-error';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { RuntimeEmbeddingProviderConfig } from '../providers/providers.service';
import { QdrantAdapter, VectorPayload } from '../vector-index/qdrant.adapter';
import { RollbackDocumentState } from './indexing-rollback';

export type PendingEmbeddingVector = {
  text: string;
  payload: VectorPayload;
  rollbackState: RollbackDocumentState;
};

export class EmbeddingMaterializationBuffer {
  private readonly pending: PendingEmbeddingVector[] = [];

  constructor(
    private readonly params: {
      collectionName: string;
      vectorBackendId?: string;
      embeddingProvider: RuntimeEmbeddingProviderConfig;
      embeddingsService: EmbeddingsService;
      qdrantAdapter: QdrantAdapter;
      batchSize: number;
      onVectorsUpserted: (count: number) => void;
    },
  ) {}

  async add(entries: PendingEmbeddingVector[]): Promise<void> {
    this.pending.push(...entries);
    while (this.pending.length >= this.params.batchSize) {
      await this.flush(this.params.batchSize);
    }
  }

  async flushAll(): Promise<void> {
    await this.flush(this.pending.length);
  }

  private async flush(limit: number): Promise<void> {
    if (this.pending.length === 0 || limit <= 0) {
      return;
    }

    const entries = this.pending.splice(0, limit);
    const vectors = await this.params.embeddingsService.embedTexts(
      entries.map((entry) => entry.text),
      this.params.embeddingProvider,
    );
    if (vectors.length !== entries.length) {
      throw new AppException(
        'embedding_batch_result_mismatch',
        `Embedding provider returned ${vectors.length} vectors for ${entries.length} buffered chunks`,
        'embedding_batch_materialization',
        true,
        {
          expectedVectors: entries.length,
          actualVectors: vectors.length,
          batchSize: entries.length,
          providerSource: this.params.embeddingProvider.source,
          providerConfigId: this.params.embeddingProvider.providerConfigId,
          model: this.params.embeddingProvider.model,
        },
      );
    }

    await this.params.qdrantAdapter.upsertVectors(
      this.params.collectionName,
      vectors,
      entries.map((entry) => entry.payload),
      this.params.vectorBackendId,
    );
    for (const entry of entries) {
      entry.rollbackState.qdrantMutated = true;
    }
    this.params.onVectorsUpserted(vectors.length);
  }
}

export function resolveEmbeddingBatchSize(): number {
  const parsed = Number.parseInt(process.env.INDEXING_EMBEDDING_BATCH_SIZE || '4', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 256) : 4;
}
