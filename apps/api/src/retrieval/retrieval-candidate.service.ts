import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/app-error';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RuntimeEmbeddingProviderConfig } from '../providers/providers.service';
import { SearchHit, VectorSearchFilters } from '../vector-index/qdrant.adapter';
import { VectorIndexService } from '../vector-index/vector-index.service';
import {
  BM25F_WEIGHT_GRID,
  buildBm25Statistics,
  buildBm25fStatistics,
  scoreBm25,
  scoreBm25f,
  type Bm25Document,
  type Bm25fDocument,
} from './bm25';
import {
  resolveCandidateStrategy,
  resolveLexicalStrategy,
  type LexicalCandidateRow,
  type ResolvedRetrievalProfile,
  type ResolvedServingContext,
} from './retrieval-internal.types';
import type { SearchRequest } from './retrieval.types';

const DEFAULT_LEXICAL_TOP_K = 10;
const HARD_LEXICAL_TOP_K = 50;
const MAX_LEXICAL_TERMS = 8;

@Injectable()
export class RetrievalCandidateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly vectorIndexService: VectorIndexService,
  ) {}

  async retrieveDenseCandidates(
    knowledgeBase: { id: string; defaultIndexProfile?: string | null },
    indexVersion: { vectorCollectionName: string; embeddingModel?: string; embeddingDimension?: number },
    request: SearchRequest,
    profile: ResolvedRetrievalProfile,
    serving: ResolvedServingContext,
  ): Promise<SearchHit[]> {
    const embeddingProvider = await this.embeddingsService.resolveProvider({
      knowledgeBase,
      retrievalProfile: profile,
      indexVersion,
      purpose: 'retrieval',
    });
    this.assertProviderCompatible(embeddingProvider);
    const queryVector = (await this.embeddingsService.embedTexts([request.query], embeddingProvider))[0];
    const limit = this.resolveLimit(request, profile);
    const scoreThreshold = request.scoreThreshold ?? profile.scoreThreshold;
    const hits = await this.vectorIndexService.search(
      serving.collectionName,
      queryVector,
      limit,
      scoreThreshold,
      { ...request.filters, sourceRevisionIds: serving.sourceRevisionIds },
      serving.vectorBackendId,
    );
    return hits.filter(
      (hit) => !hit.payload.sourceRevisionId || serving.sourceRevisionIds.includes(hit.payload.sourceRevisionId),
    );
  }

  async retrieveLexicalCandidates(
    knowledgeBase: { id: string },
    request: SearchRequest,
    profile: ResolvedRetrievalProfile,
    serving: ResolvedServingContext,
  ): Promise<SearchHit[]> {
    const settings = this.resolveHybridSettings(profile.metadata);
    const lexicalStrategy = resolveLexicalStrategy(profile.metadata);
    if (!settings.lexicalEnabled) return [];
    const terms = this.lexicalTerms(request.query);
    if (terms.length === 0) return [];
    if (lexicalStrategy === 'bm25') {
      return this.retrieveBm25Candidates(knowledgeBase, request, profile, serving);
    }
    if (lexicalStrategy === 'bm25f') {
      return this.retrieveBm25fCandidates(knowledgeBase, request, profile, serving);
    }

    const rawQuery = request.query.trim().slice(0, 200);
    const tsQuery = rawQuery || terms.join(' ');
    const pathPredicates = terms.map((term) => {
      const pattern = `%${term}%`;
      return Prisma.sql`d."path" ILIKE ${pattern} OR c."metadata"->>'path' ILIKE ${pattern}`;
    });
    const identifierPredicates = terms.map(
      (term) => Prisma.sql`c."id" = ${term} OR c."documentId" = ${term} OR c."textHash" = ${term}`,
    );
    const lexicalPredicate =
      lexicalStrategy === 'pg-fts'
        ? Prisma.sql`c."lexicalSearch" @@ plainto_tsquery('simple', ${tsQuery})`
        : Prisma.sql`
            c."lexicalSearch" @@ plainto_tsquery('simple', ${tsQuery})
            OR ${Prisma.join([...pathPredicates, ...identifierPredicates], ' OR ')}
          `;
    const scoreExpression =
      lexicalStrategy === 'pg-fts'
        ? Prisma.sql`ts_rank_cd(c."lexicalSearch", plainto_tsquery('simple', ${tsQuery}))::double precision`
        : Prisma.sql`(
            ts_rank_cd(c."lexicalSearch", plainto_tsquery('simple', ${tsQuery})) * 10
            + similarity(d."path", ${rawQuery}) * 3
            + similarity(coalesce(c."metadata"->>'path', ''), ${rawQuery}) * 2
            + CASE WHEN lower(d."path") = lower(${rawQuery}) THEN 6 ELSE 0 END
            + CASE WHEN d."path" ILIKE ${`${rawQuery}%`} THEN 2 ELSE 0 END
          )::double precision`;
    const rows = await this.prisma.$queryRaw<LexicalCandidateRow[]>(Prisma.sql`
      SELECT
        c."id",
        ${scoreExpression} AS "score",
        c."documentId",
        c."indexVersionId",
        c."sourceRevisionId",
        c."text",
        c."tokenCount",
        c."chunkIndex",
        c."startLine",
        c."endLine",
        c."metadata" AS "chunkMetadata",
        d."path" AS "documentPath",
        d."metadata" AS "documentMetadata"
      FROM "Chunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      JOIN "Source" s ON s."id" = d."sourceId"
      WHERE s."knowledgeBaseId" = ${knowledgeBase.id}
        AND d."status" = 'active'
        AND c."sourceRevisionId" = ANY(${serving.sourceRevisionIds}::text[])
        AND (${lexicalPredicate})
        ${this.lexicalFilterSql(request.filters)}
      ORDER BY "score" DESC, c."chunkIndex" ASC
      LIMIT ${settings.lexicalTopK}
    `);
    const chunksById = new Map<string, SearchHit>();
    for (const chunk of rows) {
      const metadata = {
        ...((chunk.documentMetadata as Record<string, unknown> | undefined) || {}),
        ...((chunk.chunkMetadata as Record<string, unknown>) || {}),
        path: chunk.documentPath,
        ...(chunk.sourceRevisionId ? { sourceRevisionId: chunk.sourceRevisionId } : {}),
      };
      const score =
        lexicalStrategy === 'structured' ? this.scoreLexicalCandidate(request.query, terms, chunk.text, metadata) : 0;
      const combinedScore = Math.max(Number(chunk.score) || 0, 0) + score;
      if (combinedScore <= 0 || !this.matchesMetadataFilters(metadata, request.filters)) continue;
      chunksById.set(chunk.id, {
        id: chunk.id,
        score: combinedScore,
        payload: {
          documentId: chunk.documentId,
          chunkId: chunk.id,
          indexVersionId: chunk.indexVersionId,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine ?? undefined,
          endLine: chunk.endLine ?? undefined,
          metadata: this.withRetrievalSource(metadata, 'lexical', {
            lexicalScore: combinedScore,
            lexicalStrategy,
          }),
        },
      });
    }
    return Array.from(chunksById.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, settings.lexicalTopK);
  }

  private resolveLimit(request: SearchRequest, profile: ResolvedRetrievalProfile): number {
    const requested = request.topK ?? request.limit ?? profile.denseTopK ?? 10;
    return Math.min(Math.max(requested, 1), 50);
  }

  private async retrieveBm25Candidates(
    knowledgeBase: { id: string },
    request: SearchRequest,
    profile: ResolvedRetrievalProfile,
    serving: ResolvedServingContext,
  ): Promise<SearchHit[]> {
    const rows = await this.loadCanonicalLexicalRows(knowledgeBase, serving);
    const documents: Bm25Document[] = rows.map((row) => ({
      id: row.id,
      text: row.text,
      tokenCount: Number(row.tokenCount) || 0,
    }));
    const statistics = buildBm25Statistics(documents);
    const k1 = this.numberValue(profile.metadata.bm25K1) || 1.2;
    const b = this.numberValue(profile.metadata.bm25B) ?? 0.75;
    return rows
      .map((row, index) => {
        const metadata = {
          ...((row.documentMetadata as Record<string, unknown> | undefined) || {}),
          ...((row.chunkMetadata as Record<string, unknown>) || {}),
          path: row.documentPath,
          ...(row.sourceRevisionId ? { sourceRevisionId: row.sourceRevisionId } : {}),
        };
        const score = scoreBm25(request.query, documents[index], statistics, k1, b);
        return { row, metadata, score };
      })
      .filter(({ metadata, score }) => score > 0 && this.matchesMetadataFilters(metadata, request.filters))
      .sort((a, b) => b.score - a.score || a.row.chunkIndex - b.row.chunkIndex || a.row.id.localeCompare(b.row.id))
      .slice(0, this.resolveHybridSettings(profile.metadata).lexicalTopK)
      .map(({ row, metadata, score }) => ({
        id: row.id,
        score,
        payload: {
          documentId: row.documentId,
          chunkId: row.id,
          indexVersionId: row.indexVersionId,
          text: row.text,
          tokenCount: row.tokenCount,
          chunkIndex: row.chunkIndex,
          startLine: row.startLine ?? undefined,
          endLine: row.endLine ?? undefined,
          metadata: this.withRetrievalSource(metadata, 'lexical', {
            lexicalScore: score,
            lexicalStrategy: 'bm25',
            bm25K1: k1,
            bm25B: b,
          }),
        },
      }));
  }

  private async retrieveBm25fCandidates(
    knowledgeBase: { id: string },
    request: SearchRequest,
    profile: ResolvedRetrievalProfile,
    serving: ResolvedServingContext,
  ): Promise<SearchHit[]> {
    const rows = await this.loadCanonicalLexicalRows(knowledgeBase, serving);
    const documents: Bm25fDocument[] = rows.map((row) => ({
      id: row.id,
      fields: {
        chunkText: row.text,
        pathTitle: [
          row.documentPath,
          String((row.documentMetadata as Record<string, unknown> | null)?.title || ''),
          String((row.documentMetadata as Record<string, unknown> | null)?.heading || ''),
          String((row.chunkMetadata as Record<string, unknown> | null)?.title || ''),
          String((row.chunkMetadata as Record<string, unknown> | null)?.heading || ''),
        ]
          .filter(Boolean)
          .join(' '),
        identifierMetadata: this.identifierMetadataText(row),
      },
    }));
    const statistics = buildBm25fStatistics(documents);
    const weights = this.bm25fWeights(profile.metadata);
    return rows
      .map((row, index) => {
        const metadata = {
          ...((row.documentMetadata as Record<string, unknown> | undefined) || {}),
          ...((row.chunkMetadata as Record<string, unknown>) || {}),
          path: row.documentPath,
          ...(row.sourceRevisionId ? { sourceRevisionId: row.sourceRevisionId } : {}),
        };
        const score = scoreBm25f(request.query, documents[index], statistics, weights);
        return { row, metadata, score };
      })
      .filter(({ metadata, score }) => score > 0 && this.matchesMetadataFilters(metadata, request.filters))
      .sort((a, b) => b.score - a.score || a.row.chunkIndex - b.row.chunkIndex || a.row.id.localeCompare(b.row.id))
      .slice(0, this.resolveHybridSettings(profile.metadata).lexicalTopK)
      .map(({ row, metadata, score }) => ({
        id: row.id,
        score,
        payload: {
          documentId: row.documentId,
          chunkId: row.id,
          indexVersionId: row.indexVersionId,
          text: row.text,
          tokenCount: row.tokenCount,
          chunkIndex: row.chunkIndex,
          startLine: row.startLine ?? undefined,
          endLine: row.endLine ?? undefined,
          metadata: this.withRetrievalSource(metadata, 'lexical', {
            lexicalScore: score,
            lexicalStrategy: 'bm25f',
            bm25fWeightGrid: BM25F_WEIGHT_GRID.map((entry) => entry.id),
          }),
        },
      }));
  }

  private async loadCanonicalLexicalRows(
    knowledgeBase: { id: string },
    serving: ResolvedServingContext,
  ): Promise<LexicalCandidateRow[]> {
    return this.prisma.$queryRaw<LexicalCandidateRow[]>(Prisma.sql`
      SELECT
        c."id",
        c."documentId",
        c."indexVersionId",
        c."sourceRevisionId",
        c."text",
        c."tokenCount",
        c."chunkIndex",
        c."startLine",
        c."endLine",
        c."metadata" AS "chunkMetadata",
        d."path" AS "documentPath",
        d."metadata" AS "documentMetadata"
      FROM "Chunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      JOIN "Source" s ON s."id" = d."sourceId"
      WHERE s."knowledgeBaseId" = ${knowledgeBase.id}
        AND d."status" = 'active'
        AND c."sourceRevisionId" = ANY(${serving.sourceRevisionIds}::text[])
    `);
  }

  private identifierMetadataText(row: LexicalCandidateRow): string {
    const chunk = (row.chunkMetadata as Record<string, unknown> | null) || {};
    const document = (row.documentMetadata as Record<string, unknown> | null) || {};
    return [row.id, row.documentId, chunk.identifier, chunk.name, document.identifier, document.name]
      .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
      .join(' ');
  }

  private bm25fWeights(metadata: Record<string, unknown>) {
    const selectedId = typeof metadata.bm25fWeightGridId === 'string' ? metadata.bm25fWeightGridId : 'balanced';
    return BM25F_WEIGHT_GRID.find((entry) => entry.id === selectedId)?.weights || BM25F_WEIGHT_GRID[0].weights;
  }

  private resolveHybridSettings(metadata: Record<string, unknown>) {
    const lexicalEnabled =
      resolveCandidateStrategy(metadata) === 'lexical' ||
      metadata.lexicalEnabled === true ||
      metadata.hybridSearch === true ||
      metadata.hybridEnabled === true;
    const lexicalTopK = Math.min(
      Math.max(this.numberValue(metadata.lexicalTopK) || DEFAULT_LEXICAL_TOP_K, 1),
      HARD_LEXICAL_TOP_K,
    );
    return { lexicalEnabled, lexicalTopK };
  }

  private lexicalFilterSql(filters?: VectorSearchFilters) {
    const clauses: Prisma.Sql[] = [];
    if (filters?.pathPrefix) {
      const prefix = `${filters.pathPrefix}%`;
      clauses.push(Prisma.sql`(d."path" LIKE ${prefix} OR c."metadata"->>'path' LIKE ${prefix})`);
    }
    if (filters?.language) {
      clauses.push(Prisma.sql`coalesce(c."metadata"->>'language', d."metadata"->>'language') = ${filters.language}`);
    }
    if (filters?.branch) {
      clauses.push(Prisma.sql`coalesce(c."metadata"->>'branch', d."metadata"->>'branch') = ${filters.branch}`);
    }
    for (const [key, value] of Object.entries(filters?.metadata || {})) {
      clauses.push(Prisma.sql`coalesce(c."metadata"->>${key}, d."metadata"->>${key}) = ${String(value)}`);
    }
    return clauses.length ? Prisma.sql`AND ${Prisma.join(clauses, ' AND ')}` : Prisma.empty;
  }

  private assertProviderCompatible(embeddingProvider: RuntimeEmbeddingProviderConfig): void {
    if (!embeddingProvider.reindexRequired) return;
    throw new AppException(
      'embedding_reindex_required',
      embeddingProvider.reindexReason ||
        'Resolved embedding provider differs from the active index version; reindex before retrieval',
      'resolve_retrieval_embedding_provider',
      false,
      {
        providerSource: embeddingProvider.source,
        providerConfigId: embeddingProvider.providerConfigId,
        model: embeddingProvider.model,
        dimension: embeddingProvider.dimension,
        requiredModes: ['force_reembed', 'force_rechunk', 'rebuild_collection'],
      },
    );
  }

  private lexicalTerms(query: string): string[] {
    const raw = query.trim();
    if (!raw) return [];
    const terms = new Set<string>();
    if (raw.length >= 2) terms.add(raw.slice(0, 200));
    for (const match of raw.match(/[A-Za-z0-9_./:-]{2,}/g) || []) {
      terms.add(match.slice(0, 120));
      if (terms.size >= MAX_LEXICAL_TERMS) break;
    }
    return Array.from(terms).slice(0, MAX_LEXICAL_TERMS);
  }

  private scoreLexicalCandidate(
    query: string,
    terms: string[],
    text: string,
    metadata: Record<string, unknown>,
  ): number {
    const lowerText = text.toLowerCase();
    const path = String(metadata.path || '').toLowerCase();
    const title = String(metadata.title || metadata.heading || '').toLowerCase();
    const raw = query.trim().toLowerCase();
    let score = 0;
    if (raw && lowerText.includes(raw)) score += 4;
    if (raw && path.includes(raw)) score += 5;
    if (raw && title.includes(raw)) score += 5;
    for (const term of terms) {
      const lowerTerm = term.toLowerCase();
      if (lowerText.includes(lowerTerm)) score += /[_./:-]/.test(term) ? 2 : 1;
      if (path.includes(lowerTerm)) score += 3;
      if (title.includes(lowerTerm)) score += 3;
    }
    return Math.min(score / 10, 1);
  }

  private matchesMetadataFilters(metadata: Record<string, unknown>, filters?: VectorSearchFilters): boolean {
    if (!filters) return true;
    if (filters.pathPrefix && !String(metadata.path || '').startsWith(filters.pathPrefix)) return false;
    if (filters.language && metadata.language !== filters.language) return false;
    if (filters.branch && metadata.branch !== filters.branch) return false;
    for (const [key, value] of Object.entries(filters.metadata || {})) {
      if (metadata[key] !== value) return false;
    }
    return true;
  }

  private withRetrievalSource(
    metadata: Record<string, unknown>,
    source: 'dense' | 'lexical',
    scores: Record<string, unknown>,
  ): Record<string, unknown> {
    const existingSources = Array.isArray(metadata.retrievalSources) ? metadata.retrievalSources.map(String) : [];
    return { ...metadata, ...scores, retrievalSources: Array.from(new Set([...existingSources, source])) };
  }

  private numberValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }
}
