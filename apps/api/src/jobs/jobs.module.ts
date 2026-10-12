import { Module } from '@nestjs/common';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { SourcesModule } from '../sources/sources.module';
import { JobsController } from './jobs.controller';
import { SourceRefreshController } from './source-refresh.controller';
import { SourceTriggerController } from './source-trigger.controller';
import { BootstrapIndexingService } from './bootstrap-indexing.service';
import { SourceRefreshService } from './source-refresh.service';
import { SourceTriggerSchedulerService } from './source-trigger-scheduler.service';
import { SourceTriggerService } from './source-trigger.service';
import { SourceTriggerWatchService } from './source-trigger-watch.service';
import { QueueService } from './queue.service';
import { RedisService } from './redis.service';
import { LocalFolderIndexer } from './local-folder-indexer';
import { PrismaModule } from '../prisma/prisma.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { ChunkingModule } from '../chunking/chunking.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { VectorIndexModule } from '../vector-index/vector-index.module';
import { ValidationModule } from '../validation/validation.module';
import { IndexingSourcePreparationService } from './indexing-source-preparation.service';
import { IndexingChangePlannerService } from './indexing-change-planner.service';
import { IndexingMaterializationService } from './indexing-materialization.service';
import { WorkspaceServingRevisionsService } from './workspace-serving-revisions.service';
import { WorkspaceLoadReconciliationService } from './workspace-load-reconciliation.service';
import { WorkspaceVectorPlacementModule } from '../workspace-vector-placement/workspace-vector-placement.module';

@Module({
  imports: [
    PrismaModule,
    IngestionModule,
    ChunkingModule,
    EmbeddingsModule,
    VectorIndexModule,
    ValidationModule,
    KnowledgeBasesModule,
    SourcesModule,
    WorkspaceVectorPlacementModule,
  ],
  controllers: [JobsController, SourceRefreshController, SourceTriggerController],
  providers: [
    QueueService,
    RedisService,
    IndexingSourcePreparationService,
    IndexingChangePlannerService,
    IndexingMaterializationService,
    WorkspaceServingRevisionsService,
    WorkspaceLoadReconciliationService,
    LocalFolderIndexer,
    BootstrapIndexingService,
    SourceRefreshService,
    SourceTriggerService,
    SourceTriggerSchedulerService,
    SourceTriggerWatchService,
  ],
  exports: [QueueService, LocalFolderIndexer, WorkspaceLoadReconciliationService],
})
export class JobsModule {}
