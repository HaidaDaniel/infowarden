import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AskRequest } from './answer.types';
import { AnswersService } from './answers.service';

@ApiTags('answers')
@Controller(['knowledge-bases', 'workspaces'])
export class AnswersController {
  constructor(private readonly answersService: AnswersService) {}

  @Post(':identifier/ask')
  @ApiOperation({
    summary: 'Retrieve chunks or generate one citation-preserving RAG answer',
  })
  @ApiResponse({ status: 200, description: 'Return chunks or a RAG answer' })
  @ApiResponse({ status: 400, description: 'Invalid answer request' })
  @ApiResponse({ status: 502, description: 'LLM response failed validation' })
  @ApiResponse({ status: 503, description: 'LLM provider unavailable' })
  async ask(
    @Param('identifier') identifier: string,
    @Body() body: AskRequest,
  ) {
    return this.answersService.ask(identifier, body);
  }
}
