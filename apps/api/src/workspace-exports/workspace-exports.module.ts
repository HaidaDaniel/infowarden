import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceExportsController } from './workspace-exports.controller';
import { WorkspaceExportsService } from './workspace-exports.service';
import { PortableMetadataSanitizer } from './portable-metadata-sanitizer';

@Module({
  imports: [PrismaModule, KnowledgeBasesModule, JobsModule],
  controllers: [WorkspaceExportsController],
  providers: [WorkspaceExportsService, PortableMetadataSanitizer],
  exports: [WorkspaceExportsService],
})
export class WorkspaceExportsModule {}
