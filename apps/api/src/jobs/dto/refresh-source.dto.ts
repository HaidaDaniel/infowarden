import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SourceRefreshMode } from '../indexing.types';
import { STORAGE_PROFILE_VALUES, StorageProfile } from '../../vector-index/storage-profile';

export const SOURCE_REFRESH_MODES: SourceRefreshMode[] = [
  'incremental',
  'force_reembed',
  'force_rechunk',
  'rebuild_collection',
];

export class RefreshSourceDto {
  @IsOptional()
  @IsEnum(SOURCE_REFRESH_MODES)
  mode?: SourceRefreshMode;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsEnum(STORAGE_PROFILE_VALUES)
  storageProfile?: StorageProfile;
}
