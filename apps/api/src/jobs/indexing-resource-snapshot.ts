import { StorageProfile } from '../vector-index/storage-profile';

export type EstimatedResourceInput = {
  files: number;
  embeddingDimension: number;
  storageProfile: StorageProfile;
};

export type ActualResourceInput = {
  storageProfile: StorageProfile;
  embeddingDimension: number;
  chunks: number;
  vectorsUpserted: number;
};

export function estimateIndexingResources(params: EstimatedResourceInput): Record<string, unknown> {
  const estimatedChunks = Math.max(params.files, 1);
  const rawVectorBytes = estimatedChunks * params.embeddingDimension * 4;
  return {
    storageProfile: params.storageProfile,
    estimatedDocuments: params.files,
    estimatedChunks,
    embeddingDimension: params.embeddingDimension,
    rawVectorBytes,
    qdrantDiskBytesLow: Math.round(rawVectorBytes * 1.6),
    qdrantDiskBytesHigh: Math.round(rawVectorBytes * 2.4),
    generatedAt: new Date().toISOString(),
  };
}

export function actualIndexingResourceSnapshot(params: ActualResourceInput): Record<string, unknown> {
  const rawVectorBytes = params.chunks * params.embeddingDimension * 4;
  return {
    storageProfile: params.storageProfile,
    chunks: params.chunks,
    vectorsUpserted: params.vectorsUpserted,
    embeddingDimension: params.embeddingDimension,
    rawVectorBytes,
    qdrantDiskBytesLow: Math.round(rawVectorBytes * 1.6),
    qdrantDiskBytesHigh: Math.round(rawVectorBytes * 2.4),
    capturedAt: new Date().toISOString(),
  };
}
