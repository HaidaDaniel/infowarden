import { Document, WorkspaceKind } from '@prisma/client';
import { FileEntry } from '../ingestion/local-folder.scanner';
import { ParsedDocument } from '../ingestion/text-code.parser';

export type GitRuntimeMetadata = {
  branch: string;
  commit: string;
  clonePath: string;
};

export type UploadRuntimeMetadata = {
  uploadId: string;
  originalFileName: string;
  archiveFormat: 'single_file' | 'zip';
  extractedPath: string;
};

export type UrlRuntimeMetadata = {
  startUrl: string;
  fetchedUrls: string[];
  maxPages: number;
  maxBytesPerPage: number;
  totalMaxBytes: number;
  timeoutMs: number;
  sameHost: boolean;
  respectRobots: boolean;
};

export type ObsidianRuntimeMetadata = {
  vaultRoot: string;
  noteCount: number;
};

export type SourceRuntimeMetadata = {
  branch?: string;
  commit?: string;
  clonePath?: string;
  uploadId?: string;
  originalFileName?: string;
  archiveFormat?: 'single_file' | 'zip';
  extractedPath?: string;
  startUrl?: string;
  sourceUrl?: string;
  finalUrl?: string;
  contentType?: string;
  maxPages?: number;
  maxBytesPerPage?: number;
  totalMaxBytes?: number;
  timeoutMs?: number;
  sameHost?: boolean;
  respectRobots?: boolean;
  vaultRoot?: string;
  sourceType?: string;
};

export type SourceRefreshMode = 'incremental' | 'force_reembed' | 'force_rechunk' | 'rebuild_collection';

export type SourceRefreshRequestContext = {
  mode: SourceRefreshMode;
  reason?: string;
  dryRun?: boolean;
  trigger?: 'manual' | 'schedule' | 'webhook' | 'watch' | 'legacy_job';
  triggerMetadata?: Record<string, unknown>;
};

export interface IndexingStats {
  filesScanned: number;
  filesParsed: number;
  filesIgnored: number;
  parseFailures: number;
  documentsCreated: number;
  documentsChanged: number;
  documentsDeleted: number;
  documentsSkipped: number;
  chunksCreated: number;
  chunksDeleted: number;
  chunksReused: number;
  vectorsUpserted: number;
  vectorsDeleted: number;
  payloadsUpdated: number;
  dependencyCandidates: number;
  added: number;
  changed: number;
  deleted: number;
  unchanged: number;
  validationReportId?: string;
  sourceRevisionId?: string;
  servingRevisionId?: string;
  indexBuildId?: string;
  servingRevisionState?: string;
  refreshMode?: string;
  refreshReason?: string;
  refreshTrigger?: string;
  refreshTriggerMetadata?: Record<string, unknown>;
}

export type LogEntry = {
  level: 'info' | 'warn' | 'error';
  message: string;
  at: string;
  data?: Record<string, unknown>;
};

export type ParsedFileForIndex = {
  file: FileEntry;
  parsed: ParsedDocument;
  documentId: string;
  changeType: 'added' | 'changed' | 'unchanged';
  existingDocument?: Document;
};

export type DeletedDocumentPlan = {
  path: string;
  document: Document;
};

export type DependencyHint = {
  path: string;
  dependsOn: string[];
};

export type IndexingChangePlan = {
  parsedFiles: ParsedFileForIndex[];
  deletedDocuments: DeletedDocumentPlan[];
  dependencyHints: DependencyHint[];
};

export type PreparedSourceContext = {
  scanRoot: string;
  files: FileEntry[];
  gitMetadata?: GitRuntimeMetadata;
  uploadMetadata?: UploadRuntimeMetadata;
  urlMetadata?: UrlRuntimeMetadata;
  obsidianMetadata?: ObsidianRuntimeMetadata;
};

export type ChunkMaterializationResult = {
  documentId: string;
  vectorsToUpsert: Array<{
    text: string;
    payload: {
      documentId: string;
      chunkId: string;
      indexVersionId: string;
      text?: string;
      tokenCount?: number;
      chunkIndex?: number;
      startLine?: number;
      endLine?: number;
      metadata?: Record<string, unknown>;
    };
  }>;
  payloadOnlyUpdates: Array<{
    chunkId: string;
    payload: {
      documentId: string;
      chunkId: string;
      indexVersionId: string;
      text?: string;
      tokenCount?: number;
      chunkIndex?: number;
      startLine?: number;
      endLine?: number;
      metadata?: Record<string, unknown>;
    };
  }>;
  removedChunkIds: string[];
  chunkCount: number;
};

export type DependencyPlannerInput = {
  workspaceKind: WorkspaceKind;
  changedOrDeletedPaths: string[];
  existingDocuments: Document[];
};
