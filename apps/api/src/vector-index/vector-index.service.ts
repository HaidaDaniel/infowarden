import { Injectable } from '@nestjs/common';
import { QdrantAdapter, VectorPayload, SearchHit, VectorSearchFilters } from './qdrant.adapter';
import { StorageProfile } from './storage-profile';

@Injectable()
export class VectorIndexService {
  constructor(private readonly qdrantAdapter: QdrantAdapter) {}

  async initializeCollection(
    collectionName: string,
    vectorSize: number,
    storageProfile: StorageProfile = 'balanced',
  ): Promise<void> {
    const exists = await this.qdrantAdapter.collectionExists(collectionName);
    if (!exists) {
      await this.qdrantAdapter.createCollection(collectionName, vectorSize, 'Cosine', {
        storageProfile,
      });
    }
  }

  async upsert(collectionName: string, vectors: number[][], payloads: VectorPayload[]): Promise<void> {
    await this.qdrantAdapter.upsertVectors(collectionName, vectors, payloads);
  }

  async deleteByDocumentId(collectionName: string, documentId: string): Promise<void> {
    await this.qdrantAdapter.deleteByDocumentId(collectionName, documentId);
  }

  async deleteByIndexVersionId(collectionName: string, indexVersionId: string): Promise<void> {
    await this.qdrantAdapter.deleteByIndexVersionId(collectionName, indexVersionId);
  }

  async search(
    collectionName: string,
    queryVector: number[],
    limit: number = 10,
    scoreThreshold?: number,
    filters?: VectorSearchFilters,
    vectorBackendId?: string,
  ): Promise<SearchHit[]> {
    return this.qdrantAdapter.search(collectionName, queryVector, limit, scoreThreshold, filters, vectorBackendId);
  }

  async deleteCollection(collectionName: string, vectorBackendId?: string): Promise<void> {
    await this.qdrantAdapter.deleteCollection(collectionName, vectorBackendId);
  }

  async getCollectionInfo(collectionName: string, vectorBackendId?: string) {
    return this.qdrantAdapter.getCollectionInfo(collectionName, vectorBackendId);
  }
}
