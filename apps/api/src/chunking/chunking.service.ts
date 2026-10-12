import { Injectable } from '@nestjs/common';
import { SimpleChunker, Chunk, ChunkOptions } from './simple.chunker';
import { StructureAwareChunker } from './structure-aware.chunker';

@Injectable()
export class ChunkingService {
  constructor(
    private readonly chunker: SimpleChunker,
    private readonly structureAwareChunker: StructureAwareChunker,
  ) {}

  chunk(text: string, options?: ChunkOptions): Chunk[] {
    if (options?.strategy === 'structure_aware') {
      return this.structureAwareChunker.chunk(text, options);
    }
    return this.chunker.chunk(text, options);
  }
}
