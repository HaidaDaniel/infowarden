import { Module } from '@nestjs/common';
import { ChunkingController } from './chunking.controller';
import { ChunkingService } from './chunking.service';
import { SimpleChunker } from './simple.chunker';
import { StructureAwareChunker } from './structure-aware.chunker';

@Module({
  controllers: [ChunkingController],
  providers: [ChunkingService, SimpleChunker, StructureAwareChunker],
  exports: [ChunkingService, SimpleChunker, StructureAwareChunker],
})
export class ChunkingModule {}
