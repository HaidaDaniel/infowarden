import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { WorkspaceVectorPlacementService } from "./workspace-vector-placement.service";
import { VectorMaterializationQueueService } from "./vector-materialization-queue.service";

@ApiTags("workspace-vector-placement")
@Controller()
export class WorkspaceVectorPlacementController {
  constructor(
    private readonly placements: WorkspaceVectorPlacementService,
    private readonly vectorOperationsQueue: VectorMaterializationQueueService,
  ) {}

  @Get([
    "workspaces/:identifier/vector-placement",
    "knowledge-bases/:identifier/vector-placement",
  ])
  @ApiOperation({
    summary: "Resolve the one active vector backend placement for a workspace",
  })
  async get(@Param("identifier") identifier: string) {
    return this.placements.resolve(identifier);
  }

  @Post([
    "workspaces/:identifier/vector-placement/pin",
    "knowledge-bases/:identifier/vector-placement/pin",
  ])
  @ApiOperation({ summary: "Pin a workspace to an eligible vector backend" })
  async pin(
    @Param("identifier") identifier: string,
    @Body() body: { vectorBackendId: string },
  ) {
    return this.placements.pin(identifier, body.vectorBackendId);
  }

  @Post([
    "workspaces/:identifier/vector-placement/unpin",
    "knowledge-bases/:identifier/vector-placement/unpin",
  ])
  @ApiOperation({
    summary: "Unpin without moving the existing stable vector backend",
  })
  async unpin(@Param("identifier") identifier: string) {
    return this.placements.unpin(identifier);
  }

  @Post(["workspaces/:identifier/vector-operations", "knowledge-bases/:identifier/vector-operations"])
  async createOperation(@Param("identifier") identifier: string, @Body() body: { kind: "full_rebuild" | "backend_move"; targetVectorBackendId?: string; idempotencyKey?: string; rollbackRetentionHours?: number; strategy?: "compatible_copy" | "canonical_reembed" }) {
    const operation = await this.placements.createMaterializationOperation({ identifier, ...body });
    return this.vectorOperationsQueue.enqueueBuild(operation.id, body.strategy);
  }

  @Get("vector-operations/:operationId")
  async getOperation(@Param("operationId") operationId: string) {
    return this.placements.getMaterializationOperation(operationId);
  }

  @Post("vector-operations/:operationId/build")
  async build(@Param("operationId") operationId: string) {
    return this.vectorOperationsQueue.enqueueBuild(operationId);
  }

  @Post("vector-operations/:operationId/build-compatible-copy")
  async compatibleCopy(@Param("operationId") operationId: string) {
    return this.vectorOperationsQueue.enqueueBuild(operationId, "compatible_copy");
  }

  @Post("vector-operations/:operationId/cutover")
  async cutover(@Param("operationId") operationId: string) {
    return this.placements.cutoverOperation(operationId);
  }

  @Post("vector-operations/:operationId/rollback")
  async rollback(@Param("operationId") operationId: string) {
    return this.placements.rollbackOperation(operationId);
  }

  @Post("vector-operations/:operationId/cleanup")
  async cleanup(@Param("operationId") operationId: string) {
    return this.placements.scheduleOperationCleanup(operationId);
  }

  @Post("vector-operations/:operationId/execute-cleanup")
  async executeCleanup(@Param("operationId") operationId: string) {
    return this.placements.executeOperationCleanup(operationId);
  }
}
