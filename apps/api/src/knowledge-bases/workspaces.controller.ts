import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { KnowledgeBasesService } from './knowledge-bases.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly knowledgeBasesService: KnowledgeBasesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new workspace' })
  @ApiResponse({ status: 201, description: 'Workspace created' })
  async create(@Body() dto: CreateKnowledgeBaseDto) {
    return this.knowledgeBasesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all workspaces' })
  @ApiResponse({ status: 200, description: 'Return all workspaces' })
  async findAll() {
    return this.knowledgeBasesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a workspace by ID or slug' })
  @ApiResponse({ status: 200, description: 'Return the workspace' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  async findOne(@Param('id') id: string) {
    return this.knowledgeBasesService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a workspace by ID or slug' })
  @ApiResponse({ status: 200, description: 'Workspace updated' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateKnowledgeBaseDto) {
    return this.knowledgeBasesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a workspace by ID or slug' })
  @ApiResponse({ status: 200, description: 'Workspace deleted' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  @ApiResponse({ status: 400, description: 'Cannot delete workspace with dependents' })
  async remove(@Param('id') id: string): Promise<{ status: string }> {
    await this.knowledgeBasesService.remove(id);
    return { status: 'deleted' };
  }
}
