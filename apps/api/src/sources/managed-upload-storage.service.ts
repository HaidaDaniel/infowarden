import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/app-error';
import { ZipArchiveService } from './zip-archive.service';

export type UploadedManagedFile = {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype?: string;
};

export type ManagedUploadArtifact = {
  uploadId: string;
  originalFileName: string;
  archiveFormat: 'single_file' | 'zip';
  storageRoot: string;
  originalPath: string;
  extractedPath: string;
  sizeBytes: number;
  fileCount: number;
  contentBytes: number;
  uploadedAt: string;
};

const DIRECT_UPLOAD_EXTENSIONS = new Set([
  '.bash',
  '.c',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.env',
  '.go',
  '.h',
  '.hpp',
  '.htm',
  '.html',
  '.ipynb',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.log',
  '.markdown',
  '.md',
  '.php',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scala',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]);

@Injectable()
export class ManagedUploadStorageService {
  constructor(
    private readonly configService: ConfigService,
    private readonly zipArchiveService: ZipArchiveService,
  ) {}

  async store(file: UploadedManagedFile): Promise<ManagedUploadArtifact> {
    if (!file?.buffer || !file.originalname) {
      throw new AppException(
        'managed_upload_file_required',
        'A multipart file field named "file" is required',
        'managed_upload_store',
        false,
      );
    }

    const maxArchiveBytes = this.getPositiveConfig(
      'MANAGED_UPLOAD_MAX_ARCHIVE_BYTES',
      50 * 1024 * 1024,
    );
    if (file.size > maxArchiveBytes || file.buffer.length > maxArchiveBytes) {
      throw new AppException(
        'managed_upload_archive_too_large',
        'Uploaded file exceeds the configured max archive size',
        'managed_upload_store',
        false,
        {
          maxArchiveBytes,
          sizeBytes: file.size || file.buffer.length,
        },
      );
    }

    const uploadId = crypto.randomUUID();
    const storageRoot = path.resolve(
      this.configService.get<string>('MANAGED_UPLOAD_STORAGE_DIR') || '.contextforge/uploads',
    );
    const uploadRoot = path.join(storageRoot, uploadId);
    const originalsDir = path.join(uploadRoot, 'original');
    const extractedPath = path.join(uploadRoot, 'extracted');
    const originalFileName = this.safeFileName(file.originalname);
    const originalPath = path.join(originalsDir, originalFileName);
    const archiveFormat = this.detectArchiveFormat(originalFileName);
    const uploadedAt = new Date().toISOString();

    if (
      archiveFormat === 'single_file' &&
      !DIRECT_UPLOAD_EXTENSIONS.has(path.extname(originalFileName).toLowerCase())
    ) {
      throw new AppException(
        'managed_upload_unsupported_file',
        'Only ZIP archives and text-like files are supported by the MVP upload importer',
        'managed_upload_store',
        false,
        { fileName: originalFileName },
      );
    }

    await fs.mkdir(originalsDir, { recursive: true });
    await fs.mkdir(extractedPath, { recursive: true });
    await fs.writeFile(originalPath, file.buffer);

    if (archiveFormat === 'zip') {
      const extracted = await this.zipArchiveService.extract(file.buffer, extractedPath, {
        maxArchiveBytes,
        maxExtractedBytes: this.getPositiveConfig(
          'MANAGED_UPLOAD_MAX_EXTRACTED_BYTES',
          250 * 1024 * 1024,
        ),
        maxFiles: this.getPositiveConfig('MANAGED_UPLOAD_MAX_FILES', 5000),
      });

      return {
        uploadId,
        originalFileName,
        archiveFormat,
        storageRoot,
        originalPath,
        extractedPath,
        sizeBytes: file.size || file.buffer.length,
        fileCount: extracted.fileCount,
        contentBytes: extracted.contentBytes,
        uploadedAt,
      };
    }

    const extractedFilePath = path.join(extractedPath, originalFileName);
    await fs.writeFile(extractedFilePath, file.buffer);

    return {
      uploadId,
      originalFileName,
      archiveFormat,
      storageRoot,
      originalPath,
      extractedPath,
      sizeBytes: file.size || file.buffer.length,
      fileCount: 1,
      contentBytes: file.size || file.buffer.length,
      uploadedAt,
    };
  }

  private detectArchiveFormat(fileName: string): 'single_file' | 'zip' {
    return path.extname(fileName).toLowerCase() === '.zip' ? 'zip' : 'single_file';
  }

  private getPositiveConfig(key: string, fallback: number): number {
    const value = Number(this.configService.get<number | string>(key) || fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private safeFileName(fileName: string): string {
    const baseName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    return baseName || 'upload';
  }
}
