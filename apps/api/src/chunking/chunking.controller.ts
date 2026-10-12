import { Controller, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChunkingService } from './chunking.service';

@ApiTags('chunking')
@Controller('chunking')
export class ChunkingController {
  constructor(private readonly chunkingService: ChunkingService) {}

  @Post('chunk')
  @ApiOperation({ summary: 'Chunk text into segments' })
  @ApiResponse({ status: 200, description: 'Return chunks' })
  chunk(@Body() body: { text: string; maxChars?: number; overlapChars?: number }) {
    const chunks = this.chunkingService.chunk(body.text, {
      maxChars: body.maxChars,
      overlapChars: body.overlapChars,
    });
    return { chunks, count: chunks.length };
  }
}
