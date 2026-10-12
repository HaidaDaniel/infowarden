import { IsArray, IsDateString, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { MEMORY_ENTRY_TYPE_VALUES } from './memory-entry-type.enum';

export class UpdateMemoryEntryDto {
  @IsString()
  @IsOptional()
  @IsIn(MEMORY_ENTRY_TYPE_VALUES)
  entryType?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  body?: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  authoredBy?: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sourceRefs?: string[];

  @IsDateString()
  @IsOptional()
  occurredAt?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
