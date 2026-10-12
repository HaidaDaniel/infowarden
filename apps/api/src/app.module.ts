import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AppConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { KnowledgeBasesModule } from "./knowledge-bases/knowledge-bases.module";
import { SourcesModule } from "./sources/sources.module";
import { JobsModule } from "./jobs/jobs.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { ChunkingModule } from "./chunking/chunking.module";
import { EmbeddingsModule } from "./embeddings/embeddings.module";
import { VectorIndexModule } from "./vector-index/vector-index.module";
import { RetrievalModule } from "./retrieval/retrieval.module";
import { MemoryModule } from "./memory/memory.module";
import { WorkspaceExportsModule } from "./workspace-exports/workspace-exports.module";
import { ProvidersModule } from "./providers/providers.module";
import { BenchmarksModule } from "./benchmarks/benchmarks.module";
import { ResourceManagementModule } from "./resource-management/resource-management.module";
import { VectorBackendsModule } from "./vector-backends/vector-backends.module";
import { WorkspaceVectorPlacementModule } from "./workspace-vector-placement/workspace-vector-placement.module";
import { TelemetryModule } from "./telemetry/telemetry.module";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ApiKeyAuthGuard } from "./auth/api-key-auth.guard";
import { AnswersModule } from "./answers/answers.module";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    HealthModule,
    KnowledgeBasesModule,
    SourcesModule,
    JobsModule,
    IngestionModule,
    ChunkingModule,
    EmbeddingsModule,
    VectorIndexModule,
    RetrievalModule,
    MemoryModule,
    WorkspaceExportsModule,
    ProvidersModule,
    BenchmarksModule,
    ResourceManagementModule,
    VectorBackendsModule,
    WorkspaceVectorPlacementModule,
    TelemetryModule,
    AnswersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ApiKeyAuthGuard,
    },
  ],
})
export class AppModule {}
