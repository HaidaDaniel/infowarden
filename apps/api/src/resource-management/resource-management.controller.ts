import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResourceManagementService } from './resource-management.service';
import { StorageProfile } from '../vector-index/storage-profile';

@ApiTags('resources')
@Controller()
export class ResourceManagementController {
  constructor(private readonly resourceManagementService: ResourceManagementService) {}

  @Get('resources/system')
  @ApiOperation({ summary: 'Get local system resource inventory' })
  @ApiResponse({ status: 200, description: 'System resource inventory returned' })
  async getSystemResources() {
    return this.resourceManagementService.getSystemResources();
  }

  @Get('workspaces/:identifier/resources')
  @ApiOperation({ summary: 'Get workspace resource status' })
  @ApiResponse({ status: 200, description: 'Workspace resource status returned' })
  async getWorkspaceResources(@Param('identifier') identifier: string) {
    return this.resourceManagementService.getWorkspaceResources(identifier);
  }

  @Get('knowledge-bases/:identifier/resources')
  @ApiOperation({ summary: 'Get knowledge-base resource status' })
  @ApiResponse({ status: 200, description: 'Knowledge-base resource status returned' })
  async getKnowledgeBaseResources(@Param('identifier') identifier: string) {
    return this.resourceManagementService.getWorkspaceResources(identifier);
  }

  @Get('workspaces/:identifier/resources/estimate')
  @ApiOperation({ summary: 'Estimate workspace resource usage' })
  @ApiResponse({ status: 200, description: 'Workspace resource estimate returned' })
  async estimateWorkspaceResources(
    @Param('identifier') identifier: string,
    @Query('storageProfile') storageProfile?: StorageProfile,
  ) {
    return this.resourceManagementService.estimateWorkspace(identifier, { storageProfile });
  }

  @Post('workspaces/:identifier/unload')
  @ApiOperation({ summary: 'Unload a workspace Qdrant serving index' })
  @ApiResponse({ status: 201, description: 'Workspace unload completed' })
  async unloadWorkspace(@Param('identifier') identifier: string) {
    return this.resourceManagementService.unloadWorkspace(identifier);
  }

  @Post('workspaces/:identifier/load')
  @ApiOperation({ summary: 'Load or rebuild a workspace Qdrant serving index' })
  @ApiResponse({ status: 201, description: 'Workspace load started or completed' })
  async loadWorkspace(
    @Param('identifier') identifier: string,
    @Body() body: { storageProfile?: StorageProfile } = {},
  ) {
    return this.resourceManagementService.loadWorkspace(identifier, body);
  }
}
