import { RetrievalCandidateService } from './retrieval-candidate.service';

describe('lexical-bm25f product path', () => {
  it('retrieves path/title and chunk text through the authoritative lexical candidate service', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'chunk-title',
          documentId: 'doc-title',
          indexVersionId: 'index-1',
          sourceRevisionId: 'revision-1',
          text: 'body',
          tokenCount: 1,
          chunkIndex: 0,
          startLine: null,
          endLine: null,
          chunkMetadata: { heading: 'needle' },
          documentPath: 'docs/example.md',
          documentMetadata: {},
        },
        {
          id: 'chunk-body',
          documentId: 'doc-body',
          indexVersionId: 'index-1',
          sourceRevisionId: 'revision-1',
          text: 'needle',
          tokenCount: 1,
          chunkIndex: 0,
          startLine: null,
          endLine: null,
          chunkMetadata: {},
          documentPath: 'docs/other.md',
          documentMetadata: {},
        },
      ]),
    };
    const service = new RetrievalCandidateService(prisma as any, {} as any, {} as any);

    const hits = await service.retrieveLexicalCandidates(
      { id: 'kb-1' },
      { query: 'needle', topK: 5 },
      {
        knowledgeBaseId: 'kb-1',
        key: 'lexical-bm25f',
        name: 'BM25F',
        intent: 'general_search',
        denseTopK: 5,
        lexicalEnabled: true,
        lexicalTopK: 5,
        neighborBefore: 0,
        neighborAfter: 0,
        grouping: 'document',
        recencyBoost: false,
        metadata: { candidateStrategy: 'lexical', lexicalStrategy: 'bm25f' },
      },
      {
        servingRevisionId: 'serving-1',
        sourceRevisionIds: ['revision-1'],
        vectorBackendId: 'lexical-only',
        collectionName: 'lexical-only',
        filterPlacement: 'pre_topk',
      },
    );

    expect(hits).toHaveLength(2);
    expect(hits[0].payload.metadata).toMatchObject({ lexicalStrategy: 'bm25f' });
  });
});
