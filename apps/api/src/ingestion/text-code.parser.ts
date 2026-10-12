import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as zlib from 'zlib';

export interface ParsedDocumentWarning {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedDocument {
  text: string;
  mimeType: string;
  filePath: string;
  contentHash: string;
  fileSize: number;
  language?: string;
  dependencyRefs?: string[];
  metadata?: Record<string, unknown>;
  warnings?: ParsedDocumentWarning[];
}

export interface ParseOptions {
  maxFileSize?: number;
}

@Injectable()
export class TextCodeParser {
  private readonly documentImageExtensions = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.tif',
    '.tiff',
    '.bmp',
    '.webp',
  ]);
  private readonly audioVideoExtensions = new Set([
    '.mp3',
    '.wav',
    '.m4a',
    '.flac',
    '.ogg',
    '.mp4',
    '.mov',
    '.avi',
    '.mkv',
    '.webm',
  ]);

  private readonly supportedExtensions: Map<string, { mimeType: string; language: string }> = new Map([
    ['.md', { mimeType: 'text/markdown', language: 'markdown' }],
    ['.markdown', { mimeType: 'text/markdown', language: 'markdown' }],
    ['.txt', { mimeType: 'text/plain', language: 'text' }],
    ['.json', { mimeType: 'application/json', language: 'json' }],
    ['.ts', { mimeType: 'text/typescript', language: 'typescript' }],
    ['.tsx', { mimeType: 'text/typescript', language: 'typescript' }],
    ['.js', { mimeType: 'text/javascript', language: 'javascript' }],
    ['.jsx', { mimeType: 'text/javascript', language: 'javascript' }],
    ['.py', { mimeType: 'text/x-python', language: 'python' }],
    ['.ipynb', { mimeType: 'application/x-ipynb+json', language: 'json' }],
    ['.rs', { mimeType: 'text/x-rust', language: 'rust' }],
    ['.go', { mimeType: 'text/x-go', language: 'go' }],
    ['.java', { mimeType: 'text/x-java', language: 'java' }],
    ['.c', { mimeType: 'text/x-c', language: 'c' }],
    ['.cpp', { mimeType: 'text/x-cpp', language: 'cpp' }],
    ['.h', { mimeType: 'text/x-c', language: 'c' }],
    ['.hpp', { mimeType: 'text/x-cpp', language: 'cpp' }],
    ['.cs', { mimeType: 'text/x-csharp', language: 'csharp' }],
    ['.rb', { mimeType: 'text/x-ruby', language: 'ruby' }],
    ['.php', { mimeType: 'text/x-php', language: 'php' }],
    ['.swift', { mimeType: 'text/x-swift', language: 'swift' }],
    ['.kt', { mimeType: 'text/x-kotlin', language: 'kotlin' }],
    ['.scala', { mimeType: 'text/x-scala', language: 'scala' }],
    ['.vue', { mimeType: 'text/html', language: 'vue' }],
    ['.svelte', { mimeType: 'text/html', language: 'svelte' }],
    ['.yaml', { mimeType: 'application/yaml', language: 'yaml' }],
    ['.yml', { mimeType: 'application/yaml', language: 'yaml' }],
    ['.xml', { mimeType: 'application/xml', language: 'xml' }],
    ['.html', { mimeType: 'text/html', language: 'html' }],
    ['.htm', { mimeType: 'text/html', language: 'html' }],
    ['.pdf', { mimeType: 'application/pdf', language: 'document' }],
    ['.docx', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', language: 'document' }],
    ['.css', { mimeType: 'text/css', language: 'css' }],
    ['.scss', { mimeType: 'text/x-scss', language: 'scss' }],
    ['.sass', { mimeType: 'text/x-sass', language: 'sass' }],
    ['.less', { mimeType: 'text/x-less', language: 'less' }],
    ['.sql', { mimeType: 'application/sql', language: 'sql' }],
    ['.sh', { mimeType: 'text/x-shellscript', language: 'shell' }],
    ['.bash', { mimeType: 'text/x-shellscript', language: 'shell' }],
    ['.ps1', { mimeType: 'text/x-powershell', language: 'powershell' }],
    ['.toml', { mimeType: 'application/toml', language: 'toml' }],
    ['.env', { mimeType: 'text/plain', language: 'text' }],
    ['.log', { mimeType: 'text/plain', language: 'text' }],
    ['.csv', { mimeType: 'text/csv', language: 'csv' }],
  ]);

  parse(buffer: Buffer, filePath: string, options: ParseOptions = {}): ParsedDocument | null {
    const { maxFileSize = 10 * 1024 * 1024 } = options;

    const ext = this.getExtension(filePath).toLowerCase();
    const extensionInfo = this.supportedExtensions.get(ext);

    if (!extensionInfo) {
      return null;
    }

    if (buffer.length > maxFileSize) {
      return null;
    }

    if (buffer.length === 0) {
      return null;
    }

    try {
      if (ext === '.pdf') {
        return this.parsePdf(buffer, filePath);
      }

      if (ext === '.docx') {
        return this.parseDocx(buffer, filePath);
      }

      const text = buffer.toString('utf8');

      if (this.isBinaryContent(text)) {
        return null;
      }

      const htmlResult = ext === '.html' || ext === '.htm'
        ? this.extractHtmlArticle(text)
        : undefined;
      const normalizedText = htmlResult?.text || this.normalizeText(text);
      const markdownMetadata =
        extensionInfo.language === 'markdown'
          ? this.extractMarkdownMetadata(normalizedText)
          : undefined;

      if (normalizedText.trim().length === 0) {
        return null;
      }

      const contentHash = this.computeHash(normalizedText);

      return {
        text: normalizedText,
        mimeType: extensionInfo.mimeType,
        filePath,
        contentHash,
        fileSize: buffer.length,
        language: extensionInfo.language,
        dependencyRefs: this.extractDependencyRefs(normalizedText, extensionInfo.language),
        metadata: {
          ...(htmlResult?.metadata || {}),
          ...(markdownMetadata || {}),
        },
        warnings: htmlResult?.warnings,
      };
    } catch (error) {
      return null;
    }
  }

  describeParseFailure(filePath: string): ParsedDocumentWarning {
    const ext = this.getExtension(filePath).toLowerCase();

    if (this.documentImageExtensions.has(ext)) {
      return {
        severity: 'warning',
        code: 'ocr_unavailable',
        message: 'Document-like image skipped because OCR dependencies are not enabled in the MVP API runtime.',
        metadata: {
          processor: 'ocr',
          dependencyStrategy: 'not_enabled',
        },
      };
    }

    if (this.audioVideoExtensions.has(ext)) {
      return {
        severity: 'info',
        code: 'unsupported_file_type',
        message: 'Audio and video processing are backlog-only and are not implemented in the MVP ingestion runtime.',
        metadata: {
          processor: 'audio_video',
          backlogOnly: true,
        },
      };
    }

    if (ext === '.pdf') {
      return {
        severity: 'warning',
        code: 'pdf_text_extraction_empty',
        message: 'PDF text extraction produced no indexable text; the document may be scanned or encrypted.',
        metadata: {
          processor: 'pdf_text',
        },
      };
    }

    if (ext === '.docx') {
      return {
        severity: 'warning',
        code: 'docx_text_extraction_failed',
        message: 'DOCX text extraction failed or produced no indexable text.',
        metadata: {
          processor: 'docx_text',
        },
      };
    }

    return {
      severity: 'warning',
      code: 'parse_failed',
      message: 'Unsupported format or empty/binary content',
    };
  }

  private getExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1 || lastDot === filePath.length - 1) {
      return '';
    }
    return filePath.substring(lastDot);
  }

  private isBinaryContent(text: string): boolean {
    let binaryChars = 0;
    const totalChars = text.length;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
        binaryChars++;
        const binaryRatio = binaryChars / totalChars;
        if (binaryRatio > 0.3) {
          return true;
        }
      }
    }

    return false;
  }

  private normalizeText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }

  private extractMarkdownMetadata(text: string): Record<string, unknown> {
    const frontmatter = this.extractFrontmatter(text);
    const headings = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({
      level: match[1].length,
      text: match[2].trim(),
    }));
    const tags = [...text.matchAll(/(^|[\s([>{])#([A-Za-z0-9_/-]+)/g)]
      .map((match) => match[2])
      .filter((tag) => !/^[0-9a-fA-F]{3,8}$/.test(tag));
    const wikilinks = [...text.matchAll(/(?<!!)\[\[([^\]]+)\]\]/g)].map((match) =>
      this.normalizeObsidianLink(match[1]),
    );
    const embeds = [...text.matchAll(/!\[\[([^\]]+)\]\]/g)].map((match) =>
      this.normalizeObsidianLink(match[1]),
    );
    const attachmentRefs = [
      ...embeds.map((link) => link.target),
      ...[...text.matchAll(/\[[^\]]*\]\(([^)]+\.(?:png|jpe?g|gif|webp|svg|pdf|mp3|mp4|mov))\)/gi)].map(
        (match) => match[1].trim(),
      ),
    ];

    return {
      processor: 'markdown_obsidian',
      frontmatter,
      headings,
      obsidianTags: [...new Set(tags)].sort(),
      obsidianWikilinks: [...new Set(wikilinks.map((link) => link.target))].sort(),
      obsidianEmbeds: [...new Set(embeds.map((link) => link.target))].sort(),
      obsidianAttachmentRefs: [...new Set(attachmentRefs)].sort(),
      obsidianUnresolvedLinks: [...new Set(wikilinks.map((link) => link.target))].sort(),
    };
  }

  private extractFrontmatter(text: string): Record<string, unknown> {
    if (!text.startsWith('---\n')) {
      return {};
    }

    const end = text.indexOf('\n---', 4);
    if (end === -1) {
      return {};
    }

    const frontmatter: Record<string, unknown> = {};
    const raw = text.slice(4, end);
    for (const line of raw.split('\n')) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) {
        continue;
      }

      const value = match[2].trim();
      frontmatter[match[1]] =
        value.startsWith('[') && value.endsWith(']')
          ? value
              .slice(1, -1)
              .split(',')
              .map((item) => item.trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean)
          : value.replace(/^["']|["']$/g, '');
    }

    return frontmatter;
  }

  private normalizeObsidianLink(raw: string): { target: string; alias?: string; heading?: string } {
    const [targetWithHeading, alias] = raw.split('|').map((part) => part.trim());
    const [target, heading] = targetWithHeading.split('#').map((part) => part.trim());

    return {
      target,
      ...(alias ? { alias } : {}),
      ...(heading ? { heading } : {}),
    };
  }

  private parsePdf(buffer: Buffer, filePath: string): ParsedDocument | null {
    const source = buffer.toString('latin1');
    if (!source.startsWith('%PDF')) {
      return null;
    }

    const pageCount = (source.match(/\/Type\s*\/Page(?!s)\b/g) || []).length;
    const fragments: string[] = [];

    for (const match of source.matchAll(/stream\r?\n?([\s\S]*?)\r?\n?endstream/g)) {
      const streamIndex = match.index || 0;
      const dictionary = source.slice(Math.max(0, streamIndex - 1200), streamIndex);
      const rawStream = Buffer.from(match[1], 'latin1');
      const decodedStream = this.decodePdfStream(rawStream, dictionary);
      fragments.push(...this.extractPdfTextFragments(decodedStream.toString('latin1')));
    }

    if (fragments.length === 0) {
      fragments.push(...this.extractPdfTextFragments(source));
    }

    const normalizedText = this.normalizeText(fragments.join('\n'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');

    if (!normalizedText) {
      return null;
    }

    const charactersPerPage = pageCount > 0 ? normalizedText.length / pageCount : normalizedText.length;
    const lowConfidence = normalizedText.length < 40 || charactersPerPage < 40;
    const warnings: ParsedDocumentWarning[] = lowConfidence
      ? [
          {
            severity: 'warning',
            code: 'low_confidence_pdf_text',
            message: 'PDF text extraction produced a small amount of text; OCR may be needed for complete coverage.',
            metadata: {
              textLength: normalizedText.length,
              pageCount,
              charactersPerPage: Math.round(charactersPerPage),
            },
          },
        ]
      : [];

    return {
      text: normalizedText,
      mimeType: 'application/pdf',
      filePath,
      contentHash: this.computeHash(normalizedText),
      fileSize: buffer.length,
      language: 'document',
      dependencyRefs: [],
      metadata: {
        processor: 'pdf_text',
        pageCount,
        extractionConfidence: lowConfidence ? 'low' : 'medium',
        dependencyStrategy: 'node_builtin_best_effort',
      },
      warnings,
    };
  }

  private decodePdfStream(rawStream: Buffer, dictionary: string): Buffer {
    if (!/\/FlateDecode\b/.test(dictionary)) {
      return rawStream;
    }

    for (const inflate of [zlib.inflateSync, zlib.inflateRawSync]) {
      try {
        return inflate(rawStream);
      } catch {
        continue;
      }
    }

    return rawStream;
  }

  private extractPdfTextFragments(text: string): string[] {
    const fragments: string[] = [];

    for (const match of text.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
      const decoded = this.decodePdfString(match[0].slice(1, -1));
      if (this.looksLikeHumanText(decoded)) {
        fragments.push(decoded);
      }
    }

    for (const match of text.matchAll(/<([0-9A-Fa-f\s]{4,4000})>/g)) {
      const decoded = this.decodePdfHexString(match[1]);
      if (this.looksLikeHumanText(decoded)) {
        fragments.push(decoded);
      }
    }

    return fragments;
  }

  private decodePdfString(value: string): string {
    return value
      .replace(/\\([nrtbf()\\])/g, (_, escaped: string) => {
        const replacements: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
          '(': '(',
          ')': ')',
          '\\': '\\',
        };
        return replacements[escaped] || escaped;
      })
      .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
  }

  private decodePdfHexString(value: string): string {
    const hex = value.replace(/\s+/g, '');
    if (hex.length % 2 !== 0) {
      return '';
    }

    try {
      return Buffer.from(hex, 'hex').toString('utf8');
    } catch {
      return '';
    }
  }

  private parseDocx(buffer: Buffer, filePath: string): ParsedDocument | null {
    const entries = this.readZipEntries(buffer);
    const documentXml = entries.get('word/document.xml');

    if (!documentXml) {
      return null;
    }

    const textParts = [
      this.extractDocxPartText(documentXml.toString('utf8')),
      ...[
        'word/footnotes.xml',
        'word/endnotes.xml',
        'word/comments.xml',
      ].map((part) => {
        const value = entries.get(part);
        return value ? this.extractDocxPartText(value.toString('utf8')) : '';
      }),
    ].filter(Boolean);

    const normalizedText = this.normalizeText(textParts.join('\n\n'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');

    if (!normalizedText) {
      return null;
    }

    const title = this.extractDocxTitle(entries.get('docProps/core.xml')?.toString('utf8'));

    return {
      text: normalizedText,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filePath,
      contentHash: this.computeHash(normalizedText),
      fileSize: buffer.length,
      language: 'document',
      dependencyRefs: [],
      metadata: {
        processor: 'docx_text',
        title,
        partCount: entries.size,
        dependencyStrategy: 'node_builtin_zip_xml',
      },
    };
  }

  private readZipEntries(buffer: Buffer): Map<string, Buffer> {
    const entries = new Map<string, Buffer>();
    const endOffset = this.findZipEndOfCentralDirectory(buffer);
    if (endOffset < 0) {
      return entries;
    }

    const entryCount = buffer.readUInt16LE(endOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
    let offset = centralDirectoryOffset;

    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
        break;
      }

      const method = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8');
      const localData = this.readZipLocalData(buffer, localHeaderOffset, compressedSize);

      if (localData && !fileName.endsWith('/')) {
        entries.set(fileName, this.inflateZipEntry(localData, method));
      }

      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
  }

  private findZipEndOfCentralDirectory(buffer: Buffer): number {
    for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
      if (buffer.readUInt32LE(offset) === 0x06054b50) {
        return offset;
      }
    }

    return -1;
  }

  private readZipLocalData(buffer: Buffer, localHeaderOffset: number, compressedSize: number): Buffer | null {
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      return null;
    }

    const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
    const dataEnd = dataOffset + compressedSize;

    if (dataEnd > buffer.length) {
      return null;
    }

    return buffer.slice(dataOffset, dataEnd);
  }

  private inflateZipEntry(data: Buffer, method: number): Buffer {
    if (method === 0) {
      return data;
    }

    if (method === 8) {
      return zlib.inflateRawSync(data);
    }

    return Buffer.alloc(0);
  }

  private extractDocxPartText(xml: string): string {
    return this.decodeEntities(
      xml
        .replace(/<w:tab\b[^>]*\/>/g, '\t')
        .replace(/<w:br\b[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<\/w:tr>/g, '\n')
        .replace(/<[^>]+>/g, ''),
    );
  }

  private extractDocxTitle(xml?: string): string | undefined {
    const title = xml?.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1];
    return title ? this.decodeEntities(title).trim() || undefined : undefined;
  }

  private extractHtmlArticle(html: string): {
    text: string;
    metadata: Record<string, unknown>;
    warnings?: ParsedDocumentWarning[];
  } {
    const title = this.decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
    const selected = this.selectHtmlArticleRegion(html);
    const stripped = selected
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<form\b[\s\S]*?<\/form>/gi, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<canvas\b[\s\S]*?<\/canvas>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(h[1-6]|p|div|section|article|main|li|br|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    const normalizedText = this.normalizeText(this.decodeEntities(stripped))
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const textDensity = html.length > 0 ? normalizedText.length / html.length : 0;
    const warnings = textDensity < 0.03
      ? [
          {
            severity: 'warning' as const,
            code: 'html_low_text_density',
            message: 'HTML cleanup found little article text relative to source size.',
            metadata: {
              textDensity,
            },
          },
        ]
      : undefined;

    return {
      text: [title ? `Title: ${title}` : undefined, normalizedText].filter(Boolean).join('\n\n'),
      metadata: {
        processor: 'html_article',
        title: title || undefined,
        textDensity,
        dependencyStrategy: 'node_builtin_html_cleanup',
      },
      warnings,
    };
  }

  private selectHtmlArticleRegion(html: string): string {
    const candidates = [
      ...this.matchHtmlRegions(html, 'article'),
      ...this.matchHtmlRegions(html, 'main'),
      ...this.matchHtmlRegions(html, 'body'),
    ].sort((a, b) => this.visibleTextLength(b) - this.visibleTextLength(a));

    return candidates[0] || html;
  }

  private matchHtmlRegions(html: string, tagName: string): string[] {
    const regions: string[] = [];
    const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');

    for (const match of html.matchAll(pattern)) {
      regions.push(match[1]);
    }

    return regions;
  }

  private visibleTextLength(html: string): number {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  }

  private decodeEntities(text: string): string {
    return text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
      .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCodePoint(parseInt(value, 16)));
  }

  private looksLikeHumanText(value: string): boolean {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length < 2 || normalized.length > 2000) {
      return false;
    }

    const alphaNumeric = (normalized.match(/[A-Za-z0-9]/g) || []).length;
    return alphaNumeric / normalized.length > 0.35;
  }

  private computeHash(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  }

  private extractDependencyRefs(text: string, language: string): string[] {
    const refs = new Set<string>();

    if (['typescript', 'javascript', 'vue', 'svelte'].includes(language)) {
      for (const match of text.matchAll(/import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g)) {
        refs.add(match[1]);
      }
      for (const match of text.matchAll(/export\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g)) {
        refs.add(match[1]);
      }
      for (const match of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        refs.add(match[1]);
      }
    }

    if (language === 'python') {
      for (const match of text.matchAll(/from\s+([A-Za-z0-9_./-]+)\s+import\s+/g)) {
        refs.add(match[1]);
      }
      for (const match of text.matchAll(/import\s+([A-Za-z0-9_./,\s-]+)/g)) {
        const modules = match[1]
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        for (const moduleName of modules) {
          refs.add(moduleName);
        }
      }
    }

    return [...refs].sort();
  }
}
