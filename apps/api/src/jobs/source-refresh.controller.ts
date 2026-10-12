import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RefreshSourceDto } from './dto/refresh-source.dto';
import { SourceRefreshService } from './source-refresh.service';

@ApiTags('source-refresh')
@Controller()
export class SourceRefreshController {
  constructor(private readonly sourceRefreshService: SourceRefreshService) {}

  @Post('workspaces/:identifier/sources/:sourceId/refresh')
  @ApiOperation({ summary: 'Refresh a workspace source through the indexing queue' })
  @ApiResponse({ status: 201, description: 'Refresh job enqueued or dry-run plan returned' })
  async refreshWorkspaceSource(
    @Param('identifier') identifier: string,
    @Param('sourceId') sourceId: string,
    @Body() dto: RefreshSourceDto,
  ) {
    return this.sourceRefreshService.refresh(identifier, sourceId, dto);
  }

  @Post('knowledge-bases/:identifier/sources/:sourceId/refresh')
  @ApiOperation({ summary: 'Refresh a knowledge-base source through the indexing queue' })
  @ApiResponse({ status: 201, description: 'Refresh job enqueued or dry-run plan returned' })
  async refreshKnowledgeBaseSource(
    @Param('identifier') identifier: string,
    @Param('sourceId') sourceId: string,
    @Body() dto: RefreshSourceDto,
  ) {
    return this.sourceRefreshService.refresh(identifier, sourceId, dto);
  }
}
