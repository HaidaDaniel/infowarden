import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { Injectable } from '@nestjs/common';
import { AppException, getErrorMessage } from '../common/app-error';

export type ZipExtractionOptions = {
  maxArchiveBytes: number;
  maxExtractedBytes: number;
  maxFiles: number;
};

export type ZipExtractionResult = {
  fileCount: number;
  contentBytes: number;
};

type ZipCentralDirectoryEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;

@Injectable()
export class ZipArchiveService {
  async extract(
    archive: Buffer,
    destination: string,
    options: ZipExtractionOptions,
  ): Promise<ZipExtractionResult> {
    if (archive.length > options.maxArchiveBytes) {
      throw new AppException(
        'managed_upload_archive_too_large',
        'Uploaded archive exceeds the configured max archive size',
        'managed_upload_extract_zip',
        false,
        { maxArchiveBytes: options.maxArchiveBytes, sizeBytes: archive.length },
      );
    }

    await fs.mkdir(destination, { recursive: true });

    const entries = this.readCentralDirectory(archive, options);
    let fileCount = 0;
    let contentBytes = 0;
    const seenTargets = new Set<string>();
    const destinationRoot = path.resolve(destination);

    for (const entry of entries) {
      if (entry.name.endsWith('/')) {
        continue;
      }

      const safeRelativePath = this.normalizeEntryName(entry.name);
      const targetPath = path.resolve(destinationRoot, safeRelativePath);
      if (!targetPath.startsWith(`${destinationRoot}${path.sep}`)) {
        throw new AppException(
          'managed_upload_zip_path_escape',
          'ZIP archive contains an unsafe path',
          'managed_upload_extract_zip',
          false,
          { entry: entry.name },
        );
      }

      if (seenTargets.has(targetPath)) {
        throw new AppException(
          'managed_upload_zip_duplicate_entry',
          'ZIP archive contains duplicate file entries',
          'managed_upload_extract_zip',
          false,
          { entry: entry.name },
        );
      }
      seenTargets.add(targetPath);

      contentBytes += entry.uncompressedSize;
      if (contentBytes > options.maxExtractedBytes) {
        throw new AppException(
          'managed_upload_extracted_too_large',
          'ZIP archive expands beyond the configured max extracted size',
          'managed_upload_extract_zip',
          false,
          { maxExtractedBytes: options.maxExtractedBytes, contentBytes },
        );
      }

      const content = this.readEntryContent(archive, entry);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content);
      fileCount += 1;
    }

    if (fileCount === 0) {
      throw new AppException(
        'managed_upload_empty_archive',
        'ZIP archive does not contain any files',
        'managed_upload_extract_zip',
        false,
      );
    }

