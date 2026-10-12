import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SourceType } from '../enums/source.enums';

export class GitSourceConfigDto {
  @IsString()
  @IsOptional()
  branch?: string;

  @IsString()
  @IsOptional()
  commit?: string;

  @IsString()
  @IsOptional()
  clonePath?: string;

  @IsString()
  @IsOptional()
  credentialsRef?: string;
}

export class UrlSourceConfigDto {
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  maxPages?: number;

  @IsInt()
  @Min(1024)
  @Max(10 * 1024 * 1024)
  @IsOptional()
  maxBytesPerPage?: number;

  @IsInt()
  @Min(1024)
  @Max(50 * 1024 * 1024)
  @IsOptional()
  totalMaxBytes?: number;

  @IsInt()
  @Min(250)
  @Max(60000)
  @IsOptional()
  timeoutMs?: number;

  @IsBoolean()
  @IsOptional()
  sameHost?: boolean;

  @IsBoolean()
  @IsOptional()
  respectRobots?: boolean;
}

export class CreateSourceDto {
  @IsString()
  @IsOptional()
  knowledgeBaseId?: string;

  @IsString()
  @IsOptional()
  knowledgeBaseSlug?: string;

  @IsEnum(SourceType)
  type: SourceType;

  @ValidateIf((o) => o.type === 'local_folder')
  @IsString()
  uri: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  includeRules?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  excludeRules?: string[];

  @ValidateIf((o) => o.type === SourceType.GIT_REPO)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => GitSourceConfigDto)
  git?: GitSourceConfigDto;

  @ValidateIf((o) => o.type === SourceType.URL)
  @IsObject()
  @ValidateNested()
  @Type(() => UrlSourceConfigDto)
  @IsOptional()
  url?: UrlSourceConfigDto;
}
