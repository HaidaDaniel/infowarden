import { createHash } from 'crypto';
import { Prisma, WorkspaceVectorPlacementState } from '@prisma/client';
import { VectorPayload } from '../vector-index/qdrant.adapter';

export type CandidateChunk = {
  id: string;
  indexVersionId: string;
  text: string;
  textHash: string;
  tokenCount: number;
  chunkIndex: number;
  startLine: number | null;
  endLine: number | null;
  metadata: Prisma.JsonValue;
  document: {
    id: string;
    sourceId: string;
  };
};

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function offsetValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

export function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function placementState(lifecycleStatus?: string | null) {
  if (lifecycleStatus === 'loaded') return WorkspaceVectorPlacementState.loaded;
  if (lifecycleStatus === 'loading') return WorkspaceVectorPlacementState.loading;
  if (lifecycleStatus === 'partially_loaded') {
    return WorkspaceVectorPlacementState.partially_loaded;
  }
  if (lifecycleStatus === 'degraded') return WorkspaceVectorPlacementState.degraded;
  if (lifecycleStatus === 'failed') return WorkspaceVectorPlacementState.failed;
  return WorkspaceVectorPlacementState.unloaded;
}

export function candidateCollectionName(alias: string, key: string) {
  return `${alias}-candidate-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

export function operationKey(kind: string, placement: { id: string; updatedAt: Date }, targetBackendId: string) {
  return createHash('sha256')
    .update(`${kind}:${placement.id}:${placement.updatedAt.toISOString()}:${targetBackendId}`)
    .digest('hex');
}

export function vectorPointId(sourceRevisionId: string, chunkId: string): string {
  return formatUuid(hash(`${sourceRevisionId}:${chunkId}`));
}

export function hash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function formatUuid(hex: string): string {
  const value = hex.slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export function toVectorPayload(input: {
  chunk: CandidateChunk;
  indexVersionId: string;
  sourceRevisionId: string;
  workspaceServingRevisionId: string;
  indexBuildId?: string;
  vectorBackendId: string;
  sourceId: string;
}): VectorPayload {
  const metadata = record(input.chunk.metadata);
  return {
    documentId: input.chunk.document.id,
    chunkId: input.chunk.id,
    indexVersionId: input.indexVersionId,
    sourceRevisionId: input.sourceRevisionId,
    workspaceServingRevisionId: input.workspaceServingRevisionId,
    indexBuildId: input.indexBuildId,
    parserVersion: stringValue(metadata.parserVersion) || 'builtin-parser-v1',
    chunkerVersion: stringValue(metadata.chunkerVersion) || 'fixed_char-v1',
    contentHash: input.chunk.textHash || hash(input.chunk.text),
    payloadSchemaVersion: stringValue(metadata.payloadSchemaVersion) || 'qdrant-chunk-payload-v2',
    vectorBackendId: input.vectorBackendId,
    vectorPointId: vectorPointId(input.sourceRevisionId, input.chunk.id),
    text: input.chunk.text,
    tokenCount: input.chunk.tokenCount,
    chunkIndex: input.chunk.chunkIndex,
    startLine: input.chunk.startLine ?? undefined,
    endLine: input.chunk.endLine ?? undefined,
    metadata: {
      ...metadata,
      sourceId: input.sourceId,
      sourceRevisionId: input.sourceRevisionId,
      workspaceServingRevisionId: input.workspaceServingRevisionId,
      indexBuildId: input.indexBuildId,
    },
  };
}
