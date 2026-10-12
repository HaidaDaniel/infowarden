import { Controller, Post, Body, Delete, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { VectorIndexService } from './vector-index.service';

@ApiTags('vector-index')
@Controller('vector-index')
export class VectorIndexController {
  constructor(private readonly vectorIndexService: VectorIndexService) {}

  @Post('collection')
  @ApiOperation({ summary: 'Create or ensure a vector collection exists' })
  @ApiResponse({ status: 200, description: 'Collection created or exists' })
  async createCollection(@Body() body: { collectionName: string; vectorSize: number }): Promise<{ status: string }> {
    await this.vectorIndexService.initializeCollection(body.collectionName, body.vectorSize);
    return { status: 'ok' };
  }

  @Post('upsert')
  @ApiOperation({ summary: 'Upsert vectors into a collection' })
  @ApiResponse({ status: 200, description: 'Vectors upserted' })
  async upsert(@Body() body: { collectionName: string; vectors: number[][]; payloads: any[] }) {
    await this.vectorIndexService.upsert(body.collectionName, body.vectors, body.payloads);
    return { status: 'ok', count: body.vectors.length };
  }

  @Delete('document')
  @ApiOperation({ summary: 'Delete vectors by document ID' })
  @ApiResponse({ status: 200, description: 'Vectors deleted' })
  async deleteByDocumentId(
    @Query('collectionName') collectionName: string,
    @Query('documentId') documentId: string,
  ): Promise<{ status: string }> {
    await this.vectorIndexService.deleteByDocumentId(collectionName, documentId);
    return { status: 'deleted' };
  }

  @Delete('index-version')
  @ApiOperation({ summary: 'Delete vectors by index version ID' })
  @ApiResponse({ status: 200, description: 'Vectors deleted' })
  async deleteByIndexVersionId(
    @Query('collectionName') collectionName: string,
    @Query('indexVersionId') indexVersionId: string,
  ): Promise<{ status: string }> {
    await this.vectorIndexService.deleteByIndexVersionId(collectionName, indexVersionId);
    return { status: 'deleted' };
  }

  @Post('search')
  @ApiOperation({ summary: 'Search vectors in a collection' })
  @ApiResponse({ status: 200, description: 'Search results' })
  async search(@Body() body: { collectionName: string; queryVector: number[]; limit?: number }) {
    const results = await this.vectorIndexService.search(body.collectionName, body.queryVector, body.limit || 10);
    return { results, count: results.length };
  }
}
