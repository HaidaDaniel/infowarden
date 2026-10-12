import { Injectable } from '@nestjs/common';
import { IndexingJobType } from '@prisma/client';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { SourcesService } from '../sources/sources.service';
import { BootstrapIndexingDto } from './dto/bootstrap-indexing.dto';
import { QueueService } from './queue.service';

@Injectable()
export class BootstrapIndexingService {
  constructor(
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly sourcesService: SourcesService,
    private readonly queueService: QueueService,
  ) {}

  async bootstrap(dto: BootstrapIndexingDto) {
    const knowledgeBaseResult = await this.knowledgeBasesService.ensureForBootstrap({
      id: dto.knowledgeBase.id,
      slug: dto.knowledgeBase.slug,
      name: dto.knowledgeBase.name,
      description: dto.knowledgeBase.description,
    });

    const sourceResult = await this.sourcesService.createOrReuse({
      knowledgeBaseId: knowledgeBaseResult.knowledgeBase.id,
      type: dto.source.type,
      uri: dto.source.uri,
      includeRules: dto.source.includeRules,
      excludeRules: dto.source.excludeRules,
      git: dto.source.git,
    });

    const job = await this.queueService.enqueueIndexingJob({
      knowledgeBaseId: knowledgeBaseResult.knowledgeBase.id,
      sourceId: sourceResult.source.id,
      type: dto.job?.type || IndexingJobType.scan_source,
    });

    return {
      knowledgeBase: knowledgeBaseResult.knowledgeBase,
      source: sourceResult.source,
      job,
      reused: {
        knowledgeBase: !knowledgeBaseResult.created,
        source: !sourceResult.created,
      },
    };
  }
}
