import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppException } from '../common/app-error';
import { ZipArchiveService } from './zip-archive.service';

describe('ZipArchiveService', () => {
  let tempDir: string;
  let service: ZipArchiveService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextforge-zip-'));
    service = new ZipArchiveService();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts a narrow stored ZIP archive', async () => {
    const archive = createStoredZip({
      'docs/readme.md': '# Hello\n',
      'src/app.ts': 'export const ok = true;\n',
    });

    await expect(
      service.extract(archive, tempDir, {
        maxArchiveBytes: 1024 * 1024,
        maxExtractedBytes: 1024 * 1024,
        maxFiles: 10,
      }),
    ).resolves.toEqual({
      fileCount: 2,
      contentBytes: 32,
    });

    expect(fs.readFileSync(path.join(tempDir, 'docs/readme.md'), 'utf8')).toBe('# Hello\n');
    expect(fs.readFileSync(path.join(tempDir, 'src/app.ts'), 'utf8')).toContain('ok');
  });

  it('rejects path traversal entries', async () => {
    const archive = createStoredZip({
      '../outside.md': 'nope',
    });

    await expect(
      service.extract(archive, tempDir, {
        maxArchiveBytes: 1024 * 1024,
        maxExtractedBytes: 1024 * 1024,
        maxFiles: 10,
      }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('rejects archives that expand beyond the configured limit', async () => {
    const archive = createStoredZip({
      'large.txt': '0123456789',
    });

    await expect(
      service.extract(archive, tempDir, {
        maxArchiveBytes: 1024 * 1024,
        maxExtractedBytes: 4,
        maxFiles: 10,
      }),
    ).rejects.toMatchObject({
      code: 'managed_upload_extracted_too_large',
    });
  });
});

function createStoredZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const contentBuffer = Buffer.from(content, 'utf8');
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(contentBuffer.length, 18);
    localHeader.writeUInt32LE(contentBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, contentBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(contentBuffer.length, 20);
    centralHeader.writeUInt32LE(contentBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + contentBuffer.length;
  }

  const localContent = Buffer.concat(localParts);
  const centralContent = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralContent.length, 12);
  eocd.writeUInt32LE(localContent.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localContent, centralContent, eocd]);
}
