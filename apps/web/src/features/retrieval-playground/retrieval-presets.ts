import type { KnowledgeBaseDetailResponse } from '../../lib/types';

type RetrievalProfile = KnowledgeBaseDetailResponse['retrievalPlayground']['profiles'][number];

export const SIMPLE_RETRIEVAL_PRESETS = [
  {
    key: 'default',
    label: 'Recommended — Dense',
    description: 'Best measured quality/speed balance. Requires an embedding provider.',
  },
  {
    key: 'lexical',
    label: 'No embeddings — Lexical',
    description: 'Uses BM25 from PostgreSQL and does not require query embeddings.',
  },
  {
    key: 'hybrid',
    label: 'Hybrid',
    description: 'Combines dense and BM25 retrieval with higher latency.',
  },
] as const;

const SIMPLE_PRESET_KEYS: Set<string> = new Set(SIMPLE_RETRIEVAL_PRESETS.map((preset) => preset.key));

export function isLexicalRetrievalProfile(profileKey: string): boolean {
  return profileKey === 'lexical' || profileKey.startsWith('lexical-');
}

export function simplePresetDescription(profileKey: string): string | undefined {
  return SIMPLE_RETRIEVAL_PRESETS.find((preset) => preset.key === profileKey)?.description;
}

export function retrievalStageVisibility(profileKey: string) {
  const lexicalOnly = isLexicalRetrievalProfile(profileKey);
  const hybrid = profileKey === 'hybrid' || profileKey.startsWith('hybrid-');
  return {
    showDense: !lexicalOnly,
    showLexical: lexicalOnly || hybrid,
    showFused: hybrid,
  };
}

export function advancedRetrievalProfiles(profiles: RetrievalProfile[]): RetrievalProfile[] {
  return profiles.filter((profile) => !SIMPLE_PRESET_KEYS.has(profile.key));
}
