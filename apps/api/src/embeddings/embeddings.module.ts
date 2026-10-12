import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ProvidersModule } from '../providers/providers.module';
import { EmbeddingsController } from './embeddings.controller';
import { EmbeddingsService } from './embeddings.service';
import { OpenAICompatibleProvider } from './openai-embedding.provider';

@Module({
  imports: [HttpModule, ProvidersModule],
  controllers: [EmbeddingsController],
  providers: [EmbeddingsService, OpenAICompatibleProvider],
  exports: [EmbeddingsService, OpenAICompatibleProvider],
})
export class EmbeddingsModule {}
