import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SourceStatus } from '../enums/source.enums';
import { GitSourceConfigDto, UrlSourceConfigDto } from './create-source.dto';

export const SOURCE_SYNC_TRIGGER_MODES = ['manual', 'schedule', 'webhook', 'watch'] as const;
export type SourceSyncTriggerMode = (typeof SOURCE_SYNC_TRIGGER_MODES)[number];

export const SOURCE_SYNC_REFRESH_MODES = [
  'incremental',
  'force_reembed',
  'force_rechunk',
  'rebuild_collection',
] as const;
export type SourceSyncRefreshMode = (typeof SOURCE_SYNC_REFRESH_MODES)[number];

export const SOURCE_TRUTH_MODES = ['read_only'] as const;
export type SourceTruthMode = (typeof SOURCE_TRUTH_MODES)[number];

export const SOURCE_WRITE_POLICIES = ['disabled'] as const;
export type SourceWritePolicy = (typeof SOURCE_WRITE_POLICIES)[number];

export class SourceTruthPolicyDto {
  @IsOptional()
  @IsEnum(SOURCE_TRUTH_MODES)
  truthMode?: SourceTruthMode;

  @IsOptional()
  @IsEnum(SOURCE_WRITE_POLICIES)
  writePolicy?: SourceWritePolicy;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SourceSyncPolicyDto {
  @IsEnum(SOURCE_SYNC_TRIGGER_MODES)
  triggerMode!: SourceSyncTriggerMode;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  schedule?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  webhookSecretRef?: string;

  @IsOptional()
  @IsInt()
  @Min(250)
  @Max(300000)
  watchDebounceMs?: number;

  @IsOptional()
  @IsEnum(SOURCE_SYNC_REFRESH_MODES)
  mode?: SourceSyncRefreshMode;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateSourcePolicyDto {
  @IsObject()
  @ValidateNested()
  @Type(() => SourceTruthPolicyDto)
  @IsOptional()
  sourceTruthPolicy?: SourceTruthPolicyDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SourceSyncPolicyDto)
  @IsOptional()
  syncPolicy?: SourceSyncPolicyDto;
}

export class UpdateSourceDto {
  @IsString()
  @IsOptional()
  uri?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  includeRules?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  excludeRules?: string[];

  @IsEnum(SourceStatus)
  @IsOptional()
  status?: SourceStatus;

  @IsObject()
  @ValidateNested()
  @Type(() => GitSourceConfigDto)
  @IsOptional()
  git?: GitSourceConfigDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SourceSyncPolicyDto)
  @IsOptional()
  syncPolicy?: SourceSyncPolicyDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SourceTruthPolicyDto)
  @IsOptional()
  sourceTruthPolicy?: SourceTruthPolicyDto;

  @IsObject()
  @ValidateNested()
  @Type(() => UrlSourceConfigDto)
  @IsOptional()
  url?: UrlSourceConfigDto;
}
