import { describe, expect, it } from 'vitest';
import {
  advancedRetrievalProfiles,
  isLexicalRetrievalProfile,
  retrievalStageVisibility,
  SIMPLE_RETRIEVAL_PRESETS,
  simplePresetDescription,
} from './retrieval-presets';

describe('retrieval playground presets', () => {
  it('keeps the three simple choices ahead of advanced profiles', () => {
    expect(SIMPLE_RETRIEVAL_PRESETS.map((preset) => preset.key)).toEqual(['default', 'lexical', 'hybrid']);
    expect(
      advancedRetrievalProfiles([
        { key: 'default', name: 'Default' },
        { key: 'hybrid-rrf', name: 'Hybrid RRF' },
      ] as any),
    ).toEqual([{ key: 'hybrid-rrf', name: 'Hybrid RRF' }]);
  });

  it('identifies lexical profiles for reranker safety copy', () => {
    expect(isLexicalRetrievalProfile('lexical')).toBe(true);
    expect(isLexicalRetrievalProfile('lexical-bm25')).toBe(true);
    expect(isLexicalRetrievalProfile('hybrid')).toBe(false);
    expect(simplePresetDescription('lexical')).toContain('does not require query embeddings');
    expect(retrievalStageVisibility('lexical')).toEqual({ showDense: false, showLexical: true, showFused: false });
    expect(retrievalStageVisibility('hybrid')).toEqual({ showDense: true, showLexical: true, showFused: true });
  });
});
