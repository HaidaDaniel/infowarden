import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CompareEvalRunsRequest,
  CompareRetrievalProfilesRequest,
  CreateEvalQuestionRequest,
  RetrievalEvalService,
  RunRetrievalEvalRequest,
} from './retrieval-eval.service';

@ApiTags('retrieval-eval')
@Controller()
export class RetrievalEvalController {
  constructor(private readonly retrievalEvalService: RetrievalEvalService) {}

  @Get('workspaces/:identifier/eval/questions')
  @ApiOperation({ summary: 'List deterministic retrieval eval questions' })
  @ApiResponse({ status: 200, description: 'Eval questions returned' })
  async listWorkspaceQuestions(
    @Param('identifier') identifier: string,
    @Query('datasetId') datasetId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.retrievalEvalService.listQuestions(identifier, {
      datasetId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('knowledge-bases/:identifier/eval/questions')
  @ApiOperation({ summary: 'List deterministic retrieval eval questions' })
  @ApiResponse({ status: 200, description: 'Eval questions returned' })
  async listKnowledgeBaseQuestions(
    @Param('identifier') identifier: string,
    @Query('datasetId') datasetId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.listWorkspaceQuestions(identifier, datasetId, limit);
  }

  @Post('workspaces/:identifier/eval/questions')
  @ApiOperation({ summary: 'Create a deterministic retrieval eval question' })
  @ApiResponse({ status: 201, description: 'Eval question created' })
  async createWorkspaceQuestion(
    @Param('identifier') identifier: string,
    @Body() body: CreateEvalQuestionRequest,
  ) {
    return this.retrievalEvalService.createQuestion(identifier, body);
  }

  @Post('knowledge-bases/:identifier/eval/questions')
  @ApiOperation({ summary: 'Create a deterministic retrieval eval question' })
  @ApiResponse({ status: 201, description: 'Eval question created' })
  async createKnowledgeBaseQuestion(
    @Param('identifier') identifier: string,
    @Body() body: CreateEvalQuestionRequest,
  ) {
    return this.createWorkspaceQuestion(identifier, body);
  }

  @Get('workspaces/:identifier/eval/runs')
  @ApiOperation({ summary: 'List deterministic retrieval eval runs' })
  @ApiResponse({ status: 200, description: 'Eval runs returned' })
  async listWorkspaceRuns(
    @Param('identifier') identifier: string,
    @Query('limit') limit?: string,
  ) {
    return this.retrievalEvalService.listRuns(identifier, limit ? Number(limit) : undefined);
  }

  @Get('knowledge-bases/:identifier/eval/runs')
  @ApiOperation({ summary: 'List deterministic retrieval eval runs' })
  @ApiResponse({ status: 200, description: 'Eval runs returned' })
  async listKnowledgeBaseRuns(
    @Param('identifier') identifier: string,
    @Query('limit') limit?: string,
  ) {
    return this.listWorkspaceRuns(identifier, limit);
  }

  @Get('workspaces/:identifier/eval/runs/:runId')
  @ApiOperation({ summary: 'Get a deterministic retrieval eval run' })
  @ApiResponse({ status: 200, description: 'Eval run returned' })
  async getWorkspaceRun(
    @Param('identifier') identifier: string,
    @Param('runId') runId: string,
  ) {
    return this.retrievalEvalService.getRun(identifier, runId);
  }

  @Get('knowledge-bases/:identifier/eval/runs/:runId')
  @ApiOperation({ summary: 'Get a deterministic retrieval eval run' })
  @ApiResponse({ status: 200, description: 'Eval run returned' })
  async getKnowledgeBaseRun(
    @Param('identifier') identifier: string,
    @Param('runId') runId: string,
  ) {
    return this.getWorkspaceRun(identifier, runId);
  }

  @Post('workspaces/:identifier/eval/runs')
  @ApiOperation({ summary: 'Run deterministic retrieval evaluation' })
  @ApiResponse({ status: 201, description: 'Eval run completed' })
  async runWorkspaceEval(
    @Param('identifier') identifier: string,
    @Body() body: RunRetrievalEvalRequest,
  ) {
    return this.retrievalEvalService.runEval(identifier, body);
  }

  @Post('knowledge-bases/:identifier/eval/runs')
  @ApiOperation({ summary: 'Run deterministic retrieval evaluation' })
  @ApiResponse({ status: 201, description: 'Eval run completed' })
  async runKnowledgeBaseEval(
    @Param('identifier') identifier: string,
    @Body() body: RunRetrievalEvalRequest,
  ) {
    return this.runWorkspaceEval(identifier, body);
  }

  @Post('workspaces/:identifier/eval/profile-comparison')
  @ApiOperation({ summary: 'Run deterministic retrieval eval for multiple retrieval profiles' })
  @ApiResponse({ status: 201, description: 'Profile comparison runs completed' })
  async compareWorkspaceProfiles(
    @Param('identifier') identifier: string,
    @Body() body: CompareRetrievalProfilesRequest,
  ) {
    return this.retrievalEvalService.compareProfiles(identifier, body);
  }

  @Post('knowledge-bases/:identifier/eval/profile-comparison')
  @ApiOperation({ summary: 'Run deterministic retrieval eval for multiple retrieval profiles' })
  @ApiResponse({ status: 201, description: 'Profile comparison runs completed' })
  async compareKnowledgeBaseProfiles(
    @Param('identifier') identifier: string,
    @Body() body: CompareRetrievalProfilesRequest,
  ) {
    return this.compareWorkspaceProfiles(identifier, body);
  }

  @Post('workspaces/:identifier/eval/run-comparison')
  @ApiOperation({ summary: 'Compare two saved deterministic retrieval eval runs' })
  @ApiResponse({ status: 201, description: 'Eval run comparison returned' })
  async compareWorkspaceRuns(
    @Param('identifier') identifier: string,
    @Body() body: CompareEvalRunsRequest,
  ) {
    return this.retrievalEvalService.compareRuns(identifier, body);
  }

  @Post('knowledge-bases/:identifier/eval/run-comparison')
  @ApiOperation({ summary: 'Compare two saved deterministic retrieval eval runs' })
  @ApiResponse({ status: 201, description: 'Eval run comparison returned' })
  async compareKnowledgeBaseRuns(
    @Param('identifier') identifier: string,
    @Body() body: CompareEvalRunsRequest,
  ) {
    return this.compareWorkspaceRuns(identifier, body);
  }
}