    return { fileCount, contentBytes };
  }

  private readCentralDirectory(
    archive: Buffer,
    options: ZipExtractionOptions,
  ): ZipCentralDirectoryEntry[] {
    const eocdOffset = this.findEndOfCentralDirectory(archive);
    if (eocdOffset === -1) {
      throw new AppException(
        'managed_upload_invalid_zip',
        'Uploaded file is not a valid ZIP archive',
        'managed_upload_read_zip',
        false,
      );
    }

    const entryCount = archive.readUInt16LE(eocdOffset + 10);
    const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
    const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);

    if (
      entryCount === 0xffff ||
      centralDirectorySize === ZIP64_SENTINEL ||
      centralDirectoryOffset === ZIP64_SENTINEL
    ) {
      throw new AppException(
        'managed_upload_zip64_unsupported',
        'ZIP64 archives are not supported by the MVP upload importer',
        'managed_upload_read_zip',
        false,
      );
    }

    if (entryCount > options.maxFiles) {
      throw new AppException(
        'managed_upload_too_many_files',
        'ZIP archive contains too many files',
        'managed_upload_read_zip',
        false,
        { maxFiles: options.maxFiles, entryCount },
      );
    }

    if (centralDirectoryOffset + centralDirectorySize > archive.length) {
      throw new AppException(
        'managed_upload_invalid_zip',
        'ZIP central directory is outside the archive bounds',
        'managed_upload_read_zip',
        false,
      );
    }

    const entries: ZipCentralDirectoryEntry[] = [];
    let offset = centralDirectoryOffset;
    const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > centralDirectoryEnd) {
        throw new AppException(
          'managed_upload_invalid_zip',
          'ZIP central directory entry is truncated',
          'managed_upload_read_zip',
          false,
          { index },
        );
      }

      if (archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
        throw new AppException(
          'managed_upload_invalid_zip',
          'ZIP central directory entry is invalid',
          'managed_upload_read_zip',
          false,
          { index },
        );
      }

      const flags = archive.readUInt16LE(offset + 8);
      const compressionMethod = archive.readUInt16LE(offset + 10);
      const compressedSize = archive.readUInt32LE(offset + 20);
      const uncompressedSize = archive.readUInt32LE(offset + 24);
      const nameLength = archive.readUInt16LE(offset + 28);
      const extraLength = archive.readUInt16LE(offset + 30);
      const commentLength = archive.readUInt16LE(offset + 32);
      const localHeaderOffset = archive.readUInt32LE(offset + 42);

      if (flags & 0x1) {
        throw new AppException(
          'managed_upload_encrypted_zip_unsupported',
          'Encrypted ZIP entries are not supported',
          'managed_upload_read_zip',
          false,
          { index },
        );
      }

      if (
        compressedSize === ZIP64_SENTINEL ||
        uncompressedSize === ZIP64_SENTINEL ||
        localHeaderOffset === ZIP64_SENTINEL
      ) {
        throw new AppException(
          'managed_upload_zip64_unsupported',
          'ZIP64 archives are not supported by the MVP upload importer',
          'managed_upload_read_zip',
          false,
          { index },
        );
      }

      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLength;
      if (nameEnd + extraLength + commentLength > centralDirectoryEnd) {
        throw new AppException(
          'managed_upload_invalid_zip',
          'ZIP central directory entry metadata is truncated',
          'managed_upload_read_zip',
          false,
          { index },
        );
      }
      const name = archive.subarray(nameStart, nameEnd).toString('utf8');

      entries.push({
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      offset = nameEnd + extraLength + commentLength;
    }

    return entries;
  }

  private readEntryContent(archive: Buffer, entry: ZipCentralDirectoryEntry): Buffer {
    const offset = entry.localHeaderOffset;
    if (offset + 30 > archive.length) {
      throw new AppException(
        'managed_upload_invalid_zip',
        'ZIP local file header is outside the archive bounds',
        'managed_upload_extract_zip',
        false,
        { entry: entry.name },
      );
    }

    if (archive.readUInt32LE(offset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new AppException(
        'managed_upload_invalid_zip',
        'ZIP local file header is invalid',
        'managed_upload_extract_zip',
        false,
        { entry: entry.name },
      );
    }

    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;

    if (dataEnd > archive.length) {
      throw new AppException(
        'managed_upload_invalid_zip',
        'ZIP entry content is outside the archive bounds',
        'managed_upload_extract_zip',
        false,
        { entry: entry.name },
      );
    }

    const compressed = archive.subarray(dataStart, dataEnd);
    let content: Buffer;

    try {
      if (entry.compressionMethod === 0) {
        content = compressed;
      } else if (entry.compressionMethod === 8) {
        content = zlib.inflateRawSync(compressed);
      } else {
        throw new AppException(
          'managed_upload_zip_compression_unsupported',
          'ZIP archive uses an unsupported compression method',
          'managed_upload_extract_zip',
          false,
          { entry: entry.name, compressionMethod: entry.compressionMethod },
        );
      }
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }

      throw new AppException(
        'managed_upload_zip_entry_extract_failed',
        'ZIP entry could not be extracted',
        'managed_upload_extract_zip',
        false,
        { entry: entry.name, cause: getErrorMessage(error) },
      );
    }

    if (content.length !== entry.uncompressedSize) {
      throw new AppException(
        'managed_upload_zip_size_mismatch',
        'ZIP entry extracted size does not match archive metadata',
        'managed_upload_extract_zip',
        false,
        {
          entry: entry.name,
          expectedBytes: entry.uncompressedSize,
          actualBytes: content.length,
        },
      );
    }

    return content;
  }

  private findEndOfCentralDirectory(archive: Buffer): number {
    const minOffset = Math.max(0, archive.length - 0xffff - 22);
    for (let offset = archive.length - 22; offset >= minOffset; offset -= 1) {
      if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
        return offset;
      }
    }

    return -1;
  }

  private normalizeEntryName(entryName: string): string {
    if (!entryName || entryName.includes('\0')) {
      throw new AppException(
        'managed_upload_zip_invalid_path',
        'ZIP archive contains an invalid path',
        'managed_upload_extract_zip',
        false,
        { entry: entryName },
      );
    }

    const normalized = path.posix.normalize(entryName.replace(/\\/g, '/'));
    if (
      normalized.startsWith('/') ||
      normalized.startsWith('../') ||
      normalized === '..' ||
      /^[a-zA-Z]:/.test(normalized)
    ) {
      throw new AppException(
        'managed_upload_zip_path_escape',
        'ZIP archive contains an unsafe path',
        'managed_upload_extract_zip',
        false,
        { entry: entryName },
      );
    }

    return normalized;
  }
}
