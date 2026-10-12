import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { Document, WorkspaceKind } from '@prisma/client';
import { FileEntry } from '../ingestion/local-folder.scanner';
import { TextCodeParser } from '../ingestion/text-code.parser';
import { ValidationIssue } from '../validation/validation.service';
import { DependencyHint, DependencyPlannerInput, IndexingChangePlan, ParsedFileForIndex } from './indexing.types';

@Injectable()
export class IndexingChangePlannerService {
  constructor(private readonly parser: TextCodeParser) {}

  buildPlan(params: {
    sourceId: string;
    workspaceKind: WorkspaceKind;
    files: FileEntry[];
    existingDocuments: Document[];
  }): {
    plan: IndexingChangePlan;
    validationIssues: ValidationIssue[];
    stats: {
      filesParsed: number;
      filesIgnored: number;
      parseFailures: number;
      added: number;
      changed: number;
      unchanged: number;
      deleted: number;
      documentsDeleted: number;
      documentsSkipped: number;
      dependencyCandidates: number;
    };
  } {
    const existingDocMap = new Map(params.existingDocuments.map((document) => [document.path, document]));
    const currentPaths = new Set<string>();
    const parsedFiles: ParsedFileForIndex[] = [];
    const deletedDocuments: IndexingChangePlan['deletedDocuments'] = [];
    const validationIssues: ValidationIssue[] = [];

    const stats = {
      filesParsed: 0,
      filesIgnored: 0,
      parseFailures: 0,
      added: 0,
      changed: 0,
      unchanged: 0,
      deleted: 0,
      documentsDeleted: 0,
      documentsSkipped: 0,
      dependencyCandidates: 0,
    };

    for (const file of params.files) {
      if (file.skipReason) {
        stats.filesIgnored++;
        stats.documentsSkipped++;
        validationIssues.push({
          severity: 'warning',
          code: (file.metadata?.code as string) || 'file_skipped',
          message: file.skipReason,
          metadata: { path: file.relativePath },
        });
        continue;
      }

      currentPaths.add(file.relativePath);
      const parsed = this.parser.parse(file.content || fs.readFileSync(file.absolutePath), file.relativePath);

      if (!parsed) {
        const failure = this.parser.describeParseFailure(file.relativePath);
        stats.parseFailures++;
        stats.documentsSkipped++;
        validationIssues.push({
          severity: failure.severity,
          code: failure.code,
          message: failure.message,
          metadata: { path: file.relativePath, ...(failure.metadata || {}) },
        });
        continue;
      }

      stats.filesParsed++;
      const existingDoc = existingDocMap.get(file.relativePath);
      const documentId = this.generateDocumentId(params.sourceId, file.relativePath);
      const changeType = !existingDoc
        ? 'added'
        : existingDoc.contentHash === parsed.contentHash && existingDoc.status === 'active'
          ? 'unchanged'
          : 'changed';

      if (changeType === 'added') {
        stats.added++;
      } else if (changeType === 'changed') {
        stats.changed++;
      } else {
        stats.unchanged++;
        stats.documentsSkipped++;
      }

      for (const warning of parsed.warnings || []) {
        validationIssues.push({
          severity: warning.severity,
          code: warning.code,
          message: warning.message,
          documentId,
          metadata: {
            path: file.relativePath,
            ...(warning.metadata || {}),
          },
        });
      }

      parsedFiles.push({
        file,
        parsed,
        documentId,
        changeType,
        existingDocument: existingDoc,
      });
    }

    for (const [docPath, document] of existingDocMap.entries()) {
      if (!currentPaths.has(docPath) && document.status !== 'deleted') {
        deletedDocuments.push({ path: docPath, document });
        stats.deleted++;
        stats.documentsDeleted++;
      }
    }

    const dependencyHints = this.findDependencyHints({
      workspaceKind: params.workspaceKind,
      changedOrDeletedPaths: [
        ...parsedFiles
          .filter((item) => item.changeType !== 'unchanged')
          .map((item) => item.file.relativePath),
        ...deletedDocuments.map((item) => item.path),
      ],
      existingDocuments: params.existingDocuments,
    });
    stats.dependencyCandidates = dependencyHints.length;

    return {
      plan: {
        parsedFiles,
        deletedDocuments,
        dependencyHints,
      },
      validationIssues,
      stats,
    };
  }

  private findDependencyHints(input: DependencyPlannerInput): DependencyHint[] {
    if (input.workspaceKind !== 'codebase') {
      return [];
    }

    const changed = new Set(input.changedOrDeletedPaths);
    const hints: DependencyHint[] = [];

    for (const document of input.existingDocuments) {
      if (changed.has(document.path) || document.status !== 'active') {
        continue;
      }

      const metadata = (document.metadata as Record<string, unknown>) || {};
      const dependencyRefs = Array.isArray(metadata.dependencyRefs)
        ? metadata.dependencyRefs.filter((value): value is string => typeof value === 'string')
        : [];
      const resolvedRefs = dependencyRefs.flatMap((ref) => this.resolveDependencyCandidates(document.path, ref));
      const touchedDependencies = resolvedRefs.filter((candidate) => changed.has(candidate));

      if (touchedDependencies.length === 0) {
        continue;
      }

      hints.push({
        path: document.path,
        dependsOn: [...new Set(touchedDependencies)].sort(),
      });
    }

    return hints;
  }

  private resolveDependencyCandidates(documentPath: string, dependencyRef: string): string[] {
    const normalizedRef = dependencyRef.replace(/\\/g, '/');
    if (!normalizedRef.startsWith('.')) {
      return [normalizedRef];
    }

    const baseDir = path.posix.dirname(documentPath.replace(/\\/g, '/'));
    const withoutExt = path.posix.normalize(path.posix.join(baseDir, normalizedRef));
    const candidates = [
      withoutExt,
      `${withoutExt}.ts`,
      `${withoutExt}.tsx`,
      `${withoutExt}.js`,
      `${withoutExt}.jsx`,
      `${withoutExt}.py`,
      `${withoutExt}.rs`,
      `${withoutExt}.go`,
      `${withoutExt}.java`,
      `${withoutExt}.json`,
      `${withoutExt}.md`,
      path.posix.join(withoutExt, 'index.ts'),
      path.posix.join(withoutExt, 'index.tsx'),
      path.posix.join(withoutExt, 'index.js'),
      path.posix.join(withoutExt, 'index.jsx'),
    ];

    return [...new Set(candidates)];
  }

  private generateDocumentId(sourceId: string, filePath: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(`${sourceId}:${filePath}`, 'utf8').digest('hex').slice(0, 32);
  }
}
