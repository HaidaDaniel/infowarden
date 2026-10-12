import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  VectorBackendInput,
  VectorBackendsService,
} from "./vector-backends.service";

@ApiTags("vector-backends")
@Controller("vector-backends")
export class VectorBackendsController {
  constructor(private readonly vectorBackendsService: VectorBackendsService) {}

  @Get()
  @ApiOperation({ summary: "List registered Qdrant vector backends" })
  async list() {
    return this.vectorBackendsService.list();
  }

  @Get("read-model")
  @ApiOperation({
    summary:
      "List vector backend operations read model for Studio and MCP clients",
  })
  async readModel() {
    return this.vectorBackendsService.readModel();
  }

  @Post()
  @ApiOperation({ summary: "Register an independent Qdrant vector backend" })
  @ApiResponse({ status: 201, description: "Vector backend registered" })
  async create(@Body() body: VectorBackendInput) {
    return this.vectorBackendsService.create(body);
  }

  @Post("health/refresh")
  @ApiOperation({
    summary: "Refresh health and bounded inventory for all enabled backends",
  })
  async refreshAllHealth() {
    return this.vectorBackendsService.refreshAllHealth();
  }

  @Get(":id")
  @ApiOperation({ summary: "Inspect a registered Qdrant vector backend" })
  async findOne(@Param("id") id: string) {
    return this.vectorBackendsService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a vector backend without exposing secrets" })
  async update(
    @Param("id") id: string,
    @Body() body: Partial<VectorBackendInput>,
  ) {
    return this.vectorBackendsService.update(id, body);
  }

  @Post(":id/health")
  @ApiOperation({
    summary: "Refresh health and bounded inventory for one backend",
  })
  async refreshHealth(@Param("id") id: string) {
    return this.vectorBackendsService.refreshHealth(id);
  }
}
