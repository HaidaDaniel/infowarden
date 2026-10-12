import { forwardRef, Module } from '@nestjs/common';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VectorBackendsModule } from '../vector-backends/vector-backends.module';
import { WorkspaceVectorPlacementController } from './workspace-vector-placement.controller';
import { WorkspaceVectorPlacementService } from './workspace-vector-placement.service';
import { VectorIndexModule } from '../vector-index/vector-index.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { VectorMaterializationQueueService } from './vector-materialization-queue.service';
import { VectorBackendSelector } from './vector-backend-selector.service';
import { VectorMaterializationValidator } from './vector-materialization-validator.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => KnowledgeBasesModule),
    VectorBackendsModule,
    VectorIndexModule,
    EmbeddingsModule,
  ],
  controllers: [WorkspaceVectorPlacementController],
  providers: [
    WorkspaceVectorPlacementService,
    VectorMaterializationQueueService,
    VectorBackendSelector,
    VectorMaterializationValidator,
  ],
  exports: [WorkspaceVectorPlacementService, VectorMaterializationQueueService],
})
export class WorkspaceVectorPlacementModule {}
