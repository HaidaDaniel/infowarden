import { Injectable } from '@nestjs/common';

export interface Chunk {
  text: string;
  chunkIndex: number;
  charCount: number;
  tokenEstimate?: number;
  startLine?: number;
  endLine?: number;
  strategy?: string;
  chunkerVersion?: string;
  compatibilityHash?: string;
  stableChunkKey?: string;
  metadata?: Record<string, unknown>;
}

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
  strategy?: 'fixed_char' | 'fixed_token' | 'structure_aware';
  language?: string;
  mimeType?: string;
  path?: string;
}

@Injectable()
export class SimpleChunker {
  private readonly DEFAULT_MAX_CHARS = 3000;
  private readonly DEFAULT_OVERLAP_CHARS = 300;

  chunk(text: string, options: ChunkOptions = {}): Chunk[] {
    const {
      maxChars = this.DEFAULT_MAX_CHARS,
      overlapChars = this.DEFAULT_OVERLAP_CHARS,
      strategy = 'fixed_char',
    } = options;

    if (!text || text.trim().length === 0) {
      return [];
    }

    const lines = text.split('\n');
    const chunks: Chunk[] = [];
    let currentChunkText = '';
    let chunkIndex = 0;
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineWithNewline = i < lines.length - 1 ? line + '\n' : line;

      if (currentChunkText.length + lineWithNewline.length > maxChars && currentChunkText.length > 0) {
        const chunk = this.createChunk(currentChunkText, chunkIndex, startLine, i, strategy);
        if (chunk) {
          chunks.push(chunk);
        }

        const overlap = this.getOverlapText(currentChunkText, overlapChars);
        currentChunkText = overlap + lineWithNewline;
        startLine = i;
        chunkIndex++;
      } else {
        currentChunkText += lineWithNewline;
      }
    }

    if (currentChunkText.trim().length > 0) {
      const chunk = this.createChunk(currentChunkText, chunkIndex, startLine, lines.length - 1, strategy);
      if (chunk) {
        chunks.push(chunk);
      }
    }

    return chunks;
  }

  private createChunk(
    text: string,
    index: number,
    startLine: number,
    endLine: number,
    strategy: string,
  ): Chunk | null {
    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      return null;
    }

    return {
      text: trimmedText,
      chunkIndex: index,
      charCount: trimmedText.length,
      tokenEstimate: this.estimateTokens(trimmedText),
      startLine: startLine + 1,
      endLine: endLine + 1,
      strategy: strategy || 'fixed_char',
    };
  }

  private getOverlapText(chunkText: string, overlapChars: number): string {
    if (overlapChars <= 0 || chunkText.length <= overlapChars) {
      return '';
    }

    const overlapText = chunkText.slice(-overlapChars);
    const lastNewline = overlapText.lastIndexOf('\n');
    
    if (lastNewline > 0) {
      return overlapText.slice(lastNewline + 1);
    }

    return overlapText;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
