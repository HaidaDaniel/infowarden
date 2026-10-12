import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChunkingService } from '../chunking/chunking.service';
import {
  FIXED_CHAR_CHUNKER_VERSION,
  STRUCTURE_AWARE_CHUNKER_COMPATIBILITY_HASH,
  STRUCTURE_AWARE_CHUNKER_VERSION,
} from '../chunking/structure-aware.chunker';
import { VectorPayload } from '../vector-index/qdrant.adapter';
import {
  ChunkMaterializationResult,
  ObsidianRuntimeMetadata,
  ParsedFileForIndex,
  SourceRuntimeMetadata,
  UploadRuntimeMetadata,
  UrlRuntimeMetadata,
} from './indexing.types';
import {
  normalizeStorageProfile,
  qdrantOptionsForStorageProfile,
  StorageProfile,
} from '../vector-index/storage-profile';
import {
  PreparedServingBuild,
  WorkspaceServingRevisionsService,
} from './workspace-serving-revisions.service';

const CHUNKING_CONFIG = {
  strategy: 'structure_aware' as const,
  version: STRUCTURE_AWARE_CHUNKER_VERSION,
  compatibilityHash: STRUCTURE_AWARE_CHUNKER_COMPATIBILITY_HASH,
  fallbackStrategy: 'fixed_char' as const,
  fallbackVersion: FIXED_CHAR_CHUNKER_VERSION,
  maxChars: 3000,
  overlapChars: 300,
};

