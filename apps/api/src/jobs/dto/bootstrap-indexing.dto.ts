import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IndexingJobType } from '@prisma/client';
import { SourceType } from '../../sources/enums/source.enums';
import { GitSourceConfigDto } from '../../sources/dto/create-source.dto';

export class BootstrapKnowledgeBaseDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsOptional()
  slug?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class BootstrapSourceDto {
  @IsEnum(SourceType)
  type: SourceType;

  @ValidateIf((o) => o.type === SourceType.LOCAL_FOLDER)
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
}

export class BootstrapJobOptionsDto {
  @IsEnum(IndexingJobType)
  @IsOptional()
  type?: IndexingJobType;
}

export class BootstrapIndexingDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => BootstrapKnowledgeBaseDto)
  knowledgeBase: BootstrapKnowledgeBaseDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => BootstrapSourceDto)
  source: BootstrapSourceDto;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => BootstrapJobOptionsDto)
  job?: BootstrapJobOptionsDto;
}
