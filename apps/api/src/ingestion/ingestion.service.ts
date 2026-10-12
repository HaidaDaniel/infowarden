import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { LocalFolderScanner, ScanOptions } from './local-folder.scanner';
import { TextCodeParser, ParsedDocument } from './text-code.parser';

export interface ParsedFile {
  relativePath: string;
  absolutePath: string;
  parsed: ParsedDocument | null;
  skipReason?: string;
}

@Injectable()
export class IngestionService {
  constructor(
    private readonly scanner: LocalFolderScanner,
    private readonly parser: TextCodeParser,
  ) {}

  scanFolder(folderPath: string, options?: ScanOptions) {
    return this.scanner.scan(folderPath, options);
  }

  parseFile(absolutePath: string, relativePath: string): ParsedFile {
    try {
      const buffer = fs.readFileSync(absolutePath);
      const parsed = this.parser.parse(buffer, relativePath);

      if (!parsed) {
        return {
          relativePath,
          absolutePath,
          parsed: null,
          skipReason: 'Unsupported format or empty/binary content',
        };
      }

      return {
        relativePath,
        absolutePath,
        parsed,
      };
    } catch (error) {
      return {
        relativePath,
        absolutePath,
        parsed: null,
        skipReason: `Parse error: ${error.message}`,
      };
    }
  }

  scanAndParse(folderPath: string, options?: ScanOptions): ParsedFile[] {
    const files = this.scanner.scan(folderPath, options);
    return files.map((file) => this.parseFile(file.absolutePath, file.relativePath));
  }
}
