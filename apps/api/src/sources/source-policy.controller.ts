import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UpdateSourcePolicyDto } from './dto/update-source.dto';
import { SourcesService } from './sources.service';

@ApiTags('source-policy')
@Controller()
export class SourcePolicyController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Get('workspaces/:identifier/sources/:sourceId/policy')
  @ApiOperation({ summary: 'Inspect workspace source truth and sync policy' })
  @ApiResponse({ status: 200, description: 'Source policy returned' })
  async getWorkspaceSourcePolicy(
    @Param('identifier') identifier: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.sourcesService.getPolicy(identifier, sourceId);
  }

  @Put('workspaces/:identifier/sources/:sourceId/policy')
  @ApiOperation({ summary: 'Update workspace source truth and sync policy' })
  @ApiResponse({ status: 200, description: 'Source policy updated' })
  async updateWorkspaceSourcePolicy(
    @Param('identifier') identifier: string,
    @Param('sourceId') sourceId: string,
    @Body() dto: UpdateSourcePolicyDto,
  ) {
    return this.sourcesService.updatePolicy(identifier, sourceId, dto);
  }

  @Get('knowledge-bases/:identifier/sources/:sourceId/policy')
  @ApiOperation({ summary: 'Inspect knowledge-base source truth and sync policy' })
  @ApiResponse({ status: 200, description: 'Source policy returned' })
  async getKnowledgeBaseSourcePolicy(
    @Param('identifier') identifier: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.sourcesService.getPolicy(identifier, sourceId);
  }

  @Put('knowledge-bases/:identifier/sources/:sourceId/policy')
  @ApiOperation({ summary: 'Update knowledge-base source truth and sync policy' })
  @ApiResponse({ status: 200, description: 'Source policy updated' })
  async updateKnowledgeBaseSourcePolicy(
    @Param('identifier') identifier: string,
    @Param('sourceId') sourceId: string,
    @Body() dto: UpdateSourcePolicyDto,
  ) {
    return this.sourcesService.updatePolicy(identifier, sourceId, dto);
  }
}
