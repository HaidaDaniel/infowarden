import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import { Chunk, ChunkOptions, SimpleChunker } from './simple.chunker';

export const STRUCTURE_AWARE_CHUNKER_VERSION = 'structure-aware-v1';
export const FIXED_CHAR_CHUNKER_VERSION = 'fixed_char-v1';
export const STRUCTURE_AWARE_CHUNKER_COMPATIBILITY_HASH = hashStable({
  version: STRUCTURE_AWARE_CHUNKER_VERSION,
  markdown: ['frontmatter', 'heading_sections', 'lists', 'tables', 'fenced_code'],
  code: ['symbols', 'imports', 'exports', 'line_ranges'],
  fallback: FIXED_CHAR_CHUNKER_VERSION,
});

type ChunkKind =
  | 'markdown_section'
  | 'markdown_block'
  | 'code_symbol'
  | 'code_preamble'
  | 'fixed_fallback';

type MarkdownSection = {
  text: string;
  startLine: number;
  endLine: number;
  heading?: string;
  headingLevel?: number;
  headingHierarchy: string[];
  anchor?: string;
};

type CodeSymbol = {
  name: string;
  kind: string;
  parentSymbol?: string;
  startLine: number;
  endLine: number;
};

const CODE_LANGUAGES = new Set([
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
]);

@Injectable()
export class StructureAwareChunker {
  constructor(private readonly fallbackChunker: SimpleChunker) {}

