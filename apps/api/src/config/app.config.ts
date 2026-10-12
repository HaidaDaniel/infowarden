import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string(),

  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  QDRANT_HOST: z.string(),
  QDRANT_PORT: z.coerce.number().default(6333),
  QDRANT_HTTP_URL: z.string(),
  QDRANT_GRPC_PORT: z.coerce.number().default(6334),
  QDRANT_HTTPS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  QDRANT_API_KEY_REF: z.string().optional(),
  VECTOR_BACKEND_HEALTH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(30000)
    .default(3000),
  VECTOR_BACKEND_HEALTH_REFRESH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  VECTOR_BACKEND_HEALTH_REFRESH_MS: z.coerce
    .number()
    .int()
    .min(10000)
    .max(3600000)
    .default(300000),

  EMBEDDING_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSION: z.coerce.number().int().positive().default(1536),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  EMBEDDING_API_KEY: z.string().optional(),

  API_KEY_AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ADMIN_API_KEY: z.string().optional(),
  API_MAX_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(25 * 1024 * 1024)
    .default(1024 * 1024),
  CORS_ORIGIN: z.string().default("*"),
  INDEXING_WORKER_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(8)
    .default(1),

  MANAGED_UPLOAD_STORAGE_DIR: z.string().default(".contextforge/uploads"),
  MANAGED_UPLOAD_MAX_ARCHIVE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),
  MANAGED_UPLOAD_MAX_EXTRACTED_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(250 * 1024 * 1024),
  MANAGED_UPLOAD_MAX_FILES: z.coerce.number().int().positive().default(5000),

  URL_SOURCE_MAX_PAGES: z.coerce.number().int().positive().default(25),
  URL_SOURCE_MAX_BYTES_PER_PAGE: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024),
  URL_SOURCE_TOTAL_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
  URL_SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  URL_SOURCE_SAME_HOST: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  URL_SOURCE_RESPECT_ROBOTS: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  SOURCE_TRIGGER_SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SOURCE_TRIGGER_SCHEDULER_POLL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60000),
  SOURCE_TRIGGER_WEBHOOK_SECRET: z.string().optional(),
  SOURCE_TRIGGER_WATCH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function validateConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      path: e.path.join("."),
      message: e.message,
    }));

    console.error("Invalid environment configuration:");
    console.error(JSON.stringify(errors, null, 2));

    throw new Error("Invalid environment configuration");
  }

  if (result.data.API_KEY_AUTH_ENABLED && !result.data.ADMIN_API_KEY?.trim()) {
    console.error(
      JSON.stringify(
        [
          {
            path: "ADMIN_API_KEY",
            message: "ADMIN_API_KEY is required when API_KEY_AUTH_ENABLED=true",
          },
        ],
        null,
        2,
      ),
    );
    throw new Error("Invalid environment configuration");
  }

  if (result.data.NODE_ENV === "production") {
    const productionErrors: Array<{ path: string; message: string }> = [];
    if (!result.data.API_KEY_AUTH_ENABLED) {
      productionErrors.push({
        path: "API_KEY_AUTH_ENABLED",
        message: "API_KEY_AUTH_ENABLED must be true when NODE_ENV=production",
      });
    }
    if (isMissingProductionValue(result.data.ADMIN_API_KEY)) {
      productionErrors.push({
        path: "ADMIN_API_KEY",
        message: "ADMIN_API_KEY is required when NODE_ENV=production",
      });
    }
    if (
      isMissingProductionValue(result.data.CORS_ORIGIN) ||
      result.data.CORS_ORIGIN.trim() === "*"
    ) {
      productionErrors.push({
        path: "CORS_ORIGIN",
        message: "CORS_ORIGIN must be a narrow explicit origin when NODE_ENV=production",
      });
    }

    if (productionErrors.length > 0) {
      console.error(JSON.stringify(productionErrors, null, 2));
      throw new Error("Invalid environment configuration");
    }
  }

  return result.data;
}

function isMissingProductionValue(value?: string) {
  const trimmed = value?.trim() || "";
  return !trimmed || trimmed.startsWith("__REQUIRED_");
}
