import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { SearchRequest } from '../retrieval/retrieval.service';
import { AdminReadModelsService } from './admin-read-models.service';

@ApiTags('admin')
@Controller('admin')
export class AdminReadModelsController {
  constructor(private readonly adminReadModelsService: AdminReadModelsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get admin dashboard summary' })
  @ApiResponse({ status: 200, description: 'Dashboard summary returned' })
  async getDashboard() {
    return this.adminReadModelsService.getDashboard();
  }

  @Get('system')
  @ApiOperation({ summary: 'Get system health and queue observability snapshot' })
  @ApiResponse({ status: 200, description: 'System observability snapshot returned' })
  async getSystemOverview() {
    return this.adminReadModelsService.getSystemOverview();
  }

  @Get('knowledge-bases')
  @ApiOperation({ summary: 'List admin knowledge base overviews' })
  @ApiResponse({ status: 200, description: 'Knowledge base overviews returned' })
  async listKnowledgeBaseOverviews() {
    return this.adminReadModelsService.listKnowledgeBaseOverviews();
  }

  @Get('knowledge-bases/:identifier')
  @ApiOperation({ summary: 'Get an admin knowledge base overview by ID or slug' })
  @ApiResponse({ status: 200, description: 'Knowledge base overview returned' })
  async getKnowledgeBaseOverview(@Param('identifier') identifier: string) {
    return this.adminReadModelsService.getKnowledgeBaseOverview(identifier);
  }

  @Post('knowledge-bases/:identifier/retrieval-playground')
  @ApiOperation({ summary: 'Run retrieval trace and context-package preview for Studio' })
  @ApiResponse({ status: 200, description: 'Retrieval playground trace returned' })
  async runRetrievalPlayground(
    @Param('identifier') identifier: string,
    @Body()
    body: {
      query: string;
      topK?: number;
      limit?: number;
      scoreThreshold?: number;
      profileKey?: string;
      tokenBudget?: number;
      filters?: Record<string, unknown>;
      pathPrefix?: string;
      language?: string;
      branch?: string;
      rerank?: SearchRequest['rerank'];
    },
  ) {
    return this.adminReadModelsService.runRetrievalPlayground(identifier, {
      query: body.query,
      topK: body.topK,
      limit: body.limit,
      scoreThreshold: body.scoreThreshold,
      profileKey: body.profileKey,
      tokenBudget: body.tokenBudget,
      filters: {
        pathPrefix: body.pathPrefix || (body.filters?.pathPrefix as string | undefined),
        language: body.language || (body.filters?.language as string | undefined),
        branch: body.branch || (body.filters?.branch as string | undefined),
        metadata: body.filters?.metadata as Record<string, unknown> | undefined,
      },
      rerank: body.rerank,
    });
  }

  @Get('jobs/recent')
  @ApiOperation({ summary: 'List recent admin indexing jobs' })
  @ApiQuery({ name: 'knowledgeBaseId', required: false, description: 'Filter by knowledge base id' })
  @ApiQuery({
    name: 'knowledgeBaseSlug',
    required: false,
    description: 'Filter by knowledge base slug',
  })
  @ApiQuery({ name: 'sourceId', required: false, description: 'Filter by source id' })
  @ApiQuery({ name: 'limit', required: false, description: 'Result limit, default 10, max 50' })
  @ApiResponse({ status: 200, description: 'Recent indexing jobs returned' })
  async getRecentJobs(
    @Query('knowledgeBaseId') knowledgeBaseId?: string,
    @Query('knowledgeBaseSlug') knowledgeBaseSlug?: string,
    @Query('sourceId') sourceId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminReadModelsService.getRecentJobs({
      knowledgeBaseId,
      knowledgeBaseSlug,
      sourceId,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }
}
