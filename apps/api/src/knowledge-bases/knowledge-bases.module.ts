import { forwardRef, Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VectorIndexModule } from '../vector-index/vector-index.module';
import { AdminReadModelsController } from './admin-read-models.controller';
import { AdminReadModelsService } from './admin-read-models.service';
import { IndexVersionOperationsController } from './index-version-operations.controller';
import { IndexVersionOperationsService } from './index-version-operations.service';
import { KnowledgeBasesController } from './knowledge-bases.controller';
import { KnowledgeBasesService } from './knowledge-bases.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspaceAvailabilityService } from './workspace-availability.service';

@Module({
  imports: [PrismaModule, EmbeddingsModule, HealthModule, forwardRef(() => RetrievalModule), VectorIndexModule],
  controllers: [
    KnowledgeBasesController,
    WorkspacesController,
    AdminReadModelsController,
    IndexVersionOperationsController,
  ],
  providers: [
    KnowledgeBasesService,
    WorkspaceAvailabilityService,
    AdminReadModelsService,
    IndexVersionOperationsService,
  ],
  exports: [KnowledgeBasesService],
})
export class KnowledgeBasesModule {}
