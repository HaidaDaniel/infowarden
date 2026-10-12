import { IsOptional, IsString } from 'class-validator';

export class ArchiveMemoryEntryDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
