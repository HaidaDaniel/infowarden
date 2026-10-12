import { SourceType } from '@prisma/client';
import { AppException } from '../common/app-error';
import { IndexingSourcePreparationService } from './indexing-source-preparation.service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('IndexingSourcePreparationService', () => {
  it('scans the extracted directory for managed upload sources', async () => {
    const scanner = {
      scan: jest.fn().mockReturnValue([{ relativePath: 'notes.md' }]),
    };
    const gitManager = {};
    const service = new IndexingSourcePreparationService(scanner as any, gitManager as any, {} as any);

    await expect(
      service.prepare({
        type: SourceType.upload,
        uri: 'upload://upload-1',
        includeRules: ['**/*.md'],
        excludeRules: [],
        metadata: {
          uploadId: 'upload-1',
          originalFileName: 'dataset.zip',
          archiveFormat: 'zip',
          extractedPath: '/var/lib/contextforge/uploads/upload-1/extracted',
        },
      } as any),
    ).resolves.toEqual({
      scanRoot: '/var/lib/contextforge/uploads/upload-1/extracted',
      files: [{ relativePath: 'notes.md' }],
      gitMetadata: undefined,
      uploadMetadata: {
        uploadId: 'upload-1',
        originalFileName: 'dataset.zip',
        archiveFormat: 'zip',
        extractedPath: '/var/lib/contextforge/uploads/upload-1/extracted',
      },
    });

    expect(scanner.scan).toHaveBeenCalledWith('/var/lib/contextforge/uploads/upload-1/extracted', {
      includeRules: ['**/*.md'],
      excludeRules: [],
    });
  });

  it('rejects upload sources without managed storage metadata', async () => {
    const service = new IndexingSourcePreparationService({ scan: jest.fn() } as any, {} as any, {} as any);

    await expect(
      service.prepare({
        type: SourceType.upload,
        uri: 'upload://upload-1',
        includeRules: [],
        excludeRules: [],
        metadata: {},
      } as any),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('crawls URL sources without using the folder scanner', async () => {
    const scanner = { scan: jest.fn() };
    const urlCrawler = {
      crawl: jest.fn().mockResolvedValue({
        files: [{ relativePath: 'index.html', content: Buffer.from('Hello') }],
        metadata: {
          startUrl: 'https://example.com/',
          fetchedUrls: ['https://example.com/'],
          maxPages: 1,
          maxBytesPerPage: 1024,
          totalMaxBytes: 1024,
          timeoutMs: 1000,
          sameHost: true,
          respectRobots: false,
        },
      }),
    };
    const service = new IndexingSourcePreparationService(scanner as any, {} as any, urlCrawler as any);

    await expect(
      service.prepare({
        type: SourceType.url,
        uri: 'https://example.com/',
        includeRules: [],
        excludeRules: [],
        metadata: {
          maxPages: 1,
          respectRobots: false,
        },
      } as any),
    ).resolves.toEqual({
      scanRoot: 'https://example.com/',
      files: [{ relativePath: 'index.html', content: Buffer.from('Hello') }],
      gitMetadata: undefined,
      uploadMetadata: undefined,
      urlMetadata: expect.objectContaining({
        startUrl: 'https://example.com/',
        maxPages: 1,
      }),
    });

    expect(urlCrawler.crawl).toHaveBeenCalledWith('https://example.com/', {
      maxPages: 1,
      respectRobots: false,
    });
    expect(scanner.scan).not.toHaveBeenCalled();
  });

  it('prepares Obsidian vault files with backlinks and vault metadata', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextforge-obsidian-'));
    const noteA = path.join(tempDir, 'A.md');
    const noteB = path.join(tempDir, 'B.md');
    fs.writeFileSync(noteA, 'See [[B]]', 'utf8');
    fs.writeFileSync(noteB, '# B', 'utf8');
    const scanner = {
      scan: jest.fn().mockReturnValue([
        {
          relativePath: 'A.md',
          absolutePath: noteA,
          size: 9,
          mtime: new Date('2026-07-15T10:00:00Z'),
          metadata: {
            sourceType: 'obsidian_vault',
            vaultRoot: tempDir,
          },
        },
        {
          relativePath: 'B.md',
          absolutePath: noteB,
          size: 3,
          mtime: new Date('2026-07-15T10:00:00Z'),
          metadata: {
            sourceType: 'obsidian_vault',
            vaultRoot: tempDir,
          },
        },
      ]),
    };
    const service = new IndexingSourcePreparationService(scanner as any, {} as any, {} as any);

    await expect(
      service.prepare({
        type: SourceType.obsidian_vault,
        uri: tempDir,
        includeRules: ['**/*.md'],
        excludeRules: ['**/.obsidian/**'],
        metadata: {},
      } as any),
    ).resolves.toMatchObject({
      scanRoot: tempDir,
      obsidianMetadata: {
        vaultRoot: tempDir,
        noteCount: 2,
      },
      files: [
        {
          relativePath: 'A.md',
          metadata: expect.objectContaining({
            obsidianOutgoingLinks: ['B.md'],
            obsidianBacklinks: [],
          }),
        },
        {
          relativePath: 'B.md',
          metadata: expect.objectContaining({
            obsidianBacklinks: ['A.md'],
          }),
        },
      ],
    });
    expect(scanner.scan).toHaveBeenCalledWith(tempDir, {
      includeRules: ['**/*.md'],
      excludeRules: ['**/.obsidian/**'],
      metadata: {
        sourceType: 'obsidian_vault',
        vaultRoot: tempDir,
      },
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
