import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ValidationIssue {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  documentId?: string;
  chunkId?: string;
  metadata?: Record<string, unknown>;
}

export interface ValidationSummary {
  filesScanned: number;
  filesIgnored: number;
  filesParsed: number;
  parseFailures: number;
  chunksCreated: number;
  emptyChunks: number;
  smallChunks: number;
  largeChunks: number;
  duplicateWarnings: number;
  warnings: number;
  errors: number;
}

export type ValidationStatus = 'passed' | 'warning' | 'failed';

@Injectable()
export class ValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async createReport(
    knowledgeBaseId: string,
    indexVersionId: string,
    stats: Record<string, number>,
    issues: ValidationIssue[]
  ) {
    const summary: ValidationSummary = {
      filesScanned: stats.filesScanned || 0,
      filesIgnored: stats.filesIgnored || 0,
      filesParsed: stats.filesParsed || 0,
      parseFailures: stats.parseFailures || 0,
      chunksCreated: stats.chunksCreated || 0,
      emptyChunks: stats.emptyChunks || 0,
      smallChunks: stats.smallChunks || 0,
      largeChunks: stats.largeChunks || 0,
      duplicateWarnings: stats.duplicateWarnings || 0,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      errors: issues.filter((i) => i.severity === 'error').length,
    };

    const status = this.determineStatus(summary);

    const report = await this.prisma.validationReport.create({
      data: {
        knowledgeBaseId,
        indexVersionId,
        level: 'deterministic',
        status,
        summary: summary as any,
        issues: issues as any,
      },
    });

    return report;
  }

  private determineStatus(summary: ValidationSummary): ValidationStatus {
    if (summary.errors > 0) {
      return 'failed';
    }
    if (summary.warnings > 0 || summary.parseFailures > 0 || summary.filesIgnored > 0) {
      return 'warning';
    }
    return 'passed';
  }
}