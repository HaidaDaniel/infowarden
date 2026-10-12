import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppException } from '../common/app-error';
import { ManagedUploadStorageService } from './managed-upload-storage.service';

describe('ManagedUploadStorageService', () => {
  let tempDir: string;
  let zipArchiveService: { extract: jest.Mock };
  let service: ManagedUploadStorageService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextforge-upload-'));
    zipArchiveService = {
      extract: jest.fn().mockResolvedValue({ fileCount: 2, contentBytes: 42 }),
    };
    service = new ManagedUploadStorageService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string | number> = {
            MANAGED_UPLOAD_STORAGE_DIR: tempDir,
            MANAGED_UPLOAD_MAX_ARCHIVE_BYTES: 1024 * 1024,
            MANAGED_UPLOAD_MAX_EXTRACTED_BYTES: 2 * 1024 * 1024,
            MANAGED_UPLOAD_MAX_FILES: 100,
          };
          return values[key];
        }),
      } as any,
      zipArchiveService as any,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores a supported single file into an extracted upload directory', async () => {
    const artifact = await service.store({
      originalname: 'notes.md',
      buffer: Buffer.from('# Notes\n'),
      size: 8,
    });

    expect(artifact).toMatchObject({
      originalFileName: 'notes.md',
      archiveFormat: 'single_file',
      fileCount: 1,
      contentBytes: 8,
    });
    expect(fs.existsSync(path.join(artifact.extractedPath, 'notes.md'))).toBe(true);
    expect(zipArchiveService.extract).not.toHaveBeenCalled();
  });

  it('delegates ZIP extraction to the archive service', async () => {
    const artifact = await service.store({
      originalname: 'dataset.zip',
      buffer: Buffer.from('zip'),
      size: 3,
    });

    expect(artifact).toMatchObject({
      originalFileName: 'dataset.zip',
      archiveFormat: 'zip',
      fileCount: 2,
      contentBytes: 42,
    });
    expect(zipArchiveService.extract).toHaveBeenCalledWith(
      Buffer.from('zip'),
      artifact.extractedPath,
      {
        maxArchiveBytes: 1024 * 1024,
        maxExtractedBytes: 2 * 1024 * 1024,
        maxFiles: 100,
      },
    );
  });

  it('rejects unsupported direct file uploads', async () => {
    await expect(
      service.store({
        originalname: 'image.png',
        buffer: Buffer.from('png'),
        size: 3,
      }),
    ).rejects.toBeInstanceOf(AppException);
  });
});