@Injectable()
export class IndexingMaterializationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chunkingService: ChunkingService,
    private readonly servingRevisionsService: WorkspaceServingRevisionsService,
  ) {}

  getChunkingConfig() {
    return CHUNKING_CONFIG;
  }

  async createBuildArtifacts(params: {
    source: {
      id: string;
      uri: string;
    };
    knowledgeBase: {
      id: string;
    };
    scanRoot: string;
    fileCount: number;
    contentBytes: number;
    parsedFiles: ParsedFileForIndex[];
    ignoredFiles: number;
    parseFailures: number;
    gitMetadata?: SourceRuntimeMetadata;
    uploadMetadata?: UploadRuntimeMetadata;
    urlMetadata?: UrlRuntimeMetadata;
    obsidianMetadata?: ObsidianRuntimeMetadata;
    embeddingModel: string;
    embeddingDimension: number;
    embeddingProviderConfig?: Record<string, unknown>;
    collectionName: string;
    storageProfile?: StorageProfile | string;
    resourceEstimate?: Record<string, unknown>;
  }) {
    const storageProfile = normalizeStorageProfile(params.storageProfile);
    const storageConfig = qdrantOptionsForStorageProfile(storageProfile);
    const sourceContentHash = this.hash(
      params.parsedFiles
        .map((item) => `${item.file.relativePath}:${item.parsed.contentHash}`)
        .sort()
        .join('\n'),
    );
    const sourceSnapshot = await this.prisma.sourceSnapshot.create({
      data: {
        sourceId: params.source.id,
        knowledgeBaseId: params.knowledgeBase.id,
        snapshotType: params.urlMetadata
          ? 'url_crawl'
          : params.uploadMetadata
            ? 'upload_batch'
            : params.gitMetadata?.commit
              ? 'git_commit'
              : 'scan',
        ref: params.urlMetadata?.startUrl || params.uploadMetadata?.uploadId || params.gitMetadata?.commit,
        fileCount: params.fileCount,
        contentBytes: params.contentBytes,
        metadata: {
          uri: params.source.uri,
          scanRoot: params.scanRoot,
          parsedFiles: params.parsedFiles.length,
          ignoredFiles: params.ignoredFiles,
          parseFailures: params.parseFailures,
          materializationMode: 'mutable_collection',
          storageProfile,
          storageConfig,
          ...(params.resourceEstimate ? { resourceEstimate: params.resourceEstimate } : {}),
          ...(params.embeddingProviderConfig
            ? { embeddingProvider: params.embeddingProviderConfig }
            : {}),
          ...(params.gitMetadata?.branch ? { branch: params.gitMetadata.branch } : {}),
          ...(params.gitMetadata?.commit ? { commit: params.gitMetadata.commit } : {}),
          ...(params.gitMetadata?.clonePath ? { clonePath: params.gitMetadata.clonePath } : {}),
          ...(params.uploadMetadata
            ? {
                uploadId: params.uploadMetadata.uploadId,
                originalFileName: params.uploadMetadata.originalFileName,
                archiveFormat: params.uploadMetadata.archiveFormat,
                extractedPath: params.uploadMetadata.extractedPath,
              }
            : {}),
          ...(params.urlMetadata
            ? {
                startUrl: params.urlMetadata.startUrl,
                fetchedUrls: params.urlMetadata.fetchedUrls,
                maxPages: params.urlMetadata.maxPages,
                maxBytesPerPage: params.urlMetadata.maxBytesPerPage,
                totalMaxBytes: params.urlMetadata.totalMaxBytes,
                timeoutMs: params.urlMetadata.timeoutMs,
                sameHost: params.urlMetadata.sameHost,
                respectRobots: params.urlMetadata.respectRobots,
              }
            : {}),
          ...(params.obsidianMetadata
            ? {
                sourceType: 'obsidian_vault',
                vaultRoot: params.obsidianMetadata.vaultRoot,
                noteCount: params.obsidianMetadata.noteCount,
              }
            : {}),
        } as Prisma.InputJsonValue,
      },
    });

    const datasetVersion = await this.prisma.datasetVersion.create({
      data: {
        knowledgeBaseId: params.knowledgeBase.id,
        sourceSnapshotIds: [sourceSnapshot.id],
        sourceSnapshots: { connect: [{ id: sourceSnapshot.id }] },
        documentCount: params.parsedFiles.length,
        contentHash: sourceContentHash,
        status: 'building',
      },
    });

    const indexVersion = await this.prisma.indexVersion.create({
      data: {
        knowledgeBaseId: params.knowledgeBase.id,
        datasetVersionId: datasetVersion.id,
        embeddingModel: params.embeddingModel,
        embeddingDimension: params.embeddingDimension,
        chunkingConfig: CHUNKING_CONFIG as any,
        vectorCollectionName: params.collectionName,
        materializationMode: 'mutable_collection',
        storageProfile,
        storageConfig: storageConfig as any,
        lifecycleStatus: 'loading',
        resourceEstimate: (params.resourceEstimate || {}) as any,
        resourceRequested: {
          kind: 'requested',
          storageProfile,
          storageConfig,
          requestedAt: new Date().toISOString(),
        } as any,
        status: 'building',
      },
    });
    let servingBuild: PreparedServingBuild;
    try {
      servingBuild = await this.servingRevisionsService.prepareBuild({
        knowledgeBaseId: params.knowledgeBase.id,
        sourceId: params.source.id,
        sourceSnapshotId: sourceSnapshot.id,
        sourceContentHash,
        documentCount: params.parsedFiles.length,
        indexVersionId: indexVersion.id,
        physicalCollectionName: params.collectionName,
        storageProfile,
        embeddingProfileSnapshot: {
          model: params.embeddingModel,
          dimension: params.embeddingDimension,
          ...(params.embeddingProviderConfig || {}),
        },
        chunkingProfileSnapshot: CHUNKING_CONFIG,
        resourceEstimate: params.resourceEstimate,
        metadata: {
          materializationMode: 'mutable_collection',
          sourceScopedCompatibilityBuild: true,
        },
      });
    } catch (error) {
      await Promise.all([
        this.prisma.datasetVersion.update({
          where: { id: datasetVersion.id },
          data: { status: 'failed' },
        }),
        this.prisma.indexVersion.update({
          where: { id: indexVersion.id },
          data: { status: 'failed', lifecycleStatus: 'failed' },
        }),
      ]);
      throw error;
    }

    return {
      sourceSnapshot,
      datasetVersion,
      indexVersion,
      servingBuild,
    };
  }

  async markDocumentDeleted(documentId: string): Promise<string[]> {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'deleted' },
    });

    // Old revision vectors stay available until the candidate manifest is active.
    // Cleanup is source-revision scoped and runs only after activation.
    return [];
  }

  async materializeDocument(params: {
    sourceId: string;
    sourceSnapshotId: string;
    indexVersionId: string;
    sourceRevisionId: string;
    workspaceServingRevisionId: string;
    indexBuildId: string;
    vectorBackendId?: string;
    item: ParsedFileForIndex;
    sourceRuntimeMetadata?: SourceRuntimeMetadata;
    forceReembed?: boolean;
  }): Promise<ChunkMaterializationResult> {
    const metadata = this.createDocumentMetadata(params.item, params.sourceRuntimeMetadata);
    const metadataJson = metadata as Prisma.InputJsonValue;
    const document = await this.prisma.document.upsert({
      where: { id: params.item.documentId },
      create: {
        id: params.item.documentId,
        sourceId: params.sourceId,
        path: params.item.file.relativePath,
        mimeType: params.item.parsed.mimeType,
        contentHash: params.item.parsed.contentHash,
        metadata: metadataJson,
        status: 'active',
      },
      update: {
        mimeType: params.item.parsed.mimeType,
        contentHash: params.item.parsed.contentHash,
        metadata: metadataJson,
        status: 'active',
      },
    });

    const documentVersion = await this.prisma.documentVersion.create({
      data: {
        documentId: document.id,
        sourceSnapshotId: params.sourceSnapshotId,
        contentHash: params.item.parsed.contentHash,
        normalizedText: params.item.parsed.text,
        textLength: params.item.parsed.text.length,
        metadata: metadataJson,
      },
    });

    const plannedChunks = this.chunkingService.chunk(params.item.parsed.text, {
      ...CHUNKING_CONFIG,
      language: params.item.parsed.language,
      mimeType: params.item.parsed.mimeType,
      path: params.item.file.relativePath,
    }).map((chunk) => ({
      chunkId: this.generateChunkId(
        document.id,
        params.sourceRevisionId,
        chunk.stableChunkKey || String(chunk.chunkIndex),
      ),
      text: chunk.text,
      textHash: this.hash(chunk.text),
      tokenCount: chunk.tokenEstimate || 0,
      chunkIndex: chunk.chunkIndex,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      metadata: {
        ...metadata,
        ...((chunk.metadata as Record<string, unknown>) || {}),
        charCount: chunk.charCount,
        stableChunkKey: chunk.stableChunkKey,
        sourceRevisionId: params.sourceRevisionId,
        workspaceServingRevisionId: params.workspaceServingRevisionId,
        indexBuildId: params.indexBuildId,
        parserVersion: 'builtin-parser-v1',
        chunkerVersion: chunk.chunkerVersion || FIXED_CHAR_CHUNKER_VERSION,
        chunkerCompatibilityHash:
          chunk.compatibilityHash || STRUCTURE_AWARE_CHUNKER_COMPATIBILITY_HASH,
        contentHash: this.hash(chunk.text),
        payloadSchemaVersion: 'qdrant-chunk-payload-v2',
      },
    }));

    const vectorsToUpsert: ChunkMaterializationResult['vectorsToUpsert'] = [];
    const payloadOnlyUpdates: ChunkMaterializationResult['payloadOnlyUpdates'] = [];

    for (const plannedChunk of plannedChunks) {
      const chunkRecord = await this.prisma.chunk.upsert({
        where: { id: plannedChunk.chunkId },
        create: {
          id: plannedChunk.chunkId,
          documentId: document.id,
          indexVersionId: params.indexVersionId,
          sourceRevisionId: params.sourceRevisionId,
          text: plannedChunk.text,
          textHash: plannedChunk.textHash,
          tokenCount: plannedChunk.tokenCount,
          chunkIndex: plannedChunk.chunkIndex,
          startLine: plannedChunk.startLine,
          endLine: plannedChunk.endLine,
          metadata: plannedChunk.metadata as Prisma.InputJsonValue,
        },
        update: {
          indexVersionId: params.indexVersionId,
          sourceRevisionId: params.sourceRevisionId,
          text: plannedChunk.text,
          textHash: plannedChunk.textHash,
          tokenCount: plannedChunk.tokenCount,
          startLine: plannedChunk.startLine,
          endLine: plannedChunk.endLine,
          metadata: plannedChunk.metadata as Prisma.InputJsonValue,
        },
      });

      await this.prisma.chunkVersion.create({
        data: {
          chunkId: chunkRecord.id,
          documentVersionId: documentVersion.id,
          indexVersionId: params.indexVersionId,
          textHash: plannedChunk.textHash,
          tokenCount: plannedChunk.tokenCount,
          metadata: {
            ...metadata,
            ...plannedChunk.metadata,
            chunkIndex: plannedChunk.chunkIndex,
          } as Prisma.InputJsonValue,
        },
      });

      const payload = this.toVectorPayload(
        chunkRecord.id,
        document.id,
        params.sourceId,
        params.indexVersionId,
        params.sourceRevisionId,
        params.workspaceServingRevisionId,
        params.indexBuildId,
        params.vectorBackendId,
        plannedChunk,
      );

      // A new source revision gets distinct Qdrant point IDs. Re-embedding only
      // this source is deliberate: old points must remain queryable until the
      // complete candidate manifest is activated.
      vectorsToUpsert.push({
        text: plannedChunk.text,
        payload,
      });
    }

    return {
      documentId: document.id,
      vectorsToUpsert,
      payloadOnlyUpdates,
      removedChunkIds: [],
      chunkCount: plannedChunks.length,
    };
  }

  private createDocumentMetadata(
    item: ParsedFileForIndex,
    sourceRuntimeMetadata?: SourceRuntimeMetadata,
  ): Record<string, unknown> {
    return {
      path: item.file.relativePath,
      size: item.file.size,
      mtime: item.file.mtime.toISOString(),
      language: item.parsed.language,
      dependencyRefs: item.parsed.dependencyRefs || [],
      ...((item.parsed.metadata as Record<string, unknown>) || {}),
      ...(item.parsed.warnings?.length
        ? {
            extractionWarnings: item.parsed.warnings.map((warning) => ({
              code: warning.code,
              severity: warning.severity,
              message: warning.message,
              metadata: warning.metadata || {},
            })),
          }
        : {}),
      ...((item.file.metadata as Record<string, unknown>) || {}),
      ...(sourceRuntimeMetadata?.branch ? { branch: sourceRuntimeMetadata.branch } : {}),
      ...(sourceRuntimeMetadata?.commit ? { commit: sourceRuntimeMetadata.commit } : {}),
      ...(sourceRuntimeMetadata?.uploadId ? { uploadId: sourceRuntimeMetadata.uploadId } : {}),
      ...(sourceRuntimeMetadata?.originalFileName
        ? { originalFileName: sourceRuntimeMetadata.originalFileName }
        : {}),
      ...(sourceRuntimeMetadata?.archiveFormat
        ? { archiveFormat: sourceRuntimeMetadata.archiveFormat }
        : {}),
      ...(sourceRuntimeMetadata?.vaultRoot ? { vaultRoot: sourceRuntimeMetadata.vaultRoot } : {}),
      ...(sourceRuntimeMetadata?.sourceType ? { sourceType: sourceRuntimeMetadata.sourceType } : {}),
    };
  }

  private toVectorPayload(
    chunkId: string,
    documentId: string,
    sourceId: string,
    indexVersionId: string,
    sourceRevisionId: string,
    workspaceServingRevisionId: string,
    indexBuildId: string,
    vectorBackendId: string | undefined,
    plannedChunk: {
      text: string;
      tokenCount: number;
      chunkIndex: number;
      startLine?: number;
      endLine?: number;
      metadata: Record<string, unknown>;
    },
  ): VectorPayload {
    return {
      documentId,
      chunkId,
      indexVersionId,
      sourceRevisionId,
      workspaceServingRevisionId,
      indexBuildId,
      parserVersion: 'builtin-parser-v1',
      chunkerVersion: String(
        plannedChunk.metadata.chunkerVersion || FIXED_CHAR_CHUNKER_VERSION,
      ),
      contentHash: this.hash(plannedChunk.text),
      payloadSchemaVersion: 'qdrant-chunk-payload-v2',
      vectorBackendId,
      vectorPointId: this.vectorPointId(sourceRevisionId, chunkId),
      text: plannedChunk.text,
      tokenCount: plannedChunk.tokenCount,
      chunkIndex: plannedChunk.chunkIndex,
      startLine: plannedChunk.startLine,
      endLine: plannedChunk.endLine,
      metadata: {
        sourceId,
        ...plannedChunk.metadata,
      },
    };
  }

  private generateChunkId(documentId: string, sourceRevisionId: string, chunkKey: string): string {
    return this.formatUuid(this.hash(`${documentId}:${sourceRevisionId}:${chunkKey}`));
  }

  private vectorPointId(sourceRevisionId: string, chunkId: string): string {
    return this.formatUuid(this.hash(`${sourceRevisionId}:${chunkId}`));
  }

  private hash(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  }

  private formatUuid(hex: string): string {
    const value = hex.slice(0, 32);
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
  }
}
