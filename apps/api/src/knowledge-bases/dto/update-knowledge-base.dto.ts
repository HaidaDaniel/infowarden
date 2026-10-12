import { IsIn, IsOptional, IsString } from 'class-validator';
import { WORKSPACE_KIND_VALUES } from './workspace-kind.enum';

export class UpdateKnowledgeBaseDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  slug?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @IsIn(WORKSPACE_KIND_VALUES)
  workspaceKind?: string;

  @IsString()
  @IsOptional()
  defaultIndexProfile?: string;

  @IsString()
  @IsOptional()
  defaultRetrievalProfile?: string;
}
