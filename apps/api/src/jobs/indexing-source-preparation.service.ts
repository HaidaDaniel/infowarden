import { Injectable } from '@nestjs/common';
import { Source } from '@prisma/client';
import * as fs from 'fs';
import { GitManager } from '../ingestion/git.manager';
import { LocalFolderScanner } from '../ingestion/local-folder.scanner';
import { UrlCrawler } from '../ingestion/url-crawler';
import { AppException } from '../common/app-error';
import {
  GitRuntimeMetadata,
  ObsidianRuntimeMetadata,
  PreparedSourceContext,
  SourceRuntimeMetadata,
  UploadRuntimeMetadata,
} from './indexing.types';

@Injectable()
export class IndexingSourcePreparationService {
  constructor(
    private readonly scanner: LocalFolderScanner,
    private readonly gitManager: GitManager,
    private readonly urlCrawler: UrlCrawler,
  ) {}

  async prepare(source: Source): Promise<PreparedSourceContext> {
    const gitMetadata =
      source.type === 'git_repo' ? await this.prepareGitWorkingTree(source.uri, source.metadata) : undefined;
    const uploadMetadata =
      source.type === 'upload' ? this.prepareManagedUpload(source.metadata) : undefined;
    const urlCrawl = source.type === 'url' ? await this.prepareUrlSource(source.uri, source.metadata) : undefined;
    const obsidianMetadata =
      source.type === 'obsidian_vault' ? this.prepareObsidianVault(source.uri) : undefined;
    const scanRoot = uploadMetadata?.extractedPath || gitMetadata?.clonePath || source.uri;
    const files =
      urlCrawl?.files ||
      this.scanner.scan(scanRoot, {
        includeRules: (source.includeRules as string[]) || [],
        excludeRules: (source.excludeRules as string[]) || [],
        ...(obsidianMetadata
          ? {
              metadata: {
                sourceType: 'obsidian_vault',
                vaultRoot: obsidianMetadata.vaultRoot,
              },
            }
          : {}),
      });
    if (obsidianMetadata) {
      this.attachObsidianMetadata(files, obsidianMetadata.vaultRoot);
      obsidianMetadata.noteCount = files.filter((file) => file.relativePath.endsWith('.md')).length;
    }

    return {
      scanRoot,
      files,
      gitMetadata,
      uploadMetadata,
      urlMetadata: urlCrawl?.metadata,
      obsidianMetadata,
    };
  }

  private prepareObsidianVault(vaultRoot: string): ObsidianRuntimeMetadata {
    return {
      vaultRoot,
      noteCount: 0,
    };
  }

  private attachObsidianMetadata(files: Array<{ relativePath: string; absolutePath: string; metadata?: Record<string, unknown> }>, vaultRoot: string): void {
    const markdownFiles = files.filter((file) => file.relativePath.toLowerCase().endsWith('.md'));
    const pathByStem = new Map<string, string>();
    const outgoing = new Map<string, string[]>();
    const backlinks = new Map<string, string[]>();

    for (const file of markdownFiles) {
      const normalizedPath = this.normalizePath(file.relativePath);
      pathByStem.set(this.pathWithoutExtension(normalizedPath).toLowerCase(), normalizedPath);
      pathByStem.set(this.basenameWithoutExtension(normalizedPath).toLowerCase(), normalizedPath);
    }

    for (const file of markdownFiles) {
      const normalizedPath = this.normalizePath(file.relativePath);
      const text = fs.readFileSync(file.absolutePath, 'utf8');
      const targets = this.extractWikilinks(text)
        .map((link) => this.resolveObsidianLink(link, normalizedPath, pathByStem))
        .filter((target): target is string => Boolean(target));
      outgoing.set(normalizedPath, [...new Set(targets)].sort());
      for (const target of targets) {
        backlinks.set(target, [...(backlinks.get(target) || []), normalizedPath]);
      }
    }

    for (const file of markdownFiles) {
      const normalizedPath = this.normalizePath(file.relativePath);
      file.metadata = {
        ...(file.metadata || {}),
        sourceType: 'obsidian_vault',
        vaultRoot,
        obsidianBacklinks: [...new Set(backlinks.get(normalizedPath) || [])].sort(),
        obsidianOutgoingLinks: outgoing.get(normalizedPath) || [],
      };
    }
  }

  private extractWikilinks(text: string): string[] {
    return [...text.matchAll(/!?\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim());
  }

  private resolveObsidianLink(link: string, currentPath: string, pathByStem: Map<string, string>): string | undefined {
    const target = link
      .split('|')[0]
      .split('#')[0]
      .split('^')[0]
      .trim()
      .replace(/\\/g, '/');
    if (!target) {
      return undefined;
    }

    const withExtension = target.toLowerCase().endsWith('.md') ? target : `${target}.md`;
    const normalized = this.normalizePath(withExtension);
    if (pathByStem.has(this.pathWithoutExtension(normalized).toLowerCase())) {
      return pathByStem.get(this.pathWithoutExtension(normalized).toLowerCase());
    }

    const currentDir = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : '';
    const relative = this.normalizePath(`${currentDir}/${withExtension}`);
    return (
      pathByStem.get(this.pathWithoutExtension(relative).toLowerCase()) ||
      pathByStem.get(this.basenameWithoutExtension(normalized).toLowerCase())
    );
  }

  private normalizePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
  }

