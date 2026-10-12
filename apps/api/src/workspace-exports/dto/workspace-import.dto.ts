import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class WorkspaceImportTargetDto {
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

  @IsBoolean()
  @IsOptional()
  updateExisting?: boolean;
}

export class WorkspaceImportSourceRemapDto {
  @IsString()
  sourceId!: string;

  @IsString()
  @IsOptional()
  uri?: string;

  @IsString()
  @IsOptional()
  credentialsRef?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  disable?: boolean;
}

export class WorkspaceImportDto {
  @IsObject()
  manifest!: Record<string, unknown>;

  @IsObject()
  @ValidateNested()
  @Type(() => WorkspaceImportTargetDto)
  @IsOptional()
  targetWorkspace?: WorkspaceImportTargetDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkspaceImportSourceRemapDto)
  @IsOptional()
  sourceRemaps?: WorkspaceImportSourceRemapDto[];

  @IsBoolean()
  @IsOptional()
  enqueueReindex?: boolean;
}
