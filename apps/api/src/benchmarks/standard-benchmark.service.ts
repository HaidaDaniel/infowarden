import { BadRequestException, Injectable } from '@nestjs/common';
import { IndexingJobType, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { QueueService } from '../jobs/queue.service';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import { PrismaService } from '../prisma/prisma.service';
import { SourceType } from '../sources/enums/source.enums';
import { SourcesService } from '../sources/sources.service';

const DATASET_ID = 'cf-standard-benchmark';
const DEFAULT_PROFILE = 'cpu-mini';

export type ImportStandardBenchmarkRequest = {
  profile?: string;
  maxDocs?: number;
  maxQuestions?: number;
  force?: boolean;
};

type BenchmarkManifest = {
  id: string;
  version: string;
  defaultTopK?: number;
  documentsPath: string;
  questionsPath: string;
  source?: {
    name?: string;
    url?: string;
    profile?: string;
    maxDocs?: number;
    maxQuestions?: number;
  };
  documents: Array<{
    id: string;
    path: string;
  }>;
};

type BenchmarkQuestion = {
  id: string;
  text: string;
  expectedDocumentIds?: string[];
  expectedChunkIds?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
};

type ImporterOutput = {
  datasetId: string;
  outputDir: string;
  documents: number;
  questions: number;
};

@Injectable()
export class StandardBenchmarkService {
  private readonly repoRoot = this.findRepoRoot();

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBasesService: KnowledgeBasesService,
    private readonly sourcesService: SourcesService,
    private readonly queueService: QueueService,
  ) {}

  async importStandardBenchmark(identifier: string, request: ImportStandardBenchmarkRequest = {}) {
    const knowledgeBase = await this.knowledgeBasesService.resolveIdentifier(identifier);
    const importerOutput = this.runImporter(request);
    const packDir = path.resolve(this.repoRoot, importerOutput.outputDir);
    const manifest = this.readManifest(packDir);
    const questions = this.readQuestions(packDir, manifest);

    if (manifest.id !== DATASET_ID) {
      throw new BadRequestException(`Unexpected benchmark id "${manifest.id}"`);
    }

    const documentsRoot = path.resolve(packDir, manifest.documentsPath);
    const { source, created } = await this.sourcesService.createOrReuse({
      knowledgeBaseId: knowledgeBase.id,
      type: SourceType.LOCAL_FOLDER,
      uri: documentsRoot,
      includeRules: ['**/*.md'],
      excludeRules: [],
    });
    const documentAliases = this.documentAliasesByBenchmarkId(source.id, manifest);

    for (const question of questions) {
      const expectedDocumentIds = this.expectedDocumentIds(question, documentAliases);
      await this.prisma.evalQuestion.upsert({
        where: { id: this.evalQuestionId(knowledgeBase.id, question.id) },
        update: {
          text: question.text,
          expectedDocumentIds,
          expectedChunkIds: question.expectedChunkIds || [],
          metadata: this.questionMetadata(question, manifest, packDir) as Prisma.InputJsonValue,
        },
        create: {
          id: this.evalQuestionId(knowledgeBase.id, question.id),
          knowledgeBaseId: knowledgeBase.id,
          text: question.text,
          expectedDocumentIds,
          expectedChunkIds: question.expectedChunkIds || [],
          metadata: this.questionMetadata(question, manifest, packDir) as Prisma.InputJsonValue,
        },
      });
    }

    const indexingJob = await this.queueService.enqueueIndexingJob({
      knowledgeBaseId: knowledgeBase.id,
      sourceId: source.id,
      type: IndexingJobType.scan_source,
      refresh: {
        mode: 'incremental',
        reason: 'standard benchmark import',
        trigger: 'manual',
        triggerMetadata: {
          datasetId: DATASET_ID,
          packDir,
          profile: manifest.source?.profile || DEFAULT_PROFILE,
        },
      },
    });

    return {
      datasetId: DATASET_ID,
      datasetVersion: manifest.version,
      profile: manifest.source?.profile || DEFAULT_PROFILE,
      packPath: packDir,
      documents: manifest.documents.length,
      questions: questions.length,
      source: {
        id: source.id,
        uri: source.uri,
        created,
      },
      indexingJob,
      next: {
        datasetId: DATASET_ID,
        profileKey: knowledgeBase.defaultRetrievalProfile || 'default',
        topK: manifest.defaultTopK || 10,
      },
    };
  }

  private runImporter(request: ImportStandardBenchmarkRequest): ImporterOutput {
    const scriptPath = path.resolve(this.repoRoot, 'scripts/benchmarks/import-standard-benchmark.mjs');
    if (!existsSync(scriptPath)) {
      throw new BadRequestException(`Benchmark importer not found at ${scriptPath}`);
    }

    const args = [scriptPath, '--profile', request.profile || DEFAULT_PROFILE];
    if (request.maxDocs) args.push('--maxDocs', String(request.maxDocs));
    if (request.maxQuestions) args.push('--maxQuestions', String(request.maxQuestions));
    if (request.force) args.push('--force');

    const result = spawnSync(process.execPath, args, {
      cwd: this.repoRoot,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new BadRequestException(
        `Benchmark import failed: ${(result.stderr || result.stdout || 'unknown error').trim()}`,
      );
    }

    try {
      return JSON.parse(result.stdout) as ImporterOutput;
    } catch {
      throw new BadRequestException(`Benchmark importer returned invalid output: ${result.stdout}`);
    }
  }

  private readManifest(packDir: string): BenchmarkManifest {
    const manifestPath = path.join(packDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new BadRequestException(`Benchmark manifest not found at ${manifestPath}`);
    }
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as BenchmarkManifest;
  }

  private readQuestions(packDir: string, manifest: BenchmarkManifest): BenchmarkQuestion[] {
    const questionsPath = path.join(packDir, manifest.questionsPath);
    if (!existsSync(questionsPath)) {
      throw new BadRequestException(`Benchmark questions not found at ${questionsPath}`);
    }
    return readFileSync(questionsPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BenchmarkQuestion);
  }

  private documentAliasesByBenchmarkId(sourceId: string, manifest: BenchmarkManifest) {
    return new Map(
      manifest.documents.map((document) => {
        const runtimePath = document.path.replace(/^documents\//, '');
        return [
          document.id,
          [
            document.id,
            document.path,
            runtimePath,
            this.generateDocumentId(sourceId, runtimePath),
          ],
        ];
      }),
    );
  }

  private expectedDocumentIds(
    question: BenchmarkQuestion,
    documentAliases: Map<string, string[]>,
  ): string[] {
    const expected = new Set<string>();
    for (const id of question.expectedDocumentIds || []) {
      for (const alias of documentAliases.get(id) || [id]) {
        expected.add(alias);
      }
    }
    const metadataPaths = Array.isArray(question.metadata?.expectedDocumentPaths)
      ? question.metadata.expectedDocumentPaths
      : [];
    for (const value of metadataPaths) {
      if (typeof value !== 'string') continue;
      expected.add(value);
      expected.add(value.replace(/^documents\//, ''));
    }
    return [...expected];
  }

  private questionMetadata(
    question: BenchmarkQuestion,
    manifest: BenchmarkManifest,
    packDir: string,
  ): Record<string, unknown> {
    return {
      ...(question.metadata || {}),
      datasetId: DATASET_ID,
      datasetVersion: manifest.version,
      benchmarkSource: manifest.source,
      sourceQuestionId: question.id,
      tags: question.tags || [],
      packPath: packDir,
    };
  }

  private evalQuestionId(knowledgeBaseId: string, questionId: string): string {
    return `${DATASET_ID}_${knowledgeBaseId}_${questionId}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
  }

  private generateDocumentId(sourceId: string, filePath: string): string {
    return createHash('sha256').update(`${sourceId}:${filePath}`, 'utf8').digest('hex').slice(0, 32);
  }

  private findRepoRoot(): string {
    let current = process.cwd();
    while (true) {
      if (
        existsSync(path.join(current, 'package.json')) &&
        existsSync(path.join(current, 'scripts', 'benchmarks', 'import-standard-benchmark.mjs'))
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new BadRequestException('ContextForge repository root could not be located');
      }
      current = parent;
    }
  }
}
