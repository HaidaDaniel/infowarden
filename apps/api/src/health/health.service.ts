import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { QdrantClient } from '@qdrant/js-client-rest';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { EmbeddingErrorDetails } from '../embeddings/embedding-provider.error';
import { getErrorMessage } from '../common/app-error';

export interface DependencyHealth {
  status: 'up' | 'down' | 'not_configured';
  error?: string;
  code?: string;
  retryable?: boolean;
  details?: Record<string, unknown> | EmbeddingErrorDetails;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  async checkDatabase(): Promise<DependencyHealth> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: getErrorMessage(error), code: 'database_unavailable' };
    }
  }

  async checkRedis(): Promise<DependencyHealth> {
    const client = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 1000,
    });

    try {
      await client.connect();
      await client.ping();
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: getErrorMessage(error), code: 'redis_unavailable' };
    } finally {
      client.disconnect();
    }
  }

  async checkQdrant(): Promise<DependencyHealth> {
    const client = new QdrantClient({
      host: this.configService.get<string>('QDRANT_HOST'),
      port: this.configService.get<number>('QDRANT_PORT'),
      https: this.configService.get<boolean>('QDRANT_HTTPS') || false,
      timeout: 1000,
    });

    try {
      await client.getCollections();
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: getErrorMessage(error), code: 'qdrant_unavailable' };
    }
  }

  async checkEmbeddings(): Promise<DependencyHealth> {
    const result = await this.embeddingsService.preflight();
    if (result.status === 'up') {
      return {
        status: 'up',
        details: {
          baseUrl: result.baseUrl,
          model: result.model,
          dimension: result.dimension,
        },
      };
    }

    return {
      status: result.status,
      error: result.error?.message,
      code: result.error?.code,
      retryable: result.error?.retryable,
      details: result.error?.details,
    };
  }

  async checkAll() {
    const [database, redis, qdrant, embeddings] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQdrant(),
      this.checkEmbeddings(),
    ]);
    const healthy = [database, redis, qdrant, embeddings].every((service) => service.status === 'up');

    return {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database,
        redis,
        qdrant,
        embeddings,
      },
    };
  }
}
