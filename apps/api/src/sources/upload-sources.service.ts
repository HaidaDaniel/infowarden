import { Injectable } from '@nestjs/common';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { AppException } from '../common/app-error';
import { UploadSourceDto } from './dto/upload-source.dto';
import {
  ManagedUploadArtifact,
  ManagedUploadStorageService,
  UploadedManagedFile,
} from './managed-upload-storage.service';
import { ManagedUploadSourceMetadata, SourcesService } from './sources.service';

@Injectable()
export class UploadSourcesService {
  constructor(
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly sourcesService: SourcesService,
    private readonly uploadStorage: ManagedUploadStorageService,
  ) {}

  async createManagedUploadSource(identifier: string, file: UploadedManagedFile, dto: UploadSourceDto) {
    const workspace = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const artifact = await this.uploadStorage.store(file);
    const includeRules = this.parseRules(dto.includeRules, 'includeRules');
    const excludeRules = this.parseRules(dto.excludeRules, 'excludeRules');
    const metadata = this.toSourceMetadata(artifact, dto.sourceName);
    const source = await this.sourcesService.createManagedUploadSource({
      knowledgeBaseId: workspace.id,
      uploadId: artifact.uploadId,
      includeRules,
      excludeRules,
      metadata,
    });

    return {
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        workspaceKind: workspace.workspaceKind,
      },
      upload: {
        id: artifact.uploadId,
        originalFileName: artifact.originalFileName,
        archiveFormat: artifact.archiveFormat,
        sizeBytes: artifact.sizeBytes,
        fileCount: artifact.fileCount,
        contentBytes: artifact.contentBytes,
        uploadedAt: artifact.uploadedAt,
      },
      source,
      next: {
        enqueueIndexing: {
          method: 'POST',
          path: '/jobs/indexing',
          body: {
            knowledgeBaseId: workspace.id,
            sourceId: source.id,
            type: 'scan_source',
          },
        },
      },
    };
  }

  private toSourceMetadata(
    artifact: ManagedUploadArtifact,
    sourceName?: string,
  ): ManagedUploadSourceMetadata & { sourceName?: string } {
    return {
      managed: true,
      uploadId: artifact.uploadId,
      originalFileName: artifact.originalFileName,
      archiveFormat: artifact.archiveFormat,
      storageRoot: artifact.storageRoot,
      originalPath: artifact.originalPath,
      extractedPath: artifact.extractedPath,
      sizeBytes: artifact.sizeBytes,
      fileCount: artifact.fileCount,
      contentBytes: artifact.contentBytes,
      uploadedAt: artifact.uploadedAt,
      cleanupStrategy: 'manual',
      ...(sourceName?.trim() ? { sourceName: sourceName.trim() } : {}),
    };
  }

  private parseRules(raw: string | undefined, fieldName: string): string[] {
    if (!raw?.trim()) {
      return [];
    }

    const value = raw.trim();
    if (value.startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
          return parsed.map((item) => item.trim()).filter(Boolean);
        }
      } catch {
        // Fall through to the structured error below.
      }

      throw new AppException(
        'managed_upload_invalid_rules',
        `${fieldName} must be a JSON string array or comma/newline separated patterns`,
        'managed_upload_create_source',
        false,
        { fieldName },
      );
    }

    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
