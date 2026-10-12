import {
  BackendApiClient,
  KnowledgeBase,
  SystemResourceStatus,
  WorkspaceLifecycleResponse,
  WorkspaceResourceStatus,
  VectorBackendsReadModel,
  WorkspaceVectorPlacement,
  VectorMaterializationOperation,
} from '../backend-client';

export interface ListKnowledgeBasesResult {
  knowledgeBases: Array<{
    id: string;
    name: string;
    activeIndexVersionId?: string;
    status: string;
    unavailableReason?: string;
  }>;
  count: number;
}

export interface ListWorkspacesResult {
  workspaces: Array<{
    id: string;
    slug?: string;
    name: string;
    kind: string;
    activeIndexVersionId?: string;
    status: string;
    unavailableReason?: string;
    compatibility: {
      legacyKnowledgeBaseId: string;
      legacyToolFamily: string;
    };
  }>;
  count: number;
}

export interface GetIndexStatusResult {
  knowledgeBaseId: string;
  activeIndexVersionId?: string;
  status?: string;
  embeddingModel?: string;
  vectorCollectionName?: string;
}

export interface GetWorkspaceStatusResult {
  workspaceId: string;
  slug?: string;
  name: string;
  kind: string;
  activeIndexVersionId?: string;
  status: string;
  unavailableReason?: string;
  defaultIndexProfile?: string;
  defaultRetrievalProfile?: string;
  compatibility: {
    legacyKnowledgeBaseId: string;
    legacyToolsRemainAvailable: boolean;
  };
}

export interface GetResourceStatusResult extends SystemResourceStatus {}

export interface GetWorkspaceResourceStatusResult extends WorkspaceResourceStatus {}

export interface WorkspaceLifecycleResult extends WorkspaceLifecycleResponse {}

export interface GetVectorBackendsResult extends VectorBackendsReadModel {}

export interface WorkspaceVectorPlacementResult extends WorkspaceVectorPlacement {}

export interface VectorOperationResult extends VectorMaterializationOperation {}

export class ListKnowledgeBasesTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(): Promise<ListKnowledgeBasesResult> {
    const kbs = await this.client.listKnowledgeBases();
    return {
      knowledgeBases: kbs.map((kb: KnowledgeBase) => ({
        id: kb.id,
        name: kb.name,
        activeIndexVersionId: kb.activeIndexVersionId,
        status: workspaceStatus(kb),
        ...(unavailableReason(kb) ? { unavailableReason: unavailableReason(kb) } : {}),
      })),
      count: kbs.length,
    };
  }
}

export class ListWorkspacesTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(): Promise<ListWorkspacesResult> {
    const workspaces = await this.client.listWorkspaces();
    return {
      workspaces: workspaces.map((workspace: KnowledgeBase) => ({
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        kind: workspace.workspaceKind || workspace.workspace?.kind || 'general',
        activeIndexVersionId: workspace.activeIndexVersionId,
        status: workspaceStatus(workspace),
        ...(unavailableReason(workspace) ? { unavailableReason: unavailableReason(workspace) } : {}),
        compatibility: {
          legacyKnowledgeBaseId: workspace.id,
          legacyToolFamily: 'knowledge_base',
        },
      })),
      count: workspaces.length,
    };
  }
}

export class GetIndexStatusTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(knowledgeBaseId: string): Promise<GetIndexStatusResult> {
    const indexStatus = await this.client.getIndexStatus(knowledgeBaseId);

    if (!indexStatus) {
      return {
        knowledgeBaseId,
        status: 'no_index',
      };
    }

    return {
      knowledgeBaseId,
      activeIndexVersionId: indexStatus.id,
      status: indexStatus.status,
      embeddingModel: indexStatus.embeddingModel,
      vectorCollectionName: indexStatus.vectorCollectionName,
    };
  }
}

export class GetWorkspaceStatusTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string): Promise<GetWorkspaceStatusResult> {
    const workspace = await this.client.getWorkspace(workspaceId);

    return {
      workspaceId: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      kind: workspace.workspaceKind || workspace.workspace?.kind || 'general',
      activeIndexVersionId: workspace.activeIndexVersionId,
      status: workspaceStatus(workspace),
      ...(unavailableReason(workspace) ? { unavailableReason: unavailableReason(workspace) } : {}),
      defaultIndexProfile: workspace.defaultIndexProfile || workspace.workspace?.defaultIndexProfile,
      defaultRetrievalProfile: workspace.defaultRetrievalProfile || workspace.workspace?.defaultRetrievalProfile,
      compatibility: {
        legacyKnowledgeBaseId: workspace.id,
        legacyToolsRemainAvailable: true,
      },
    };
  }
}

function workspaceStatus(workspace: KnowledgeBase): string {
  if (workspace.availability?.status === 'available') {
    return 'ready';
  }
  if (workspace.availability?.status) {
    return workspace.availability.status;
  }
  return workspace.activeIndexVersionId ? 'ready' : 'unindexed';
}

function unavailableReason(workspace: KnowledgeBase): string | undefined {
  return workspace.availability?.status === 'unavailable' ? workspace.availability.reason : undefined;
}

export class GetResourceStatusTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(): Promise<GetResourceStatusResult> {
    return this.client.getResourceStatus();
  }
}

export class GetWorkspaceResourceStatusTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string): Promise<GetWorkspaceResourceStatusResult> {
    return this.client.getWorkspaceResourceStatus(workspaceId);
  }
}

export class LoadWorkspaceTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string, options: { storageProfile?: string } = {}): Promise<WorkspaceLifecycleResult> {
    return this.client.loadWorkspace(workspaceId, options);
  }
}

export class UnloadWorkspaceTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string): Promise<WorkspaceLifecycleResult> {
    return this.client.unloadWorkspace(workspaceId);
  }
}

export class GetVectorBackendsTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(): Promise<GetVectorBackendsResult> {
    return this.client.getVectorBackends();
  }
}

export class GetWorkspaceVectorPlacementTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string): Promise<WorkspaceVectorPlacementResult> {
    return this.client.getWorkspaceVectorPlacement(workspaceId);
  }
}

export class PinWorkspaceVectorBackendTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string, vectorBackendId: string): Promise<WorkspaceVectorPlacementResult> {
    return this.client.pinWorkspaceVectorBackend(workspaceId, vectorBackendId);
  }
}

export class RequestWorkspaceVectorMoveTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(workspaceId: string, targetVectorBackendId: string): Promise<VectorOperationResult> {
    return this.client.createVectorOperation(workspaceId, {
      kind: 'backend_move',
      targetVectorBackendId,
    });
  }
}

export class RollbackVectorOperationTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(operationId: string): Promise<VectorOperationResult> {
    return this.client.rollbackVectorOperation(operationId);
  }
}

export class CleanupVectorOperationTool {
  constructor(private readonly client: BackendApiClient) {}

  async execute(operationId: string): Promise<VectorOperationResult> {
    return this.client.cleanupVectorOperation(operationId);
  }
}
