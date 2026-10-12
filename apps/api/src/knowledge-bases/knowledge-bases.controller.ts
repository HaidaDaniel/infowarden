import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { KnowledgeBasesService } from './knowledge-bases.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';

@ApiTags('knowledge-bases')
@Controller('knowledge-bases')
export class KnowledgeBasesController {
  constructor(private readonly knowledgeBasesService: KnowledgeBasesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new knowledge base' })
  @ApiResponse({ status: 201, description: 'Knowledge base created' })
  async create(@Body() dto: CreateKnowledgeBaseDto) {
    return this.knowledgeBasesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all knowledge bases' })
  @ApiResponse({ status: 200, description: 'Return all knowledge bases' })
  async findAll() {
    return this.knowledgeBasesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a knowledge base by ID' })
  @ApiResponse({ status: 200, description: 'Return the knowledge base' })
  @ApiResponse({ status: 404, description: 'Knowledge base not found' })
  async findOne(@Param('id') id: string) {
    return this.knowledgeBasesService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a knowledge base' })
  @ApiResponse({ status: 200, description: 'Knowledge base updated' })
  @ApiResponse({ status: 404, description: 'Knowledge base not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateKnowledgeBaseDto) {
    return this.knowledgeBasesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a knowledge base' })
  @ApiResponse({ status: 200, description: 'Knowledge base deleted' })
  @ApiResponse({ status: 404, description: 'Knowledge base not found' })
  @ApiResponse({ status: 400, description: 'Cannot delete knowledge base with dependents' })
  async remove(@Param('id') id: string): Promise<{ status: string }> {
    await this.knowledgeBasesService.remove(id);
    return { status: 'deleted' };
  }
}
