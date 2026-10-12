import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { IndexingJobType } from '@prisma/client';
import { EnqueueIndexingJobDto } from './dto/enqueue-indexing-job.dto';
import { AppException } from '../common/app-error';
import { BootstrapIndexingService } from './bootstrap-indexing.service';
import { BootstrapIndexingDto } from './dto/bootstrap-indexing.dto';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly queueService: QueueService,
    private readonly bootstrapIndexingService: BootstrapIndexingService,
  ) {}

  @Post('indexing/bootstrap')
  @ApiOperation({
    summary:
      'Create or reuse a knowledge base and source, then enqueue indexing in a single request',
  })
  @ApiResponse({ status: 201, description: 'Bootstrap indexing job enqueued' })
  async bootstrapIndexing(@Body() data: BootstrapIndexingDto) {
    return this.bootstrapIndexingService.bootstrap(data);
  }

  @Post('indexing')
  @ApiOperation({ summary: 'Enqueue an indexing job' })
  @ApiResponse({ status: 201, description: 'Job enqueued' })
  async enqueueIndexingJob(
    @Body() data: EnqueueIndexingJobDto
  ) {
    if (!data.knowledgeBaseId && !data.knowledgeBaseSlug) {
      throw new AppException(
        'knowledge_base_identifier_required',
        'knowledgeBaseId or knowledgeBaseSlug is required',
        'enqueue_indexing_job',
        false,
      );
    }

    if (data.type === IndexingJobType.scan_source && !data.sourceId) {
      throw new AppException(
        'indexing_source_required',
        'sourceId is required for scan_source indexing jobs',
        'enqueue_indexing_job',
        false,
        { type: data.type },
      );
    }
    return this.queueService.enqueueIndexingJob(data);
  }

  @Get('indexing/:id')
  @ApiOperation({ summary: 'Get indexing job status' })
  @ApiResponse({ status: 200, description: 'Job status' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJobStatus(@Param('id') id: string) {
    const job = await this.queueService.getJobStatus(id);
    if (!job) {
      return { error: 'Job not found' };
    }
    return job;
  }
}
