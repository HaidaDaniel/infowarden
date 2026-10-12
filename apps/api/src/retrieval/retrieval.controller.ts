import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RetrievalService, SearchRequest } from './retrieval.service';

type SearchBody = {
  query: string;
  topK?: number;
  limit?: number;
  scoreThreshold?: number;
  profileKey?: string;
  tokenBudget?: number;
  filters?: Record<string, unknown>;
  rerank?: SearchRequest['rerank'];
  pathPrefix?: string;
  language?: string;
  branch?: string;
};

@ApiTags('retrieval')
@Controller(['knowledge-bases', 'workspaces'])
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Post(':id/search')
  @ApiOperation({ summary: 'Search a knowledge base' })
  @ApiResponse({ status: 200, description: 'Return search results' })
  @ApiResponse({ status: 404, description: 'Knowledge base not found' })
  @ApiResponse({ status: 400, description: 'No active index version' })
  async search(
    @Param('id') knowledgeBaseId: string,
    @Body() body: SearchBody,
  ) {
    return this.retrievalService.search(knowledgeBaseId, this.toSearchRequest(body));
  }

  @Post(':id/search-code')
  @ApiOperation({ summary: 'Search code in a knowledge base' })
  @ApiResponse({ status: 200, description: 'Return code search results' })
  @ApiResponse({ status: 404, description: 'Knowledge base not found' })
  @ApiResponse({ status: 400, description: 'No active index version' })
  async searchCode(
    @Param('id') knowledgeBaseId: string,
    @Body() body: SearchBody,
  ) {
    return this.retrievalService.searchCode(knowledgeBaseId, this.toSearchRequest(body));
  }

  @Post(':id/context-package')
  @ApiOperation({ summary: 'Build a context package for a knowledge base query' })
  @ApiResponse({ status: 200, description: 'Return a grouped context package' })
  @ApiResponse({ status: 404, description: 'Knowledge base not found' })
  @ApiResponse({ status: 400, description: 'No active index version' })
  async getContextPackage(
    @Param('id') knowledgeBaseId: string,
    @Body() body: SearchBody,
  ) {
    return this.retrievalService.getContextPackage(knowledgeBaseId, this.toSearchRequest(body));
  }

  @Post(':id/retrieval-trace')
  @ApiOperation({ summary: 'Return retrieval trace diagnostics for a knowledge base query' })
  @ApiResponse({ status: 200, description: 'Return retrieval trace stages and final context package' })
  async getRetrievalTrace(
    @Param('id') knowledgeBaseId: string,
    @Body() body: SearchBody,
  ) {
    return this.retrievalService.traceRetrieval(knowledgeBaseId, this.toSearchRequest(body));
  }

  @Post(':id/search-memory')
  @ApiOperation({ summary: 'Search memory entries in a knowledge base compatibility workspace' })
  @ApiResponse({ status: 200, description: 'Return memory search results' })
  async searchMemory(
    @Param('id') knowledgeBaseId: string,
    @Body() body: SearchBody,
  ) {
    return this.retrievalService.searchMemory(knowledgeBaseId, this.toSearchRequest(body));
  }

  @Get(':id/recent-decisions')
  @ApiOperation({ summary: 'Return recent decision notes for a knowledge base compatibility workspace' })
  @ApiResponse({ status: 200, description: 'Return recent decision notes' })
  async getRecentDecisions(
    @Param('id') knowledgeBaseId: string,
    @Query('limit') limit?: string,
  ) {
    return this.retrievalService.getRecentDecisions(
      knowledgeBaseId,
      limit ? Number(limit) : undefined,
    );
  }

  private toSearchRequest(body: SearchBody): SearchRequest {
    const filters = {
      ...(body.filters || {}),
    } as Record<string, unknown>;

    return {
      query: body.query,
      topK: body.topK,
      limit: body.limit,
      scoreThreshold: body.scoreThreshold,
      profileKey: body.profileKey,
      tokenBudget: body.tokenBudget,
      rerank: body.rerank,
      filters: {
        pathPrefix: body.pathPrefix || (filters.pathPrefix as string | undefined),
        language: body.language || (filters.language as string | undefined),
        branch: body.branch || (filters.branch as string | undefined),
        metadata: filters.metadata as Record<string, unknown> | undefined,
      },
    };
  }
}
