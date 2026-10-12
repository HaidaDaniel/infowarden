import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { AnswerLlmClient } from './answer-llm.client';
import { AnswersController } from './answers.controller';
import { AnswersService } from './answers.service';

@Module({
  imports: [RetrievalModule, ProvidersModule],
  controllers: [AnswersController],
  providers: [AnswersService, AnswerLlmClient],
})
export class AnswersModule {}
