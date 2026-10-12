import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { SourcesService } from './sources.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';

@ApiTags('sources')
@Controller('sources')
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new source' })
  @ApiResponse({ status: 201, description: 'Source created' })
  @ApiResponse({ status: 400, description: 'Invalid source type or URI' })
  async create(@Body() dto: CreateSourceDto) {
    return this.sourcesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all sources' })
  @ApiQuery({ name: 'knowledgeBaseId', required: false, description: 'Filter by knowledge base' })
  @ApiQuery({
    name: 'knowledgeBaseSlug',
    required: false,
    description: 'Filter by knowledge base slug',
  })
  @ApiResponse({ status: 200, description: 'Return all sources' })
  async findAll(
    @Query('knowledgeBaseId') knowledgeBaseId?: string,
    @Query('knowledgeBaseSlug') knowledgeBaseSlug?: string,
  ) {
    return this.sourcesService.findAll(knowledgeBaseId, knowledgeBaseSlug);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a source by ID' })
  @ApiResponse({ status: 200, description: 'Return the source' })
  @ApiResponse({ status: 404, description: 'Source not found' })
  async findOne(@Param('id') id: string) {
    return this.sourcesService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a source' })
  @ApiResponse({ status: 200, description: 'Source updated' })
  @ApiResponse({ status: 404, description: 'Source not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateSourceDto) {
    return this.sourcesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a source' })
  @ApiResponse({ status: 200, description: 'Source deleted' })
  @ApiResponse({ status: 404, description: 'Source not found' })
  @ApiResponse({ status: 400, description: 'Cannot delete source with dependents' })
  async remove(@Param('id') id: string): Promise<{ status: string }> {
    await this.sourcesService.remove(id);
    return { status: 'deleted' };
  }
}
