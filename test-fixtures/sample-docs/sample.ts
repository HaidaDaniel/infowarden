/**
 * Sample TypeScript file for testing the local indexing pipeline.
 * This file demonstrates code parsing and chunking.
 */

export interface SearchOptions {
  query: string;
  limit?: number;
}

export interface SearchResult {
  text: string;
  score: number;
}

export function searchDocuments(options: SearchOptions): SearchResult[] {
  // Search implementation
  return [];
}
