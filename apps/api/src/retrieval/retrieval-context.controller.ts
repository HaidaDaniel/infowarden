import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RetrievalService } from './retrieval.service';

@ApiTags('retrieval')
@Controller()
export class RetrievalContextController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Get('documents/:id')
  @ApiOperation({ summary: 'Get document context' })
  @ApiResponse({ status: 200, description: 'Return document context' })
  @ApiResponse({ status: 404, description: 'Document or chunk not found' })
  @ApiQuery({ name: 'chunkId', required: false, description: 'Optional chunk ID within the document' })
  @ApiQuery({ name: 'startLine', required: false, description: 'Optional start line for context extraction' })
  @ApiQuery({ name: 'endLine', required: false, description: 'Optional end line for context extraction' })
  @ApiQuery({ name: 'maxChars', required: false, description: 'Optional character clamp for returned text' })
  async getDocumentContext(
    @Param('id') documentId: string,
    @Query('chunkId') chunkId?: string,
    @Query('startLine') startLine?: string,
    @Query('endLine') endLine?: string,
    @Query('maxChars') maxChars?: string,
  ) {
    return this.retrievalService.getDocumentContext({
      documentId,
      chunkId,
      startLine: parseOptionalNumber(startLine),
      endLine: parseOptionalNumber(endLine),
      maxChars: parseOptionalNumber(maxChars),
    });
  }

  @Get('chunks/:id/neighbors')
  @ApiOperation({ summary: 'Get neighboring chunks for a chunk' })
  @ApiResponse({ status: 200, description: 'Return neighboring chunks' })
  @ApiResponse({ status: 404, description: 'Chunk not found' })
  @ApiQuery({ name: 'before', required: false, description: 'Number of chunks before the target chunk' })
  @ApiQuery({ name: 'after', required: false, description: 'Number of chunks after the target chunk' })
  async getChunkNeighbors(
    @Param('id') chunkId: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
  ) {
    return this.retrievalService.getChunkNeighbors(
      chunkId,
      parseOptionalNumber(before),
      parseOptionalNumber(after),
    );
  }
}

function parseOptionalNumber(value?: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
