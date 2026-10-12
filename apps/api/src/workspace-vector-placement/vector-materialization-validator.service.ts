import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-error';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { PrismaService } from '../prisma/prisma.service';
import { QdrantAdapter, VectorPayload } from '../vector-index/qdrant.adapter';
import { record, stringValue } from './vector-placement.utils';

@Injectable()
export class VectorMaterializationValidator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qdrantAdapter: QdrantAdapter,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  async validateCanonicalCoverage(
    collectionName: string,
    vectorBackendId: string,
    entries: Array<{
      sourceRevisionId: string;
      sourceRevision: { sourceId: string; documentCount: number };
    }>,
  ) {
    const revisionCoverage = [];
    for (const entry of entries) {
      const [expectedChunks, observedPoints] = await Promise.all([
        this.prisma.chunk.count({
          where: {
            sourceRevisionId: entry.sourceRevisionId,
            document: { status: 'active' },
          },
        }),
        this.qdrantAdapter.countBySourceRevisionId(collectionName, entry.sourceRevisionId, vectorBackendId),
      ]);
      revisionCoverage.push({
        sourceId: entry.sourceRevision.sourceId,
        sourceRevisionId: entry.sourceRevisionId,
        expectedChunks,
        observedPoints,
      });
    }
    const incomplete = revisionCoverage.filter((item) => item.expectedChunks !== item.observedPoints);
    if (incomplete.length > 0) {
      throw new AppException(
        'vector_operation_manifest_coverage_failed',
        'Candidate does not cover every active source revision',
        'build_vector_operation',
        true,
        { revisionCoverage },
      );
    }
    return revisionCoverage;
  }

  async candidateSemanticProbeSummary(input: {
    knowledgeBaseId: string;
    servingRevisionId: string | null;
    collectionName: string;
    vectorBackendId: string;
    indexVersion: {
      id: string;
      embeddingModel: string;
      embeddingDimension: number;
    };
  }) {
    const questions = await this.prisma.evalQuestion.findMany({
      where: { knowledgeBaseId: input.knowledgeBaseId },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    const labeledQuestions = questions
      .filter((question) => question.expectedChunkIds.length > 0 || question.expectedDocumentIds.length > 0)
      .slice(0, 3);
    if (labeledQuestions.length === 0) {
      return {
        checked: 0,
        skipped: true,
        reason: 'no_labeled_eval_questions',
        servingRevisionId: input.servingRevisionId,
        bounded: true,
      };
    }
    const [knowledgeBase, serving] = await Promise.all([
      this.prisma.knowledgeBase.findUnique({
        where: { id: input.knowledgeBaseId },
      }),
      this.prisma.workspaceServingRevision.findUnique({
        where: { id: input.servingRevisionId || '' },
        include: { manifestEntries: { select: { sourceRevisionId: true } } },
      }),
    ]);
    if (!knowledgeBase) {
      throw new AppException(
        'workspace_not_found',
        'Workspace was not found',
        'vector_operation_semantic_probe',
        false,
        { knowledgeBaseId: input.knowledgeBaseId },
      );
    }
    if (!serving || serving.manifestEntries.length === 0) {
      throw new AppException(
        'vector_operation_manifest_missing',
        'Complete active serving manifest is required for semantic candidate probes',
        'vector_operation_semantic_probe',
        false,
        { knowledgeBaseId: input.knowledgeBaseId },
      );
    }
    const provider = await this.embeddingsService.resolveProvider({
      knowledgeBase,
      indexVersion: input.indexVersion,
      purpose: 'retrieval',
    });
    if (
      provider.model !== input.indexVersion.embeddingModel ||
      provider.dimension !== input.indexVersion.embeddingDimension
    ) {
      throw new AppException(
        'vector_operation_semantic_probe_provider_incompatible',
        'Semantic candidate probe provider does not match active index compatibility',
        'vector_operation_semantic_probe',
        false,
        {
          activeModel: input.indexVersion.embeddingModel,
          activeDimension: input.indexVersion.embeddingDimension,
          runtimeModel: provider.model,
          runtimeDimension: provider.dimension,
        },
      );
    }
    const queryVectors = await this.embeddingsService.embedTexts(
      labeledQuestions.map((question) => question.text),
      provider,
    );
    const sourceRevisionIds = serving.manifestEntries.map((entry) => entry.sourceRevisionId);
    const probes = [];
    for (let index = 0; index < labeledQuestions.length; index += 1) {
      const question = labeledQuestions[index];
      const hits = await this.qdrantAdapter.search(
        input.collectionName,
        queryVectors[index],
        5,
        undefined,
        { sourceRevisionIds },
        input.vectorBackendId,
      );
      const matched = hits.some((hit) =>
        this.probeHitMatchesExpected(hit.payload, {
          expectedChunkIds: question.expectedChunkIds,
          expectedDocumentIds: question.expectedDocumentIds,
        }),
      );
      probes.push({
        evalQuestionId: question.id,
        resultCount: hits.length,
        matched,
        topChunkId: hits[0]?.payload.chunkId,
        topDocumentId: hits[0]?.payload.documentId,
      });
      if (!matched) {
        throw new AppException(
          'vector_operation_semantic_probe_failed',
          'Candidate semantic probe did not return the expected labeled result',
          'vector_operation_semantic_probe',
          true,
          {
            evalQuestionId: question.id,
            resultCount: hits.length,
            expectedChunkCount: question.expectedChunkIds.length,
            expectedDocumentCount: question.expectedDocumentIds.length,
            topChunkId: hits[0]?.payload.chunkId,
            topDocumentId: hits[0]?.payload.documentId,
          },
        );
      }
    }
    return {
      checked: labeledQuestions.length,
      passed: probes.every((probe) => probe.matched),
      servingRevisionId: input.servingRevisionId,
      collectionName: input.collectionName,
      vectorBackendId: input.vectorBackendId,
      probes,
      bounded: true,
    };
  }

  private probeHitMatchesExpected(
    payload: VectorPayload,
    expected: { expectedChunkIds: string[]; expectedDocumentIds: string[] },
  ): boolean {
    const metadata = record(payload.metadata);
    const documentLabels = new Set(
      [payload.documentId, stringValue(metadata.path), stringValue(metadata.sourcePath)].filter(
        (value): value is string => Boolean(value),
      ),
    );
    return (
      expected.expectedChunkIds.includes(payload.chunkId) ||
      expected.expectedDocumentIds.some((documentId) => documentLabels.has(documentId))
    );
  }
}
