import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { KnowledgeBaseDetailResponse } from '../../lib/types';
import { useRetrievalPlayground } from './useRetrievalPlayground';

function detail(id = 'a', slug = 'alpha', profile = 'default') {
  return {
    knowledgeBase: { id, slug, defaultRetrievalProfile: profile },
    retrievalPlayground: {
      defaultProfileKey: profile,
      profiles: [],
      suggestedRequest: { topK: 6, tokenBudget: 1200, queryPlaceholder: 'Initial query' },
    },
  } as unknown as KnowledgeBaseDetailResponse;
}

describe('retrieval workspace initialization', () => {
  it('preserves edited settings when the normal poll supplies a fresh detail object', () => {
    const { result, rerender } = renderHook(({ response }) => useRetrievalPlayground('alpha', response), {
      initialProps: { response: detail() },
    });
    act(() => {
      result.current.setPlaygroundProfile('hybrid');
      result.current.setPlaygroundTopK(11);
      result.current.setPlaygroundTokenBudget(2500);
      result.current.setPlaygroundQuery('Edited query');
      result.current.setPlaygroundPathPrefix('notes/');
    });
    rerender({ response: detail() });
    expect(result.current.playgroundProfile).toBe('hybrid');
    expect(result.current.playgroundTopK).toBe(11);
    expect(result.current.playgroundTokenBudget).toBe(2500);
    expect(result.current.playgroundQuery).toBe('Edited query');
    expect(result.current.playgroundPathPrefix).toBe('notes/');
  });

  it('waits for matching detail and initializes a different workspace with fresh defaults', () => {
    const { result, rerender } = renderHook(
      ({ identifier, response }) => useRetrievalPlayground(identifier, response),
      {
        initialProps: { identifier: 'alpha', response: detail() },
      },
    );
    act(() => result.current.setPlaygroundTopK(11));
    rerender({ identifier: 'beta', response: detail() });
    expect(result.current.playgroundTopK).toBe(11);
    rerender({ identifier: 'beta', response: detail('b', 'beta') });
    expect(result.current.playgroundTopK).toBe(6);
    expect(result.current.playgroundProfile).toBe('default');
    expect(result.current.playgroundQuery).toBe('Initial query');
  });

  it('preserves the workspace default when no advanced profiles are persisted', () => {
    const { result } = renderHook(() => useRetrievalPlayground('alpha', detail('a', 'alpha', 'docs-qa')));
    expect(result.current.playgroundProfile).toBe('docs-qa');
  });
});
