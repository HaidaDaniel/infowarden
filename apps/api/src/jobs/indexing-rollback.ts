import type { Chunk, Document } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import { getErrorCode, getErrorMessage } from "../common/app-error";

export type RollbackDocumentState = {
  documentId: string;
  previousDocument: Document | null;
  previousChunks: Chunk[];
  qdrantMutated: boolean;
};

export type RollbackLogger = (
  level: "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
) => void;

export async function captureRollbackState(
  prisma: PrismaService,
  documentId: string,
): Promise<RollbackDocumentState> {
  const [previousDocument, previousChunks] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId } }),
    prisma.chunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: "asc" },
    }),
  ]);

  return {
    documentId,
    previousDocument,
    previousChunks,
    qdrantMutated: false,
  };
}

export async function rollbackMaterializedDocuments(params: {
  prisma: PrismaService;
  states: RollbackDocumentState[];
  log: RollbackLogger;
}): Promise<void> {
  for (const state of params.states.reverse()) {
    try {
      await rollbackMaterializedDocument(params.prisma, state);
    } catch (rollbackError) {
      params.log("error", `Rollback failed: ${getErrorMessage(rollbackError)}`, {
        code: getErrorCode(rollbackError) || "indexing_rollback_failed",
        stage: "local_folder_indexer_rollback",
        documentId: state.documentId,
      });
    }
  }
}

async function rollbackMaterializedDocument(
  prisma: PrismaService,
  state: RollbackDocumentState,
): Promise<void> {
  const currentChunks = await prisma.chunk.findMany({
    where: { documentId: state.documentId },
    orderBy: { chunkIndex: "asc" },
  });
  const previousChunkIds = new Set(state.previousChunks.map((chunk) => chunk.id));
  const currentOnlyChunkIds = currentChunks
    .filter((chunk) => !previousChunkIds.has(chunk.id))
    .map((chunk) => chunk.id);

  if (currentOnlyChunkIds.length > 0) {
    await prisma.chunk.deleteMany({
      where: { id: { in: currentOnlyChunkIds } },
    });
  }

  if (state.previousDocument) {
    await prisma.document.update({
      where: { id: state.previousDocument.id },
      data: {
        sourceId: state.previousDocument.sourceId,
        path: state.previousDocument.path,
        mimeType: state.previousDocument.mimeType,
        contentHash: state.previousDocument.contentHash,
        metadata: state.previousDocument.metadata as any,
        status: state.previousDocument.status,
      },
    });

    for (const chunk of state.previousChunks) {
      await prisma.chunk.upsert({
        where: { id: chunk.id },
        create: {
          id: chunk.id,
          documentId: chunk.documentId,
          indexVersionId: chunk.indexVersionId,
          text: chunk.text,
          textHash: chunk.textHash,
          tokenCount: chunk.tokenCount,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          metadata: chunk.metadata as any,
        },
        update: {
          documentId: chunk.documentId,
          indexVersionId: chunk.indexVersionId,
          text: chunk.text,
          textHash: chunk.textHash,
          tokenCount: chunk.tokenCount,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          metadata: chunk.metadata as any,
        },
      });
    }
    return;
  }

  await prisma.chunk.deleteMany({
    where: { documentId: state.documentId },
  });
  await prisma.document.delete({
    where: { id: state.documentId },
  }).catch(() => undefined);
}
