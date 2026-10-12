import { Module } from '@nestjs/common';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';

@Module({
  imports: [PrismaModule, KnowledgeBasesModule],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
