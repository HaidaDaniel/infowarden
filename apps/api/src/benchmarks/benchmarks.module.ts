import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SourcesModule } from '../sources/sources.module';
import { BenchmarksController } from './benchmarks.controller';
import { StandardBenchmarkService } from './standard-benchmark.service';

@Module({
  imports: [PrismaModule, KnowledgeBasesModule, SourcesModule, JobsModule],
  controllers: [BenchmarksController],
  providers: [StandardBenchmarkService],
})
export class BenchmarksModule {}
