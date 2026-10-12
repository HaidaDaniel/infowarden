import { SimpleChunker } from './simple.chunker';
import {
  STRUCTURE_AWARE_CHUNKER_COMPATIBILITY_HASH,
  STRUCTURE_AWARE_CHUNKER_VERSION,
  StructureAwareChunker,
} from './structure-aware.chunker';

describe('StructureAwareChunker', () => {
  function createChunker() {
    return new StructureAwareChunker(new SimpleChunker());
  }

  it('chunks Markdown by heading sections and preserves table and code metadata', () => {
    const chunks = createChunker().chunk(
      [
        '# Guide',
        '',
        'Intro text.',
        '',
        '## API Table',
        '',
        '| Name | Value |',
        '| --- | --- |',
        '| foo | bar |',
        '',
        '```ts',
        'export function run() { return true; }',
        '```',
      ].join('\n'),
      {
        strategy: 'structure_aware',
        language: 'markdown',
        path: 'docs/guide.md',
        maxChars: 500,
      },
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata).toMatchObject({
      chunkerVersion: STRUCTURE_AWARE_CHUNKER_VERSION,
      chunkerCompatibilityHash: STRUCTURE_AWARE_CHUNKER_COMPATIBILITY_HASH,
      heading: 'Guide',
      anchor: 'guide',
      sourceRange: { startLine: 1, endLine: 4 },
    });
    expect(chunks[1].metadata).toMatchObject({
      heading: 'API Table',
      headingHierarchy: ['Guide', 'API Table'],
      blockKinds: expect.arrayContaining(['table', 'code_fence']),
    });
    expect(chunks[1].text).toContain('| foo | bar |');
    expect(chunks[1].text).toContain('```ts');
  });

  it('chunks TypeScript by symbols and preserves imports, exports, and line ranges', () => {
    const chunks = createChunker().chunk(
      [
        "import { readFile } from 'node:fs/promises';",
        '',
        'export interface Runner {',
        '  run(): Promise<void>;',
        '}',
        '',
        'export async function execute() {',
        '  await readFile("x");',
        '}',
      ].join('\n'),
      {
        strategy: 'structure_aware',
        language: 'typescript',
        path: 'src/run.ts',
        maxChars: 500,
      },
    );

    expect(chunks.map((chunk) => chunk.metadata?.symbol).filter(Boolean)).toEqual([
      'Runner',
      'execute',
    ]);
    expect(chunks[0].metadata).toMatchObject({
      chunkerStrategy: 'code_preamble',
      imports: ['node:fs/promises'],
      sourceRange: { startLine: 1, endLine: 2 },
    });
    expect(chunks[1].metadata).toMatchObject({
      symbol: 'Runner',
      symbolKind: 'interface',
      exports: ['Runner', 'execute'],
    });
    expect(chunks[2].metadata).toMatchObject({
      symbol: 'execute',
      symbolKind: 'function',
      sourceRange: { startLine: 7, endLine: 9 },
    });
  });

  it('falls back deterministically for unsupported languages', () => {
    const chunks = createChunker().chunk('one\ntwo\nthree', {
      strategy: 'structure_aware',
      language: 'text',
      maxChars: 5,
      overlapChars: 0,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].metadata).toMatchObject({
      fallback: true,
      fallbackReason: 'unsupported_language_or_mime',
      validationWarnings: [
        expect.objectContaining({
          code: 'structure_chunker_fallback',
          severity: 'warning',
        }),
      ],
    });
  });
});
