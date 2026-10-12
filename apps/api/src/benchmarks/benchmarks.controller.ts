import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ImportStandardBenchmarkRequest,
  StandardBenchmarkService,
} from './standard-benchmark.service';

@ApiTags('benchmarks')
@Controller()
export class BenchmarksController {
  constructor(private readonly standardBenchmarkService: StandardBenchmarkService) {}

  @Post('workspaces/:identifier/benchmarks/cf-standard-benchmark/import')
  @ApiOperation({ summary: 'Import the standard public benchmark pack into a workspace' })
  @ApiResponse({ status: 201, description: 'Benchmark source, eval questions, and indexing job created' })
  async importWorkspaceStandardBenchmark(
    @Param('identifier') identifier: string,
    @Body() body: ImportStandardBenchmarkRequest = {},
  ) {
    return this.standardBenchmarkService.importStandardBenchmark(identifier, body);
  }

  @Post('knowledge-bases/:identifier/benchmarks/cf-standard-benchmark/import')
  @ApiOperation({ summary: 'Import the standard public benchmark pack into a knowledge base' })
  @ApiResponse({ status: 201, description: 'Benchmark source, eval questions, and indexing job created' })
  async importKnowledgeBaseStandardBenchmark(
    @Param('identifier') identifier: string,
    @Body() body: ImportStandardBenchmarkRequest = {},
  ) {
    return this.importWorkspaceStandardBenchmark(identifier, body);
  }
}
