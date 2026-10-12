import { forwardRef, Module } from "@nestjs/common";
import { JobsModule } from "../jobs/jobs.module";
import { KnowledgeBasesModule } from "../knowledge-bases/knowledge-bases.module";
import { PrismaModule } from "../prisma/prisma.module";
import { VectorIndexModule } from "../vector-index/vector-index.module";
import { VectorBackendsModule } from "../vector-backends/vector-backends.module";
import { ResourceManagementController } from "./resource-management.controller";
import { ResourceManagementService } from "./resource-management.service";

@Module({
  imports: [
    PrismaModule,
    VectorIndexModule,
    VectorBackendsModule,
    forwardRef(() => KnowledgeBasesModule),
    JobsModule,
  ],
  controllers: [ResourceManagementController],
  providers: [ResourceManagementService],
  exports: [ResourceManagementService],
})
export class ResourceManagementModule {}
