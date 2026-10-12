import { QdrantAdapter } from './qdrant.adapter';
import { AppException } from '../common/app-error';

describe('QdrantAdapter', () => {
  it('surfaces vector delete failures instead of swallowing them', async () => {
    const adapter = Object.create(QdrantAdapter.prototype) as QdrantAdapter;
    (adapter as any).client = {
      query: jest.fn().mockResolvedValue({ points: [{ id: 'point-1' }] }),
      delete: jest.fn().mockRejectedValue(new Error('qdrant down')),
    };

    await expect(adapter.deleteByDocumentId('collection-1', 'doc-1')).rejects.toBeInstanceOf(AppException);
    await expect(adapter.deleteByDocumentId('collection-1', 'doc-1')).rejects.toMatchObject({
      code: 'vector_delete_failed',
      stage: 'qdrant_delete_document_vectors',
    });
  });

  it('updates payloads without requiring vector re-upserts', async () => {
    const adapter = Object.create(QdrantAdapter.prototype) as QdrantAdapter;
    (adapter as any).client = {
      overwritePayload: jest.fn().mockResolvedValue(undefined),
    };

    await adapter.setPayloads('collection-1', [
      {
        chunkId: 'chunk-1',
        payload: {
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          indexVersionId: 'index-1',
          text: 'hello',
          tokenCount: 2,
          chunkIndex: 0,
          metadata: { path: 'README.md' },
        },
      },
    ]);

    expect((adapter as any).client.overwritePayload).toHaveBeenCalledWith('collection-1', {
      points: ['chunk-1'],
      payload: expect.objectContaining({
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        indexVersionId: 'index-1',
      }),
      wait: true,
    });
  });

  it('creates low-memory collections with on-disk vectors and scalar quantization', async () => {
    const adapter = Object.create(QdrantAdapter.prototype) as QdrantAdapter;
    (adapter as any).client = {
      createCollection: jest.fn().mockResolvedValue(undefined),
      createPayloadIndex: jest.fn().mockResolvedValue(undefined),
    };

    await adapter.createCollection('collection-1', 384, 'Cosine', { storageProfile: 'low_memory' });

    expect((adapter as any).client.createCollection).toHaveBeenCalledWith(
      'collection-1',
      expect.objectContaining({
        vectors: expect.objectContaining({
          size: 384,
          distance: 'Cosine',
          on_disk: true,
        }),
        on_disk_payload: true,
        hnsw_config: { on_disk: true },
        quantization_config: {
          scalar: {
            type: 'int8',
            quantile: 0.99,
            always_ram: false,
          },
        },
      }),
    );
    expect((adapter as any).client.createPayloadIndex).toHaveBeenCalledWith('collection-1', {
      field_name: 'sourceRevisionId',
      field_schema: 'keyword',
      wait: true,
    });
  });

  it('keeps revision-tagged vector points distinct and deletes cleanup candidates by revision', async () => {
    const adapter = Object.create(QdrantAdapter.prototype) as QdrantAdapter;
    (adapter as any).client = {
      upsert: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ points: [{ id: 'point-old-b' }] }),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    await adapter.upsertVectors('collection-1', [[0.1, 0.2]], [{
      documentId: 'doc-1', chunkId: 'chunk-1', indexVersionId: 'index-b2',
      sourceRevisionId: 'revision-b2', workspaceServingRevisionId: 'serving-b2',
      indexBuildId: 'build-b2', contentHash: 'hash-b2', vectorPointId: 'point-b2',
    }]);
    await adapter.deleteBySourceRevisionId('collection-1', 'revision-b1');

    expect((adapter as any).client.upsert).toHaveBeenCalledWith('collection-1', {
      points: [expect.objectContaining({ id: 'point-b2', payload: expect.objectContaining({
        sourceRevisionId: 'revision-b2', workspaceServingRevisionId: 'serving-b2',
        indexBuildId: 'build-b2', contentHash: 'hash-b2',
      }) })],
      wait: true,
    });
    expect((adapter as any).client.delete).toHaveBeenCalledWith('collection-1', {
      points: ['point-old-b'],
    });
  });

  it('retries transient Qdrant upsert failures before surfacing an error', async () => {
    const adapter = Object.create(QdrantAdapter.prototype) as QdrantAdapter;
    (adapter as any).client = {
      upsert: jest.fn()
        .mockRejectedValueOnce(new Error('Internal Server Error'))
        .mockResolvedValueOnce(undefined),
    };
    (adapter as any).sleep = jest.fn().mockResolvedValue(undefined);
    const previousAttempts = process.env.QDRANT_UPSERT_ATTEMPTS;
    process.env.QDRANT_UPSERT_ATTEMPTS = '2';

    try {
      await adapter.upsertVectors('collection-1', [[0.1, 0.2]], [{
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        indexVersionId: 'index-1',
      }]);
    } finally {
      if (previousAttempts === undefined) {
        delete process.env.QDRANT_UPSERT_ATTEMPTS;
      } else {
        process.env.QDRANT_UPSERT_ATTEMPTS = previousAttempts;
      }
    }

    expect((adapter as any).client.upsert).toHaveBeenCalledTimes(2);
    expect((adapter as any).sleep).toHaveBeenCalledWith(250);
  });

  it('switches a collection alias atomically and is idempotent at its target', async () => {
    const adapter = Object.create(QdrantAdapter.prototype) as QdrantAdapter;
    (adapter as any).client = {
      getAliases: jest.fn().mockResolvedValue({
        aliases: [{ alias_name: 'workspace-docs', collection_name: 'blue' }],
      }),
      updateCollectionAliases: jest.fn().mockResolvedValue(undefined),
    };

    await adapter.switchCollectionAlias('workspace-docs', 'green');

    expect((adapter as any).client.updateCollectionAliases).toHaveBeenCalledWith({
      actions: [
        { delete_alias: { alias_name: 'workspace-docs' } },
        { create_alias: { alias_name: 'workspace-docs', collection_name: 'green' } },
      ],
    });

    (adapter as any).client.getAliases.mockResolvedValue({
      aliases: [{ alias_name: 'workspace-docs', collection_name: 'green' }],
    });
    await adapter.switchCollectionAlias('workspace-docs', 'green');
    expect((adapter as any).client.updateCollectionAliases).toHaveBeenCalledTimes(1);
  });

  it('retries transient collection alias switch failures', async () => {
    const previousAttempts = process.env.QDRANT_ALIAS_SWITCH_ATTEMPTS;
    process.env.QDRANT_ALIAS_SWITCH_ATTEMPTS = '3';
    const adapter = Object.create(QdrantAdapter.prototype) as QdrantAdapter;
    (adapter as any).sleep = jest.fn().mockResolvedValue(undefined);
    (adapter as any).client = {
      getAliases: jest.fn().mockResolvedValue({
        aliases: [{ alias_name: 'workspace-docs', collection_name: 'blue' }],
      }),
      updateCollectionAliases: jest
        .fn()
        .mockRejectedValueOnce(new Error('Internal Server Error'))
        .mockResolvedValueOnce(undefined),
    };

    try {
      await adapter.switchCollectionAlias('workspace-docs', 'green');
    } finally {
      if (previousAttempts === undefined) {
        delete process.env.QDRANT_ALIAS_SWITCH_ATTEMPTS;
      } else {
        process.env.QDRANT_ALIAS_SWITCH_ATTEMPTS = previousAttempts;
      }
    }

    expect((adapter as any).client.updateCollectionAliases).toHaveBeenCalledTimes(2);
    expect((adapter as any).sleep).toHaveBeenCalledWith(250);
  });
});
