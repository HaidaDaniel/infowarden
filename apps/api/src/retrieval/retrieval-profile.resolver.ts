import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RetrievalProfileSummary } from './retrieval.types';
import {
  resolveCandidateStrategy,
  resolveRetrievalProfileMetadata,
  type HybridSettings,
  type ResolvedRetrievalProfile,
} from './retrieval-internal.types';

const DEFAULT_LEXICAL_TOP_K = 10;

@Injectable()
export class RetrievalProfileResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    knowledgeBaseId: string,
    defaultProfileKey?: string,
    requestedProfileKey?: string,
  ): Promise<ResolvedRetrievalProfile> {
    const key = (requestedProfileKey || defaultProfileKey || 'default').trim() || 'default';
    const storedProfile = await this.prisma.retrievalProfile.findFirst({
      where: { knowledgeBaseId, key },
    });

    if (storedProfile) {
      const metadata = resolveRetrievalProfileMetadata(
        storedProfile.key,
        (storedProfile.metadata as Record<string, unknown>) || {},
      );
      const settings = this.resolveHybridSettings(metadata);
      return {
        knowledgeBaseId,
        key: storedProfile.key,
        name: storedProfile.name,
        intent: storedProfile.intent,
        denseTopK: storedProfile.denseTopK,
        lexicalEnabled: settings.lexicalEnabled,
        lexicalTopK: settings.lexicalTopK,
        scoreThreshold: storedProfile.scoreThreshold ?? undefined,
        neighborBefore: storedProfile.neighborBefore,
        neighborAfter: storedProfile.neighborAfter,
        tokenBudget: storedProfile.tokenBudget ?? undefined,
        grouping: storedProfile.grouping,
        recencyBoost: storedProfile.recencyBoost,
        metadata,
      };
    }

    const metadata = resolveRetrievalProfileMetadata(key, {});
    const settings = this.resolveHybridSettings(metadata);
    return {
      knowledgeBaseId,
      key,
      name: key === 'default' ? 'Default Retrieval' : this.labelizeProfileKey(key),
      intent: key.includes('code') ? 'code_search' : 'general_search',
      denseTopK: key.includes('brief') ? 6 : 10,
      lexicalEnabled: settings.lexicalEnabled,
      lexicalTopK: settings.lexicalTopK,
      scoreThreshold: undefined,
      neighborBefore: key.includes('code') ? 1 : 0,
      neighborAfter: key.includes('code') ? 1 : 0,
      tokenBudget: key.includes('brief') ? 900 : undefined,
      grouping: key.includes('code') ? 'path' : 'document',
      recencyBoost: key.includes('recent'),
      metadata,
    };
  }

  toSummary(profile: ResolvedRetrievalProfile): RetrievalProfileSummary {
    const settings = this.resolveHybridSettings(profile.metadata);
    return {
      key: profile.key,
      name: profile.name,
      intent: profile.intent,
      denseTopK: profile.denseTopK,
      lexicalEnabled: settings.lexicalEnabled,
      lexicalTopK: settings.lexicalTopK,
      scoreThreshold: profile.scoreThreshold,
      neighborBefore: profile.neighborBefore,
      neighborAfter: profile.neighborAfter,
      tokenBudget: profile.tokenBudget,
      grouping: profile.grouping,
      recencyBoost: profile.recencyBoost,
    };
  }

  resolveHybridSettings(metadata: Record<string, unknown>): HybridSettings {
    const lexicalEnabled =
      resolveCandidateStrategy(metadata) === 'lexical' ||
      metadata.lexicalEnabled === true ||
      metadata.hybridSearch === true ||
      metadata.hybridEnabled === true;
    const lexicalTopK = Math.min(Math.max(this.numberValue(metadata.lexicalTopK) || DEFAULT_LEXICAL_TOP_K, 1), 50);
    const denseWeight = this.numberValue(metadata.denseWeight) || this.numberValue(metadata.hybridDenseWeight) || 0.7;
    const lexicalWeight =
      this.numberValue(metadata.lexicalWeight) || this.numberValue(metadata.hybridLexicalWeight) || 0.3;

    return { lexicalEnabled, lexicalTopK, denseWeight, lexicalWeight };
  }

  private numberValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private labelizeProfileKey(key: string): string {
    return key
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
