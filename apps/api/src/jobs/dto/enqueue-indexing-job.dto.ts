import { IsEnum, IsOptional, IsString } from 'class-validator';
import { IndexingJobType } from '@prisma/client';

export class EnqueueIndexingJobDto {
  @IsString()
  @IsOptional()
  knowledgeBaseId?: string;

  @IsString()
  @IsOptional()
  knowledgeBaseSlug?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsEnum(IndexingJobType)
  type: IndexingJobType;
}
