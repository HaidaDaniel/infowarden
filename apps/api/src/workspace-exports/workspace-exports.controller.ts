import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WorkspaceImportDto } from './dto/workspace-import.dto';
import { WorkspaceExportsService } from './workspace-exports.service';

@ApiTags('workspace-exports')
@Controller()
export class WorkspaceExportsController {
  constructor(private readonly workspaceExportsService: WorkspaceExportsService) {}

  @Get('workspaces/:identifier/export-manifest')
  @ApiOperation({ summary: 'Produce a portable workspace export manifest' })
  @ApiResponse({ status: 200, description: 'Workspace export manifest returned' })
  async getWorkspaceExportManifest(@Param('identifier') identifier: string) {
    return this.workspaceExportsService.buildManifest(identifier);
  }

  @Get('knowledge-bases/:identifier/export-manifest')
  @ApiOperation({
    summary: 'Produce a portable export manifest for a knowledge-base compatibility workspace',
  })
  @ApiResponse({ status: 200, description: 'Workspace export manifest returned' })
  async getKnowledgeBaseExportManifest(@Param('identifier') identifier: string) {
    return this.workspaceExportsService.buildManifest(identifier);
  }

  @Post('workspaces/import-manifest/validate')
  @ApiOperation({ summary: 'Validate a workspace export manifest before restore apply' })
  @ApiResponse({ status: 200, description: 'Workspace import validation result returned' })
  async validateWorkspaceImport(@Body() dto: WorkspaceImportDto) {
    return this.workspaceExportsService.validateImport(dto);
  }

  @Post('workspaces/import-manifest/apply')
  @ApiOperation({ summary: 'Apply a conservative workspace restore from an export manifest' })
  @ApiResponse({ status: 201, description: 'Workspace restore applied' })
  async applyWorkspaceImport(@Body() dto: WorkspaceImportDto) {
    return this.workspaceExportsService.applyImport(dto);
  }

  @Post('knowledge-bases/import-manifest/validate')
  @ApiOperation({
    summary: 'Validate a knowledge-base compatibility export manifest before restore apply',
  })
  @ApiResponse({ status: 200, description: 'Workspace import validation result returned' })
  async validateKnowledgeBaseImport(@Body() dto: WorkspaceImportDto) {
    return this.workspaceExportsService.validateImport(dto);
  }

  @Post('knowledge-bases/import-manifest/apply')
  @ApiOperation({
    summary: 'Apply a conservative restore through the knowledge-base compatibility API',
  })
  @ApiResponse({ status: 201, description: 'Workspace restore applied' })
  async applyKnowledgeBaseImport(@Body() dto: WorkspaceImportDto) {
    return this.workspaceExportsService.applyImport(dto);
  }
}
