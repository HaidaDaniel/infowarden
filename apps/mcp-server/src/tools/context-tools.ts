import { BackendApiClient } from '../backend-client';

export interface GetDocumentContextResult {
  documentId: string;
  path: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface GetChunkNeighborsResult {
  chunkId: string;
  neighbors: Array<{
    chunkId: string;
    chunkIndex: number;
    text: string;
    startLine?: number;
    endLine?: number;
    metadata: Record<string, unknown>;
  }>;
}

export class GetDocumentContextTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(options: {
    documentId: string;
    chunkId?: string;
    startLine?: number;
    endLine?: number;
    maxChars?: number;
  }): Promise<GetDocumentContextResult> {
    return this.client.getDocumentContext(options);
  }
}

export class GetChunkNeighborsTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(
    chunkId: string,
    options: { before?: number; after?: number } = {},
  ): Promise<GetChunkNeighborsResult> {
    return this.client.getChunkNeighbors(chunkId, options);
  }
}