  chunk(text: string, options: ChunkOptions = {}): Chunk[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    if (options.strategy !== 'structure_aware') {
      return this.withFallbackMetadata(
        this.fallbackChunker.chunk(text, options),
        options,
        'explicit_fixed_strategy',
      );
    }

    try {
      if (this.isMarkdown(options)) {
        return this.chunkMarkdown(text, options);
      }

      if (options.language && CODE_LANGUAGES.has(options.language)) {
        return this.chunkCode(text, options);
      }

      return this.fallback(text, options, 'unsupported_language_or_mime');
    } catch (error) {
      return this.fallback(text, options, 'structure_parse_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private chunkMarkdown(text: string, options: ChunkOptions): Chunk[] {
    const sections = this.markdownSections(text);
    if (sections.length === 0) {
      return this.fallback(text, options, 'empty_markdown_structure');
    }

    const chunks: Chunk[] = [];
    for (const section of sections) {
      const sectionChunks = this.emitMarkdownSection(section, options);
      chunks.push(...sectionChunks);
    }

    return this.reindex(chunks);
  }

  private emitMarkdownSection(section: MarkdownSection, options: ChunkOptions): Chunk[] {
    const maxChars = options.maxChars || 3000;
    if (section.text.length <= maxChars) {
      return [
        this.createChunk(section.text, 0, section.startLine, section.endLine, 'markdown_section', {
          heading: section.heading,
          headingLevel: section.headingLevel,
          headingHierarchy: section.headingHierarchy,
          anchor: section.anchor,
          blockKinds: this.markdownBlockKinds(section.text),
        }),
      ];
    }

    const blocks = this.markdownBlocks(section);
    const chunks: Chunk[] = [];
    let currentText = '';
    let currentStart = section.startLine;
    let currentEnd = section.startLine;
    const flush = () => {
      if (!currentText.trim()) {
        return;
      }
      chunks.push(
        this.createChunk(currentText, 0, currentStart, currentEnd, 'markdown_block', {
          heading: section.heading,
          headingLevel: section.headingLevel,
          headingHierarchy: section.headingHierarchy,
          anchor: section.anchor,
          blockKinds: this.markdownBlockKinds(currentText),
        }),
      );
    };

    for (const block of blocks) {
      if (block.text.length > maxChars) {
        flush();
        currentText = '';
        for (const fallback of this.fallbackChunker.chunk(block.text, {
          ...options,
          strategy: 'fixed_char',
          overlapChars: 0,
        })) {
          const startLine = block.startLine + (fallback.startLine || 1) - 1;
          const endLine = block.startLine + (fallback.endLine || fallback.startLine || 1) - 1;
          chunks.push(
            this.createChunk(fallback.text, 0, startLine, endLine, 'markdown_block', {
              heading: section.heading,
              headingLevel: section.headingLevel,
              headingHierarchy: section.headingHierarchy,
              anchor: section.anchor,
              fallback: true,
              fallbackReason: 'oversized_markdown_block',
            }),
          );
        }
        continue;
      }

      if (currentText && currentText.length + block.text.length + 1 > maxChars) {
        flush();
        currentText = '';
      }

      if (!currentText) {
        currentStart = block.startLine;
      }
      currentText += currentText ? `\n${block.text}` : block.text;
      currentEnd = block.endLine;
    }

    flush();
    return chunks;
  }

  private chunkCode(text: string, options: ChunkOptions): Chunk[] {
    const symbols = this.codeSymbols(text, options.language || '');
    if (symbols.length === 0) {
      return this.fallback(text, options, 'no_supported_symbols');
    }

    const imports = this.extractImports(text, options.language || '');
    const exports = this.extractExports(text, options.language || '');
    const lines = text.split('\n');
    const chunks: Chunk[] = [];

    const firstSymbolLine = symbols[0].startLine;
    const preamble = lines.slice(0, firstSymbolLine - 1).join('\n').trim();
    if (preamble) {
      chunks.push(
        this.createChunk(preamble, 0, 1, firstSymbolLine - 1, 'code_preamble', {
          language: options.language,
          imports,
          exports,
        }),
      );
    }

    for (const symbol of symbols) {
      const symbolText = lines.slice(symbol.startLine - 1, symbol.endLine).join('\n');
      if (symbolText.length > (options.maxChars || 3000)) {
        for (const fallback of this.fallbackChunker.chunk(symbolText, {
          ...options,
          strategy: 'fixed_char',
          overlapChars: 0,
        })) {
          const startLine = symbol.startLine + (fallback.startLine || 1) - 1;
          const endLine = symbol.startLine + (fallback.endLine || fallback.startLine || 1) - 1;
          chunks.push(
            this.createChunk(fallback.text, 0, startLine, endLine, 'code_symbol', {
              language: options.language,
              symbol: symbol.name,
              symbolKind: symbol.kind,
              parentSymbol: symbol.parentSymbol,
              imports,
              exports,
              fallback: true,
              fallbackReason: 'oversized_symbol',
            }),
          );
        }
        continue;
      }

      chunks.push(
        this.createChunk(symbolText, 0, symbol.startLine, symbol.endLine, 'code_symbol', {
          language: options.language,
          symbol: symbol.name,
          symbolKind: symbol.kind,
          parentSymbol: symbol.parentSymbol,
          imports,
          exports,
        }),
      );
    }

    return this.reindex(chunks);
  }

  private markdownSections(text: string): MarkdownSection[] {
    const lines = text.split('\n');
    const sections: MarkdownSection[] = [];
    const hierarchy: Array<{ level: number; text: string }> = [];
    let currentStart = 1;
    let currentHeading: { level: number; text: string; hierarchy: string[]; anchor: string } | undefined;
    let inFence = false;

    const flush = (endLine: number) => {
      const sectionText = lines.slice(currentStart - 1, endLine).join('\n').trim();
      if (!sectionText) {
        return;
      }
      sections.push({
        text: sectionText,
        startLine: currentStart,
        endLine,
        heading: currentHeading?.text,
        headingLevel: currentHeading?.level,
        headingHierarchy: currentHeading?.hierarchy || [],
        anchor: currentHeading?.anchor,
      });
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
        inFence = !inFence;
      }
      const heading = !inFence ? line.match(/^(#{1,6})\s+(.+)$/) : null;
      if (!heading) {
        continue;
      }
      if (i + 1 > currentStart) {
        flush(i);
      }
      const level = heading[1].length;
      const headingText = heading[2].trim();
      while (hierarchy.length && hierarchy[hierarchy.length - 1].level >= level) {
        hierarchy.pop();
      }
      hierarchy.push({ level, text: headingText });
      currentHeading = {
        level,
        text: headingText,
        hierarchy: hierarchy.map((item) => item.text),
        anchor: this.slug(headingText),
      };
      currentStart = i + 1;
    }

    flush(lines.length);
    return sections;
  }

  private markdownBlocks(section: MarkdownSection) {
    const lines = section.text.split('\n');
    const blocks: Array<{ text: string; startLine: number; endLine: number }> = [];
    let current: string[] = [];
    let currentStart = section.startLine;
    let inFence = false;
    let blockKind = '';

    const flush = (relativeEnd: number) => {
      const text = current.join('\n').trim();
      if (text) {
        blocks.push({
          text,
          startLine: currentStart,
          endLine: section.startLine + relativeEnd,
        });
      }
      current = [];
      blockKind = '';
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const kind = this.markdownLineKind(line, inFence);
      const fenceToggle = /^\s*(```|~~~)/.test(line);
      if (!current.length) {
        currentStart = section.startLine + i;
        blockKind = kind;
      }

      const kindChanged =
        current.length > 0 &&
        !inFence &&
        kind !== blockKind &&
        kind !== 'blank' &&
        blockKind !== 'blank';
      if (kindChanged) {
        flush(i - 1);
        currentStart = section.startLine + i;
        blockKind = kind;
      }

      current.push(line);
      if (fenceToggle) {
        inFence = !inFence;
      }
      if (!inFence && kind === 'blank') {
        flush(i);
      }
    }

    flush(lines.length - 1);
    return blocks;
  }

  private markdownLineKind(line: string, inFence: boolean) {
    if (inFence || /^\s*(```|~~~)/.test(line)) {
      return 'code_fence';
    }
    if (!line.trim()) {
      return 'blank';
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      return 'table';
    }
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      return 'list';
    }
    if (/^#{1,6}\s+/.test(line)) {
      return 'heading';
    }
    return 'paragraph';
  }

  private markdownBlockKinds(text: string): string[] {
    const kinds = new Set<string>();
    let inFence = false;
    for (const line of text.split('\n')) {
      const kind = this.markdownLineKind(line, inFence);
      if (kind !== 'blank') {
        kinds.add(kind);
      }
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
      }
    }
    return [...kinds].sort();
  }

  private codeSymbols(text: string, language: string): CodeSymbol[] {
    const lines = text.split('\n');
    const starts: Array<Omit<CodeSymbol, 'endLine'>> = [];
    const parentStack: Array<{ name: string; indent: number; endLine?: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const match = this.matchCodeSymbol(lines[i], language);
      if (!match) {
        continue;
      }
      const indent = lines[i].match(/^\s*/)?.[0].length || 0;
      while (parentStack.length && parentStack[parentStack.length - 1].indent >= indent) {
        parentStack.pop();
      }
      const parentSymbol = parentStack[parentStack.length - 1]?.name;
      starts.push({
        ...match,
        parentSymbol,
        startLine: i + 1,
      });
      if (match.kind === 'class' || match.kind === 'interface' || match.kind === 'impl') {
        parentStack.push({ name: match.name, indent });
      }
    }

    return starts.map((symbol, index) => ({
      ...symbol,
      endLine: this.findSymbolEnd(lines, language, symbol.startLine, starts[index + 1]?.startLine),
    }));
  }

  private matchCodeSymbol(line: string, language: string): { name: string; kind: string } | null {
    if (language === 'python') {
      const match = line.match(/^\s*(async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/);
      return match ? { kind: match[1].includes('class') ? 'class' : 'function', name: match[2] } : null;
    }

    if (language === 'go') {
      const match = line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      return match ? { kind: 'function', name: match[1] } : null;
    }

    if (language === 'rust') {
      const match = line.match(/^\s*(?:pub\s+)?(?:async\s+)?(fn|struct|enum|trait|impl)\s+([A-Za-z_][A-Za-z0-9_]*)?/);
      if (!match) {
        return null;
      }
      return { kind: match[1] === 'fn' ? 'function' : match[1], name: match[2] || 'impl' };
    }

    const ts = line.match(
      /^\s*(?:export\s+)?(?:default\s+)?(?:(?:async\s+)?function|class|interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
    );
    if (ts) {
      const kind = line.includes('class ')
        ? 'class'
        : line.includes('interface ')
          ? 'interface'
          : line.includes('type ')
            ? 'type'
            : 'function';
      return { kind, name: ts[1] };
    }

    const arrow = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/);
    if (arrow) {
      return { kind: 'function', name: arrow[1] };
    }

    const classLike = line.match(/^\s*(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|static\s+)*(class|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (classLike) {
      return { kind: classLike[1], name: classLike[2] };
    }

    const method = line.match(/^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*[A-Za-z0-9_<>,\[\]\s:*&]+\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^;]*\)\s*\{/);
    if (method) {
      return { kind: 'method', name: method[1] };
    }

    return null;
  }

  private findSymbolEnd(lines: string[], language: string, startLine: number, nextStartLine?: number): number {
    if (language === 'python') {
      return (nextStartLine || lines.length + 1) - 1;
    }

    let depth = 0;
    let sawBrace = false;
    for (let i = startLine - 1; i < lines.length; i++) {
      const scrubbed = lines[i].replace(/(["'`]).*?\1/g, '');
      for (const char of scrubbed) {
        if (char === '{') {
          depth++;
          sawBrace = true;
        } else if (char === '}') {
          depth--;
        }
      }
      if (sawBrace && depth <= 0 && i >= startLine - 1) {
        return i + 1;
      }
      if (!sawBrace && nextStartLine && i + 1 >= nextStartLine - 1) {
        return nextStartLine - 1;
      }
    }
    return (nextStartLine || lines.length + 1) - 1;
  }

  private extractImports(text: string, language: string): string[] {
    const refs = new Set<string>();
    const patterns =
      language === 'python'
        ? [/^\s*from\s+([A-Za-z0-9_./-]+)\s+import\s+/gm, /^\s*import\s+([A-Za-z0-9_.,\s-]+)/gm]
        : [/^\s*import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/gm, /^\s*use\s+([^;]+);/gm, /^\s*#include\s+[<"]([^>"]+)[>"]/gm];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        for (const part of match[1].split(',')) {
          const ref = part.trim();
          if (ref) {
            refs.add(ref);
          }
        }
      }
    }
    return [...refs].sort();
  }

  private extractExports(text: string, language: string): string[] {
    if (language === 'python') {
      return [];
    }
    const refs = new Set<string>();
    for (const match of text.matchAll(/^\s*export\s+(?:default\s+)?(?:async\s+)?(?:class|function|interface|type|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm)) {
      refs.add(match[1]);
    }
    return [...refs].sort();
  }

  private createChunk(
    text: string,
    index: number,
    startLine: number,
    endLine: number,
    kind: ChunkKind,
    metadata: Record<string, unknown>,
  ): Chunk {
    const trimmed = text.trim();
    const structureHash = hashStable({
      kind,
      startLine,
      endLine,
      heading: metadata.heading,
      symbol: metadata.symbol,
      symbolKind: metadata.symbolKind,
      parentSymbol: metadata.parentSymbol,
    });
    const contentHash = this.hash(trimmed);
    return {
      text: trimmed,
      chunkIndex: index,
      charCount: trimmed.length,
      tokenEstimate: Math.ceil(trimmed.length / 4),
      startLine,
      endLine,
      strategy: kind,
      chunkerVersion: STRUCTURE_AWARE_CHUNKER_VERSION,
      compatibilityHash: STRUCTURE_AWARE_CHUNKER_COMPATIBILITY_HASH,
      stableChunkKey: `${kind}:${metadata.symbol || metadata.anchor || startLine}:${structureHash.slice(0, 16)}`,
      metadata: {
        ...metadata,
        chunkerStrategy: kind,
        chunkerVersion: STRUCTURE_AWARE_CHUNKER_VERSION,
        chunkerCompatibilityHash: STRUCTURE_AWARE_CHUNKER_COMPATIBILITY_HASH,
        sourceRange: { startLine, endLine },
        stableContentHash: contentHash,
        stableStructureHash: structureHash,
      },
    };
  }

  private decorateChunk(chunk: Chunk, kind: ChunkKind, metadata: Record<string, unknown>): Chunk {
    return this.createChunk(chunk.text, chunk.chunkIndex, chunk.startLine || 1, chunk.endLine || 1, kind, metadata);
  }

  private fallback(
    text: string,
    options: ChunkOptions,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Chunk[] {
    return this.withFallbackMetadata(
      this.fallbackChunker.chunk(text, { ...options, strategy: 'fixed_char' }),
      options,
      reason,
      extra,
    );
  }

  private withFallbackMetadata(
    chunks: Chunk[],
    options: ChunkOptions,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Chunk[] {
    return this.reindex(
      chunks.map((chunk) =>
        this.decorateChunk(chunk, 'fixed_fallback', {
          language: options.language,
          fallback: true,
          fallbackReason: reason,
          validationWarnings: [
            {
              code: 'structure_chunker_fallback',
              severity: 'warning',
              message: 'Structure-aware chunking fell back to deterministic fixed-char chunking.',
              metadata: {
                reason,
                ...extra,
              },
            },
          ],
        }),
      ),
    );
  }

  private reindex(chunks: Chunk[]): Chunk[] {
    return chunks
      .filter((chunk) => chunk.text.trim().length > 0)
      .map((chunk, index) => ({
        ...chunk,
        chunkIndex: index,
      }));
  }

  private isMarkdown(options: ChunkOptions) {
    return options.language === 'markdown' || options.mimeType === 'text/markdown' || /\.(md|markdown)$/i.test(options.path || '');
  }

  private slug(value: string) {
    return value
      .toLowerCase()
      .replace(/[`*_~[\]().,!?:;"']/g, '')
      .replace(/[^a-z0-9а-яё]+/giu, '-')
      .replace(/^-+|-+$/g, '');
  }

  private hash(input: string) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  }
}

function hashStable(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
