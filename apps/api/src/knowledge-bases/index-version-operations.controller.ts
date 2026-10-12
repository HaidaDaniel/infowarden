import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IndexVersionOperationsService } from './index-version-operations.service';

@ApiTags('index-versions')
@Controller()
export class IndexVersionOperationsController {
  constructor(private readonly indexVersionOperationsService: IndexVersionOperationsService) {}

  @Get('workspaces/:identifier/index-versions/compare')
  @ApiOperation({ summary: 'Compare two index versions for a workspace' })
  @ApiResponse({ status: 200, description: 'Index version comparison returned' })
  async compareWorkspaceVersions(
    @Param('identifier') identifier: string,
    @Query('base') base: string,
    @Query('target') target: string,
  ) {
    return this.indexVersionOperationsService.compare(identifier, base, target);
  }

  @Post('workspaces/:identifier/index-versions/:indexVersionId/rollback')
  @ApiOperation({ summary: 'Rollback a workspace to a safe index version' })
  @ApiResponse({ status: 201, description: 'Index rollback applied when safe' })
  async rollbackWorkspaceVersion(
    @Param('identifier') identifier: string,
    @Param('indexVersionId') indexVersionId: string,
    @Body() _body: Record<string, unknown> = {},
  ) {
    return this.indexVersionOperationsService.rollback(identifier, indexVersionId);
  }

  @Get('knowledge-bases/:identifier/index-versions/compare')
  @ApiOperation({ summary: 'Compare two index versions for a knowledge-base workspace' })
  @ApiResponse({ status: 200, description: 'Index version comparison returned' })
  async compareKnowledgeBaseVersions(
    @Param('identifier') identifier: string,
    @Query('base') base: string,
    @Query('target') target: string,
  ) {
    return this.indexVersionOperationsService.compare(identifier, base, target);
  }

  @Post('knowledge-bases/:identifier/index-versions/:indexVersionId/rollback')
  @ApiOperation({ summary: 'Rollback a knowledge-base workspace to a safe index version' })
  @ApiResponse({ status: 201, description: 'Index rollback applied when safe' })
  async rollbackKnowledgeBaseVersion(
    @Param('identifier') identifier: string,
    @Param('indexVersionId') indexVersionId: string,
    @Body() _body: Record<string, unknown> = {},
  ) {
    return this.indexVersionOperationsService.rollback(identifier, indexVersionId);
  }
}
