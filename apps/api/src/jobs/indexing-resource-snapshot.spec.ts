import {
  actualIndexingResourceSnapshot,
  estimateIndexingResources,
} from './indexing-resource-snapshot';

describe('indexing resource snapshot', () => {
  it('estimates at least one chunk while preserving document count', () => {
    expect(
      estimateIndexingResources({
        files: 0,
        embeddingDimension: 384,
        storageProfile: 'low_memory',
      }),
    ).toMatchObject({
      storageProfile: 'low_memory',
      estimatedDocuments: 0,
      estimatedChunks: 1,
      embeddingDimension: 384,
      rawVectorBytes: 1536,
      qdrantDiskBytesLow: 2458,
      qdrantDiskBytesHigh: 3686,
    });
  });

  it('captures observed chunk/vector counts with the same byte model', () => {
    expect(
      actualIndexingResourceSnapshot({
        storageProfile: 'balanced',
        embeddingDimension: 3,
        chunks: 2,
        vectorsUpserted: 2,
      }),
    ).toMatchObject({
      storageProfile: 'balanced',
      chunks: 2,
      vectorsUpserted: 2,
      embeddingDimension: 3,
      rawVectorBytes: 24,
      qdrantDiskBytesLow: 38,
      qdrantDiskBytesHigh: 58,
    });
  });
});
