import { Module } from '@nestjs/common';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';
import { ManagedUploadStorageService } from './managed-upload-storage.service';
import { SourcePolicyController } from './source-policy.controller';
import { UploadSourcesController } from './upload-sources.controller';
import { UploadSourcesService } from './upload-sources.service';
import { ZipArchiveService } from './zip-archive.service';

@Module({
  imports: [KnowledgeBasesModule],
  controllers: [SourcesController, SourcePolicyController, UploadSourcesController],
  providers: [SourcesService, UploadSourcesService, ManagedUploadStorageService, ZipArchiveService],
  exports: [SourcesService],
})
export class SourcesModule {}
