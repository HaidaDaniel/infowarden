import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SearchHit } from '../vector-index/qdrant.adapter';
import type { ResolvedRetrievalProfile } from './retrieval-internal.types';

const MAX_EXPANDED_NEIGHBORS = 100;
const MAX_NEIGHBORS_PER_DOCUMENT = 24;

@Injectable()
export class RetrievalNeighborExpansionService {
  constructor(private readonly prisma: PrismaService) {}

  async expandIfNeeded(
    hits: SearchHit[],
    profile: ResolvedRetrievalProfile,
  ): Promise<{ hits: SearchHit[]; queryCount: number }> {
    if (profile.neighborBefore <= 0 && profile.neighborAfter <= 0) return { hits, queryCount: 0 };
    const expanded: SearchHit[] = [...hits];
    const seen = new Set(hits.map((hit) => hit.payload.chunkId));
    const hitByChunkId = new Map(hits.filter((hit) => hit.payload.chunkId).map((hit) => [hit.payload.chunkId, hit]));
    const baseChunkIds = Array.from(hitByChunkId.keys());
    if (baseChunkIds.length === 0) return { hits, queryCount: 0 };

    const baseChunks = await this.prisma.chunk.findMany({ where: { id: { in: baseChunkIds } } });
    if (baseChunks.length === 0) return { hits, queryCount: 1 };
    const rangesByDocument = new Map<
      string,
      {
        documentId: string;
        indexVersionId: string;
        min: number;
        max: number;
        sourceRevisionId?: string | null;
      }
    >();
    for (const chunk of baseChunks) {
      const key = `${chunk.documentId}:${chunk.indexVersionId}`;
      const existing = rangesByDocument.get(key);
      const min = chunk.chunkIndex - profile.neighborBefore;
      const max = chunk.chunkIndex + profile.neighborAfter;
      if (!existing) {
        rangesByDocument.set(key, {
          documentId: chunk.documentId,
          indexVersionId: chunk.indexVersionId,
          min,
          max,
          sourceRevisionId: chunk.sourceRevisionId,
        });
      } else {
        existing.min = Math.min(existing.min, min);
        existing.max = Math.max(existing.max, max);
      }
    }
    const neighbors = await this.prisma.chunk.findMany({
      where: {
        OR: Array.from(rangesByDocument.values()).map((range) => ({
          documentId: range.documentId,
          indexVersionId: range.indexVersionId,
          ...(range.sourceRevisionId ? { sourceRevisionId: range.sourceRevisionId } : {}),
          chunkIndex: { gte: range.min, lte: range.max },
        })),
      },
      orderBy: [{ documentId: 'asc' }, { chunkIndex: 'asc' }],
    });
    const perDocumentCount = new Map<string, number>();
    for (const neighbor of neighbors) {
      if (seen.has(neighbor.id)) continue;
      if (expanded.length - hits.length >= MAX_EXPANDED_NEIGHBORS) break;
      const documentCount = perDocumentCount.get(neighbor.documentId) || 0;
      if (documentCount >= MAX_NEIGHBORS_PER_DOCUMENT) continue;
      const nearestHit = this.nearestBaseHit(neighbor, baseChunks, hitByChunkId);
      seen.add(neighbor.id);
      perDocumentCount.set(neighbor.documentId, documentCount + 1);
      expanded.push({
        id: neighbor.id,
        score: (nearestHit?.score || 0.01) * 0.97,
        payload: {
          documentId: neighbor.documentId,
          chunkId: neighbor.id,
          indexVersionId: neighbor.indexVersionId,
          sourceRevisionId: neighbor.sourceRevisionId || undefined,
          text: neighbor.text,
          tokenCount: neighbor.tokenCount,
          chunkIndex: neighbor.chunkIndex,
          startLine: neighbor.startLine ?? undefined,
          endLine: neighbor.endLine ?? undefined,
          metadata: {
            ...((neighbor.metadata as Record<string, unknown>) || {}),
            neighborExpansion: true,
            expandedFromChunkId: nearestHit?.payload.chunkId,
          },
        },
      });
    }
    return { hits: expanded, queryCount: 2 };
  }

  private nearestBaseHit(
    neighbor: { documentId: string; indexVersionId: string; chunkIndex: number },
    baseChunks: Array<{ id: string; documentId: string; indexVersionId: string; chunkIndex: number }>,
    hitByChunkId: Map<string, SearchHit>,
  ): SearchHit | undefined {
    let nearest: { distance: number; hit?: SearchHit } | undefined;
    for (const chunk of baseChunks) {
      if (chunk.documentId !== neighbor.documentId || chunk.indexVersionId !== neighbor.indexVersionId) continue;
      const hit = hitByChunkId.get(chunk.id);
      if (!hit) continue;
      const distance = Math.abs(chunk.chunkIndex - neighbor.chunkIndex);
      if (!nearest || distance < nearest.distance) nearest = { distance, hit };
    }
    return nearest?.hit;
  }
}
