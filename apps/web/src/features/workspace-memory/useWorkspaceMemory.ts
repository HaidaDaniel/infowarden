import { useEffect, useState, type FormEvent } from 'react';
import { splitTags } from '../../components/workspace/KnowledgeBasePanels';
import {
  createDecisionMemoryEntry,
  createFactMemoryEntry,
  createSessionSummaryMemoryEntry,
  fetchMemoryEntries,
  fetchRecentDecisions,
  searchMemoryEntries,
} from '../../lib/api';
import type { MemoryEntry, MemoryEntryType, MemorySearchResponse } from '../../lib/types';

export type MemoryFormKind = 'fact' | 'decision' | 'session_summary';

export function useWorkspaceMemory(identifier: string | undefined, connectionRevision: number) {
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [recentDecisions, setRecentDecisions] = useState<MemoryEntry[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryFilterType, setMemoryFilterType] = useState<MemoryEntryType | ''>('');
  const [memoryFilterTag, setMemoryFilterTag] = useState('');
  const [memoryFilterSessionId, setMemoryFilterSessionId] = useState('');
  const [memorySearchQuery, setMemorySearchQuery] = useState('');
  const [memorySearchResults, setMemorySearchResults] = useState<MemorySearchResponse | null>(null);
  const [memorySearchLoading, setMemorySearchLoading] = useState(false);
  const [memorySearchError, setMemorySearchError] = useState<string | null>(null);
  const [memoryFormKind, setMemoryFormKind] = useState<MemoryFormKind>('fact');
  const [memoryTitle, setMemoryTitle] = useState('');
  const [memoryBody, setMemoryBody] = useState('');
  const [memorySummary, setMemorySummary] = useState('');
  const [memoryTags, setMemoryTags] = useState('');
  const [memoryAuthoredBy, setMemoryAuthoredBy] = useState('');
  const [memorySessionId, setMemorySessionId] = useState('');
  const [memoryCreateLoading, setMemoryCreateLoading] = useState(false);
  const [memoryCreateError, setMemoryCreateError] = useState<string | null>(null);
  const [memoryCreateSuccess, setMemoryCreateSuccess] = useState<string | null>(null);

  const refreshMemoryData = async () => {
    if (!identifier) {
      return;
    }

    const [entries, decisions] = await Promise.all([
      fetchMemoryEntries(identifier, {
        entryType: memoryFilterType,
        tag: memoryFilterTag,
        sessionId: memoryFilterSessionId,
      }),
      fetchRecentDecisions(identifier, 5),
    ]);
    setMemoryEntries(entries);
    setRecentDecisions(decisions.results);
  };

  useEffect(() => {
    if (!identifier) {
      return;
    }

    let cancelled = false;
    const loadMemory = async () => {
      setMemoryLoading(true);
      try {
        const [entries, decisions] = await Promise.all([
          fetchMemoryEntries(identifier, {
            entryType: memoryFilterType,
            tag: memoryFilterTag,
            sessionId: memoryFilterSessionId,
          }),
          fetchRecentDecisions(identifier, 5),
        ]);
        if (!cancelled) {
          setMemoryEntries(entries);
          setRecentDecisions(decisions.results);
          setMemoryError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setMemoryEntries([]);
          setRecentDecisions([]);
          setMemoryError(loadError instanceof Error ? loadError.message : 'Failed to load memory entries');
        }
      } finally {
        if (!cancelled) {
          setMemoryLoading(false);
        }
      }
    };

    void loadMemory();
    return () => {
      cancelled = true;
    };
  }, [identifier, connectionRevision, memoryFilterType, memoryFilterTag, memoryFilterSessionId]);

  const submitMemorySearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identifier || !memorySearchQuery.trim()) {
      setMemorySearchError('Enter a memory search query.');
      return;
    }

    setMemorySearchLoading(true);
    try {
      const results = await searchMemoryEntries(identifier, {
        query: memorySearchQuery,
        topK: 6,
        profileKey: 'memory-recall',
      });
      setMemorySearchResults(results);
      setMemorySearchError(null);
    } catch (loadError) {
      setMemorySearchResults(null);
      setMemorySearchError(loadError instanceof Error ? loadError.message : 'Failed to search memory');
    } finally {
      setMemorySearchLoading(false);
    }
  };

  const submitMemoryEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identifier) {
      return;
    }

    const body = memoryBody.trim();
    const title = memoryTitle.trim();
    const sessionId = memorySessionId.trim();
    const tags = splitTags(memoryTags);
    const commonFields = {
      body,
      summary: memorySummary.trim() || undefined,
      tags,
      authoredBy: memoryAuthoredBy.trim() || undefined,
      sessionId: sessionId || undefined,
    };

    if (!body) {
      setMemoryCreateError('Body is required.');
      return;
    }
    if (memoryFormKind === 'decision' && !title) {
      setMemoryCreateError('Decision notes require a title.');
      return;
    }
    if (memoryFormKind === 'session_summary' && !sessionId) {
      setMemoryCreateError('Session summaries require a session id.');
      return;
    }

    setMemoryCreateLoading(true);
    try {
      if (memoryFormKind === 'decision') {
        await createDecisionMemoryEntry(identifier, { ...commonFields, title });
      } else if (memoryFormKind === 'session_summary') {
        await createSessionSummaryMemoryEntry(identifier, {
          ...commonFields,
          title: title || undefined,
          sessionId,
        });
      } else {
        await createFactMemoryEntry(identifier, { ...commonFields, title: title || undefined });
      }

      setMemoryTitle('');
      setMemoryBody('');
      setMemorySummary('');
      setMemoryTags('');
      setMemorySessionId('');
      setMemoryCreateError(null);
      setMemoryCreateSuccess('Memory entry saved.');
      await refreshMemoryData();
    } catch (createError) {
      setMemoryCreateSuccess(null);
      setMemoryCreateError(createError instanceof Error ? createError.message : 'Failed to save memory entry');
    } finally {
      setMemoryCreateLoading(false);
    }
  };

  return {
    memoryEntries,
    recentDecisions,
    memoryLoading,
    memoryError,
    memoryFilterType,
    setMemoryFilterType,
    memoryFilterTag,
    setMemoryFilterTag,
    memoryFilterSessionId,
    setMemoryFilterSessionId,
    memorySearchQuery,
    setMemorySearchQuery,
    memorySearchResults,
    memorySearchLoading,
    memorySearchError,
    memoryFormKind,
    setMemoryFormKind,
    memoryTitle,
    setMemoryTitle,
    memoryBody,
    setMemoryBody,
    memorySummary,
    setMemorySummary,
    memoryTags,
    setMemoryTags,
    memoryAuthoredBy,
    setMemoryAuthoredBy,
    memorySessionId,
    setMemorySessionId,
    memoryCreateLoading,
    memoryCreateError,
    memoryCreateSuccess,
    setMemoryCreateError,
    setMemoryCreateSuccess,
    refreshMemoryData,
    submitMemorySearch,
    submitMemoryEntry,
  };
}
