import { forwardRef, Module } from '@nestjs/common';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { ProvidersModule } from '../providers/providers.module';
import { VectorIndexModule } from '../vector-index/vector-index.module';
import { WorkspaceVectorPlacementModule } from '../workspace-vector-placement/workspace-vector-placement.module';
import { RetrievalContextController } from './retrieval-context.controller';
import { RetrievalController } from './retrieval.controller';
import { RetrievalEvalController } from './retrieval-eval.controller';
import { RetrievalEvalService } from './retrieval-eval.service';
import { RetrievalService } from './retrieval.service';
import { RetrievalCandidateService } from './retrieval-candidate.service';
import { RetrievalNeighborExpansionService } from './retrieval-neighbor-expansion.service';
import { RetrievalProfileResolver } from './retrieval-profile.resolver';
import { RetrievalEvalMetrics } from './retrieval-eval-metrics';

@Module({
  imports: [
    EmbeddingsModule,
    VectorIndexModule,
    ProvidersModule,
    WorkspaceVectorPlacementModule,
    forwardRef(() => KnowledgeBasesModule),
  ],
  controllers: [RetrievalController, RetrievalContextController, RetrievalEvalController],
  providers: [
    RetrievalService,
    RetrievalEvalService,
    RetrievalCandidateService,
    RetrievalNeighborExpansionService,
    RetrievalProfileResolver,
    RetrievalEvalMetrics,
  ],
  exports: [RetrievalService],
})
export class RetrievalModule {}