  private pathWithoutExtension(value: string): string {
    return value.replace(/\.md$/i, '');
  }

  private basenameWithoutExtension(value: string): string {
    const normalized = this.pathWithoutExtension(value);
    const index = normalized.lastIndexOf('/');
    return index === -1 ? normalized : normalized.slice(index + 1);
  }

  private async prepareUrlSource(rawUri: string, rawMetadata: unknown) {
    const metadata = this.normalizeSourceMetadata(rawMetadata);
    return this.urlCrawler.crawl(rawUri, {
      ...(typeof metadata.maxPages === 'number' ? { maxPages: metadata.maxPages } : {}),
      ...(typeof metadata.maxBytesPerPage === 'number'
        ? { maxBytesPerPage: metadata.maxBytesPerPage }
        : {}),
      ...(typeof metadata.totalMaxBytes === 'number'
        ? { totalMaxBytes: metadata.totalMaxBytes }
        : {}),
      ...(typeof metadata.timeoutMs === 'number' ? { timeoutMs: metadata.timeoutMs } : {}),
      ...(typeof metadata.sameHost === 'boolean' ? { sameHost: metadata.sameHost } : {}),
      ...(typeof metadata.respectRobots === 'boolean'
        ? { respectRobots: metadata.respectRobots }
        : {}),
    });
  }

  private prepareManagedUpload(rawMetadata: unknown): UploadRuntimeMetadata {
    const metadata = this.normalizeSourceMetadata(rawMetadata);
    if (!metadata.uploadId || !metadata.extractedPath) {
      throw new AppException(
        'managed_upload_metadata_invalid',
        'Managed upload source is missing uploadId or extractedPath metadata',
        'prepare_upload_source',
        false,
        { metadataKeys: rawMetadata && typeof rawMetadata === 'object' ? Object.keys(rawMetadata) : [] },
      );
    }

    return {
      uploadId: metadata.uploadId,
      originalFileName: metadata.originalFileName || 'upload',
      archiveFormat: metadata.archiveFormat || 'single_file',
      extractedPath: metadata.extractedPath,
    };
  }

  private async prepareGitWorkingTree(
    repoUri: string,
    rawMetadata: unknown,
  ): Promise<GitRuntimeMetadata> {
    const metadata = this.normalizeSourceMetadata(rawMetadata);
    const branch = metadata.branch || 'main';
    const status = await this.gitManager.getStatus(repoUri, branch, metadata.clonePath);
    const result = status.exists
      ? await this.gitManager.pull(repoUri, branch, metadata.clonePath)
      : await this.gitManager.clone(repoUri, branch, metadata.clonePath);

    if (!result.success || !result.commit) {
      throw new AppException(
        'git_sync_failed',
        'Git source could not be prepared for indexing',
        'prepare_git_source',
        true,
        {
          branch,
          clonePath: result.clonePath,
          cause: result.error || 'Unknown git error',
        },
      );
    }

    return {
      branch: result.branch,
      commit: result.commit,
      clonePath: result.clonePath,
    };
  }

  private normalizeSourceMetadata(rawMetadata: unknown): SourceRuntimeMetadata {
    if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
      return {};
    }

    const metadata = rawMetadata as Record<string, unknown>;
    return {
      ...(typeof metadata.branch === 'string' ? { branch: metadata.branch } : {}),
      ...(typeof metadata.commit === 'string' ? { commit: metadata.commit } : {}),
      ...(typeof metadata.clonePath === 'string' ? { clonePath: metadata.clonePath } : {}),
      ...(typeof metadata.uploadId === 'string' ? { uploadId: metadata.uploadId } : {}),
      ...(typeof metadata.originalFileName === 'string'
        ? { originalFileName: metadata.originalFileName }
        : {}),
      ...(metadata.archiveFormat === 'single_file' || metadata.archiveFormat === 'zip'
        ? { archiveFormat: metadata.archiveFormat }
        : {}),
      ...(typeof metadata.extractedPath === 'string'
        ? { extractedPath: metadata.extractedPath }
        : {}),
      ...(typeof metadata.maxPages === 'number' ? { maxPages: metadata.maxPages } : {}),
      ...(typeof metadata.maxBytesPerPage === 'number'
        ? { maxBytesPerPage: metadata.maxBytesPerPage }
        : {}),
      ...(typeof metadata.totalMaxBytes === 'number'
        ? { totalMaxBytes: metadata.totalMaxBytes }
        : {}),
      ...(typeof metadata.timeoutMs === 'number' ? { timeoutMs: metadata.timeoutMs } : {}),
      ...(typeof metadata.sameHost === 'boolean' ? { sameHost: metadata.sameHost } : {}),
      ...(typeof metadata.respectRobots === 'boolean' ? { respectRobots: metadata.respectRobots } : {}),
    };
  }
}
