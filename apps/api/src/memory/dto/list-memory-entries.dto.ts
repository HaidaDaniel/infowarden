import { IsBooleanString, IsIn, IsOptional, IsString } from 'class-validator';
import { MEMORY_ENTRY_TYPE_VALUES } from './memory-entry-type.enum';

export class ListMemoryEntriesDto {
  @IsString()
  @IsOptional()
  @IsIn(MEMORY_ENTRY_TYPE_VALUES)
  entryType?: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsOptional()
  tag?: string;

  @IsBooleanString()
  @IsOptional()
  includeArchived?: string;
}
