import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArchiveMemoryEntryDto } from './dto/archive-memory-entry.dto';
import { CreateDecisionNoteDto } from './dto/create-decision-note.dto';
import { CreateMemoryEntryDto } from './dto/create-memory-entry.dto';
import { CreateSessionSummaryDto } from './dto/create-session-summary.dto';
import { ListMemoryEntriesDto } from './dto/list-memory-entries.dto';
import { UpdateMemoryEntryDto } from './dto/update-memory-entry.dto';
import { MemoryService } from './memory.service';

@ApiTags('memory')
@Controller()
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post('workspaces/:identifier/memory')
  @ApiOperation({ summary: 'Create a memory entry in a workspace' })
  @ApiResponse({ status: 201, description: 'Memory entry created' })
  async createWorkspaceMemoryEntry(
    @Param('identifier') identifier: string,
    @Body() dto: CreateMemoryEntryDto,
  ) {
    return this.memoryService.createMemoryEntry(identifier, dto);
  }

  @Post('knowledge-bases/:identifier/memory')
  @ApiOperation({ summary: 'Create a memory entry in a knowledge base compatibility workspace' })
  @ApiResponse({ status: 201, description: 'Memory entry created' })
  async createKnowledgeBaseMemoryEntry(
    @Param('identifier') identifier: string,
    @Body() dto: CreateMemoryEntryDto,
  ) {
    return this.memoryService.createMemoryEntry(identifier, dto);
  }

  @Post('workspaces/:identifier/memory/session-summaries')
  @ApiOperation({ summary: 'Save a session summary in a workspace' })
  @ApiResponse({ status: 201, description: 'Session summary created' })
  async createWorkspaceSessionSummary(
    @Param('identifier') identifier: string,
    @Body() dto: CreateSessionSummaryDto,
  ) {
    return this.memoryService.createSessionSummary(identifier, dto);
  }

  @Post('knowledge-bases/:identifier/memory/session-summaries')
  @ApiOperation({ summary: 'Save a session summary in a knowledge base compatibility workspace' })
  @ApiResponse({ status: 201, description: 'Session summary created' })
  async createKnowledgeBaseSessionSummary(
    @Param('identifier') identifier: string,
    @Body() dto: CreateSessionSummaryDto,
  ) {
    return this.memoryService.createSessionSummary(identifier, dto);
  }

  @Post('workspaces/:identifier/memory/decisions')
  @ApiOperation({ summary: 'Save a decision note in a workspace' })
  @ApiResponse({ status: 201, description: 'Decision note created' })
  async createWorkspaceDecisionNote(
    @Param('identifier') identifier: string,
    @Body() dto: CreateDecisionNoteDto,
  ) {
    return this.memoryService.createDecisionNote(identifier, dto);
  }

  @Post('knowledge-bases/:identifier/memory/decisions')
  @ApiOperation({ summary: 'Save a decision note in a knowledge base compatibility workspace' })
  @ApiResponse({ status: 201, description: 'Decision note created' })
  async createKnowledgeBaseDecisionNote(
    @Param('identifier') identifier: string,
    @Body() dto: CreateDecisionNoteDto,
  ) {
    return this.memoryService.createDecisionNote(identifier, dto);
  }

  @Get('workspaces/:identifier/memory')
  @ApiOperation({ summary: 'List memory entries in a workspace' })
  @ApiResponse({ status: 200, description: 'Memory entries returned' })
  async listWorkspaceMemoryEntries(
    @Param('identifier') identifier: string,
    @Query() query: ListMemoryEntriesDto,
  ) {
    return this.memoryService.listMemoryEntries(identifier, query);
  }

  @Get('knowledge-bases/:identifier/memory')
  @ApiOperation({ summary: 'List memory entries in a knowledge base compatibility workspace' })
  @ApiResponse({ status: 200, description: 'Memory entries returned' })
  async listKnowledgeBaseMemoryEntries(
    @Param('identifier') identifier: string,
    @Query() query: ListMemoryEntriesDto,
  ) {
    return this.memoryService.listMemoryEntries(identifier, query);
  }

  @Get('workspaces/:identifier/memory/:entryId')
  @ApiOperation({ summary: 'Get a memory entry by id from a workspace' })
  @ApiResponse({ status: 200, description: 'Memory entry returned' })
  @ApiResponse({ status: 404, description: 'Memory entry not found' })
  async getWorkspaceMemoryEntry(
    @Param('identifier') identifier: string,
    @Param('entryId') entryId: string,
  ) {
    return this.memoryService.getMemoryEntry(identifier, entryId);
  }

  @Get('knowledge-bases/:identifier/memory/:entryId')
  @ApiOperation({ summary: 'Get a memory entry by id from a knowledge base compatibility workspace' })
  @ApiResponse({ status: 200, description: 'Memory entry returned' })
  @ApiResponse({ status: 404, description: 'Memory entry not found' })
  async getKnowledgeBaseMemoryEntry(
    @Param('identifier') identifier: string,
    @Param('entryId') entryId: string,
  ) {
    return this.memoryService.getMemoryEntry(identifier, entryId);
  }

  @Patch('workspaces/:identifier/memory/:entryId')
  @ApiOperation({ summary: 'Update a memory entry in a workspace' })
  @ApiResponse({ status: 200, description: 'Memory entry updated' })
  @ApiResponse({ status: 404, description: 'Memory entry not found' })
  async updateWorkspaceMemoryEntry(
    @Param('identifier') identifier: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateMemoryEntryDto,
  ) {
    return this.memoryService.updateMemoryEntry(identifier, entryId, dto);
  }

  @Patch('knowledge-bases/:identifier/memory/:entryId')
  @ApiOperation({ summary: 'Update a memory entry in a knowledge base compatibility workspace' })
  @ApiResponse({ status: 200, description: 'Memory entry updated' })
  @ApiResponse({ status: 404, description: 'Memory entry not found' })
  async updateKnowledgeBaseMemoryEntry(
    @Param('identifier') identifier: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateMemoryEntryDto,
  ) {
    return this.memoryService.updateMemoryEntry(identifier, entryId, dto);
  }

  @Post('workspaces/:identifier/memory/:entryId/archive')
  @ApiOperation({ summary: 'Archive a memory entry in a workspace' })
  @ApiResponse({ status: 200, description: 'Memory entry archived' })
  @ApiResponse({ status: 404, description: 'Memory entry not found' })
  async archiveWorkspaceMemoryEntry(
    @Param('identifier') identifier: string,
    @Param('entryId') entryId: string,
    @Body() dto: ArchiveMemoryEntryDto,
  ) {
    return this.memoryService.archiveMemoryEntry(identifier, entryId, dto);
  }

  @Post('knowledge-bases/:identifier/memory/:entryId/archive')
  @ApiOperation({ summary: 'Archive a memory entry in a knowledge base compatibility workspace' })
  @ApiResponse({ status: 200, description: 'Memory entry archived' })
  @ApiResponse({ status: 404, description: 'Memory entry not found' })
  async archiveKnowledgeBaseMemoryEntry(
    @Param('identifier') identifier: string,
    @Param('entryId') entryId: string,
    @Body() dto: ArchiveMemoryEntryDto,
  ) {
    return this.memoryService.archiveMemoryEntry(identifier, entryId, dto);
  }

  @Delete('workspaces/:identifier/memory/:entryId')
  @ApiOperation({ summary: 'Delete a memory entry in a workspace' })
  @ApiResponse({ status: 200, description: 'Memory entry deleted' })
  @ApiResponse({ status: 404, description: 'Memory entry not found' })
  async deleteWorkspaceMemoryEntry(
    @Param('identifier') identifier: string,
    @Param('entryId') entryId: string,
  ) {
    return this.memoryService.deleteMemoryEntry(identifier, entryId);
  }

  @Delete('knowledge-bases/:identifier/memory/:entryId')
  @ApiOperation({ summary: 'Delete a memory entry in a knowledge base compatibility workspace' })
  @ApiResponse({ status: 200, description: 'Memory entry deleted' })
  @ApiResponse({ status: 404, description: 'Memory entry not found' })
  async deleteKnowledgeBaseMemoryEntry(
    @Param('identifier') identifier: string,
    @Param('entryId') entryId: string,
  ) {
    return this.memoryService.deleteMemoryEntry(identifier, entryId);
  }
}
