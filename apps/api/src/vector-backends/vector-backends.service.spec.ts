import { VectorBackendState } from "@prisma/client";
import { VectorBackendsService } from "./vector-backends.service";

describe("VectorBackendsService", () => {
  const processEnv = process.env;

  afterEach(() => {
    process.env = processEnv;
    jest.restoreAllMocks();
  });

  it("imports the environment endpoint as a stable redacted default backend", async () => {
    const { service, prisma } = createService({
      QDRANT_HTTP_URL: "http://qdrant.local:6333",
      QDRANT_API_KEY_REF: "QDRANT_SECRET",
    });
    prisma.vectorBackend.findFirst.mockResolvedValue(null);
    prisma.vectorBackend.findUnique.mockResolvedValue(null);
    prisma.vectorBackend.create.mockResolvedValue(
      backend({ apiKeyRef: "QDRANT_SECRET" }),
    );
    prisma.vectorBackend.findMany.mockResolvedValue([
      backend({ apiKeyRef: "QDRANT_SECRET" }),
    ]);

    const result = await service.list();

    expect(prisma.vectorBackend.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "default-qdrant",
          baseUrl: "http://qdrant.local:6333",
          apiKeyRef: "QDRANT_SECRET",
        }),
      }),
    );
    expect(result[0]).toMatchObject({
      name: "backend-1",
      hasApiKeyRef: true,
      apiKeyRef: "[configured]",
    });
    expect(JSON.stringify(result)).not.toContain("QDRANT_SECRET");
  });

  it("rejects invalid and credential-bearing endpoint URLs", async () => {
    const { service } = createService();

    await expect(
      service.create({
        name: "bad",
        baseUrl: "https://user:pass@qdrant.local",
      }),
    ).rejects.toMatchObject({ code: "vector_backend_invalid" });
  });

  it("reports duplicate endpoint registration without leaking a secret reference", async () => {
    const { service, prisma } = createService();
    prisma.vectorBackend.create.mockRejectedValue({ code: "P2002" });

    await expect(
      service.create({
        name: "node-a",
        baseUrl: "http://qdrant-a:6333",
        apiKeyRef: "NODE_A_SECRET",
      }),
    ).rejects.toMatchObject({ code: "vector_backend_duplicate_endpoint" });
  });

  it("marks missing-secret backends offline with a structured code", async () => {
    const { service, prisma } = createService();
    const record = backend({ apiKeyRef: "MISSING_QDRANT_SECRET" });
    prisma.vectorBackend.findUnique.mockResolvedValue(record);
    prisma.vectorBackend.update.mockImplementation(async ({ data }) => ({
      ...record,
      ...data,
    }));

    const result = await service.refreshHealth(record.id);

    expect(prisma.vectorBackend.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: VectorBackendState.offline,
          lastErrorCode: "vector_backend_api_key_missing",
        }),
      }),
    );
    expect(result).toMatchObject({
      state: VectorBackendState.offline,
      hasApiKeyRef: true,
    });
    expect(JSON.stringify(result)).not.toContain("MISSING_QDRANT_SECRET");
  });

  it("records bounded health inventory for an independent backend", async () => {
    const { service, prisma, adapter } = createService();
    const record = backend();
    prisma.vectorBackend.findUnique.mockResolvedValue(record);
    prisma.vectorBackend.update.mockImplementation(async ({ data }) => ({
      ...record,
      ...data,
    }));
    adapter.createClientForBackendRecord.mockReturnValue({
      getCollections: jest
        .fn()
        .mockResolvedValue({ collections: [{ name: "one" }] }),
      getCollection: jest.fn().mockResolvedValue({ points_count: 42 }),
    });
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "32" }),
      arrayBuffer: async () => Buffer.from('{"result":{"version":"1.12.0"}}'),
    } as any);

    const result = await service.refreshHealth(record.id);

    expect(result).toMatchObject({
      state: VectorBackendState.enabled,
      lastErrorCode: null,
    });
    expect(prisma.vectorBackend.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          observedResources: expect.objectContaining({
            collectionCount: 1,
            vectorCount: 42,
          }),
          healthMetadata: expect.objectContaining({
            healthy: true,
            version: "1.12.0",
          }),
        }),
      }),
    );
  });

  it("refreshes two independent mocked Qdrant endpoints without fan-out search", async () => {
    const { service, prisma, adapter } = createService();
    const first = backend({
      id: "backend-a",
      name: "backend-a",
      baseUrl: "http://qdrant-a:6333",
    });
    const second = backend({
      id: "backend-b",
      name: "backend-b",
      baseUrl: "http://qdrant-b:6333",
    });
    prisma.vectorBackend.findFirst.mockResolvedValue(first);
    prisma.vectorBackend.findMany.mockResolvedValue([first, second]);
    prisma.vectorBackend.update.mockImplementation(async ({ where, data }) => ({
      ...(where.id === first.id ? first : second),
      ...data,
    }));
    adapter.createClientForBackendRecord.mockReturnValue({
      getCollections: jest.fn().mockResolvedValue({ collections: [] }),
      getCollection: jest.fn(),
    });
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "32" }),
      arrayBuffer: async () => Buffer.from('{"result":{"version":"1.12.0"}}'),
    } as any);

    const result = await service.refreshAllHealth();

    expect(result).toHaveLength(2);
    expect(adapter.createClientForBackendRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "backend-a",
        baseUrl: "http://qdrant-a:6333",
      }),
      expect.any(Number),
    );
    expect(adapter.createClientForBackendRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "backend-b",
        baseUrl: "http://qdrant-b:6333",
      }),
      expect.any(Number),
    );
  });

  it("returns a redacted operations read model with assigned workspaces", async () => {
    const { service, prisma } = createService();
    const record = backend({ apiKeyRef: "QDRANT_SECRET" });
    prisma.vectorBackend.findFirst.mockResolvedValue(record);
    prisma.vectorBackend.findMany.mockResolvedValue([record]);
    prisma.workspaceVectorPlacement.findMany.mockResolvedValue([
      {
        id: "placement-1",
        vectorBackendId: record.id,
        mode: "capacity_assisted",
        state: "degraded",
        collectionAlias: "workspace-docs",
        physicalCollectionName: "workspace-docs-v1",
        servingRevisionId: "serving-1",
        activeIndexBuildId: "build-1",
        reasonSnapshot: { reason: "vector_backend_unavailable" },
        capacitySnapshot: { requiredDiskBytes: 100 },
        updatedAt: new Date("2026-07-18T01:00:00.000Z"),
        knowledgeBase: {
          id: "kb-1",
          slug: "docs",
          name: "Docs",
          workspaceKind: "docs",
          servingRevisionState: "active",
          activeIndexVersionId: "idx-1",
        },
      },
    ]);
    prisma.vectorMaterializationOperation.findMany.mockResolvedValue([
      {
        id: "op-1",
        knowledgeBaseId: "kb-1",
        kind: "backend_move",
        state: "cutover_complete",
        sourceVectorBackendId: record.id,
        targetVectorBackendId: "backend-2",
        sourceCollectionName: "workspace-docs-v1",
        targetCollectionName: "workspace-docs-v2",
        servingRevisionId: "serving-1",
        rollbackUntil: new Date("2026-07-19T00:00:00.000Z"),
        cleanupAfter: null,
        validationSummary: { targetCount: 10 },
        errorSummary: {},
        updatedAt: new Date("2026-07-18T02:00:00.000Z"),
      },
    ]);

    const result = await service.readModel();

    expect(result.policy).toMatchObject({
      transparentSharding: false,
      replicas: false,
    });
    expect(result.backends[0]).toMatchObject({
      hasApiKeyRef: true,
      apiKeyRef: "[configured]",
      assignedWorkspaceCount: 1,
      assignedWorkspaces: [
        expect.objectContaining({
          workspace: expect.objectContaining({ slug: "docs" }),
          lifecycleErrors: [
            expect.objectContaining({
              code: "vector_backend_unavailable",
              state: "degraded",
            }),
          ],
        }),
      ],
      operations: [expect.objectContaining({ id: "op-1" })],
    });
    expect(JSON.stringify(result)).not.toContain("QDRANT_SECRET");
  });
});

function createService(config: Record<string, unknown> = {}) {
  const prisma: Record<string, any> = {
    vectorBackend: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    workspaceVectorPlacement: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    vectorMaterializationOperation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
  };
  const adapter = {
    createClientForBackendRecord: jest.fn(),
  };
  return {
    service: new VectorBackendsService(
      prisma as any,
      configService as any,
      adapter as any,
    ),
    prisma,
    adapter,
  };
}

function backend(overrides: Record<string, unknown> = {}) {
  return {
    id: "backend-1",
    name: "backend-1",
    baseUrl: "http://qdrant-a:6333",
    apiKeyRef: null,
    tlsVerify: true,
    networkPolicy: {},
    labels: [],
    state: VectorBackendState.enabled,
    capacityHints: {},
    observedResources: {},
    healthMetadata: {},
    lastHealthAt: null,
    lastErrorCode: null,
    createdAt: new Date("2026-07-18T00:00:00.000Z"),
    updatedAt: new Date("2026-07-18T00:00:00.000Z"),
    ...overrides,
  };
}
