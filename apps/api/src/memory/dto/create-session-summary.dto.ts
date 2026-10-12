import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateSessionSummaryDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  body: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsString()
  sessionId: string;

  @IsString()
  @IsOptional()
  authoredBy?: string;

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
