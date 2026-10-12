import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as micromatch from 'micromatch';
import { AppException, getErrorMessage } from '../common/app-error';

export interface FileEntry {
  relativePath: string;
  absolutePath: string;
  size: number;
  mtime: Date;
  content?: Buffer;
  skipReason?: string;
  metadata?: Record<string, unknown>;
}

export interface ScanOptions {
  includeRules?: string[];
  excludeRules?: string[];
  maxFileSize?: number;
  defaultExcludes?: boolean;
  metadata?: Record<string, unknown>;
}

const DEFAULT_EXCLUDES = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/*.log',
  '**/tmp/**',
  '**/temp/**',
];

@Injectable()
export class LocalFolderScanner {
  scan(
    folderPath: string,
    options: ScanOptions = {}
  ): FileEntry[] {
    const {
      includeRules = [],
      excludeRules = [],
      maxFileSize = 10 * 1024 * 1024,
      defaultExcludes = true,
      metadata = {},
    } = options;

    const allExcludes = defaultExcludes
      ? [...DEFAULT_EXCLUDES, ...excludeRules]
      : excludeRules;

    const results: FileEntry[] = [];

    if (!fs.existsSync(folderPath)) {
      throw new AppException(
        'source_folder_missing',
        'Source folder does not exist',
        'scan_source',
        false,
        { path: folderPath },
      );
    }

    try {
      const stats = fs.statSync(folderPath);
      if (!stats.isDirectory()) {
        throw new AppException(
          'source_folder_invalid',
          'Source URI is not a folder',
          'scan_source',
          false,
          { path: folderPath },
        );
      }
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      throw new AppException(
        'source_folder_unreadable',
        'Source folder cannot be read',
        'scan_source',
        false,
        { path: folderPath, cause: getErrorMessage(error) },
      );
    }

    this.scanDirectory(folderPath, folderPath, includeRules, allExcludes, maxFileSize, results, metadata);

    return results;
  }

  private scanDirectory(
    currentPath: string,
    basePath: string,
    includeRules: string[],
    excludeRules: string[],
    maxFileSize: number,
    results: FileEntry[],
    metadata: Record<string, unknown> = {}
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (error) {
      throw new AppException(
        'source_folder_unreadable',
        'Source folder cannot be read',
        'scan_source',
        false,
        { path: currentPath, cause: getErrorMessage(error) },
      );
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(basePath, absolutePath);

      if (this.shouldExclude(relativePath, excludeRules)) {
        continue;
      }

      if (entry.isDirectory()) {
        this.scanDirectory(absolutePath, basePath, includeRules, excludeRules, maxFileSize, results, metadata);
      } else if (entry.isFile()) {
        const fileStats = fs.statSync(absolutePath);

        if (fileStats.size > maxFileSize) {
          results.push({
            relativePath,
            absolutePath,
            size: fileStats.size,
            mtime: fileStats.mtime,
            skipReason: `File exceeds max size (${maxFileSize} bytes)`,
            metadata: { ...metadata, code: 'file_too_large' },
          });
          continue;
        }

        if (!this.shouldInclude(relativePath, includeRules)) {
          results.push({
            relativePath,
            absolutePath,
            size: fileStats.size,
            mtime: fileStats.mtime,
            skipReason: 'Not matched by include rules',
            metadata: { ...metadata, code: 'file_not_included' },
          });
          continue;
        }

        results.push({
          relativePath,
          absolutePath,
          size: fileStats.size,
          mtime: fileStats.mtime,
          metadata,
        });
      }
    }
  }

  private shouldExclude(relativePath: string, excludeRules: string[]): boolean {
    if (excludeRules.length === 0) {
      return false;
    }
    return micromatch.isMatch(relativePath, excludeRules);
  }

  private shouldInclude(relativePath: string, includeRules: string[]): boolean {
    if (includeRules.length === 0) {
      return true;
    }
    return micromatch.isMatch(relativePath, includeRules);
  }
}
