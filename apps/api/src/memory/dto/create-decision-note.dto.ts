import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateDecisionNoteDto {
  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsString()
  @IsOptional()
  authoredBy?: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sourceRefs?: string[];

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
