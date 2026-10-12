import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function lineCount(relativePath: string) {
  return read(relativePath).split(/\r?\n/).length;
}

describe('Studio hotspot boundaries', () => {
  it('keeps the workspace page below the pre-LLM size ceiling', () => {
    expect(lineCount('apps/web/src/pages/KnowledgeBasePage.tsx')).toBeLessThanOrEqual(2400);
  });

  it('keeps extracted workspace panels independent from the page module', () => {
    expect(read('apps/web/src/components/workspace/KnowledgeBasePanels.tsx')).not.toContain(
      'KnowledgeBasePage',
    );
  });
});
