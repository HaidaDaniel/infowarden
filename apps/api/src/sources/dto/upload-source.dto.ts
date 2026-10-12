import { IsOptional, IsString } from 'class-validator';

export class UploadSourceDto {
  @IsString()
  @IsOptional()
  includeRules?: string;

  @IsString()
  @IsOptional()
  excludeRules?: string;

  @IsString()
  @IsOptional()
  sourceName?: string;
}
