import { expect, test } from '@playwright/test';
import { mockStudioApi } from './studio-api-fixtures';

test.beforeEach(async ({ page }) => {
  await mockStudioApi(page);
});

test('renders workspace explorer, export manifest, sources, documents, indexes, and failures', async ({ page }) => {
  await page.goto('/workspaces/career-rag');

  await expect(page.getByRole('heading', { name: 'Career RAG' })).toBeVisible();
  await expect(page.getByText('Workspace export manifest')).toBeVisible();
  await expect(page.getByText('workspace-export-manifest.v1')).toBeVisible();
  await expect(page.getByText('Source restore warnings')).toBeVisible();
  await expect(page.getByText('Local folder sources require an operator remap on restore.')).toBeVisible();
  await expect(page.getByText('/data/career').first()).toBeVisible();
  await expect(page.getByText('Snapshot: local_scan')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'resume.md' })).toBeVisible();
  await expect(page.getByText('projects/contextforge.md')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'idx-active' })).toBeVisible();
  await expect(page.getByText('cf_career_active').first()).toBeVisible();
  await expect(page.getByText('Parser failed on broken.pdf').first()).toBeVisible();
});

test('downloads the raw export manifest JSON', async ({ page }) => {
  await page.goto('/workspaces/career-rag');

  await expect(page.getByText('workspace-export-manifest.v1')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('career-rag-workspace-export-manifest.json');
});

test('shows resource estimates and toggles workspace load state', async ({ page }) => {
  await page.goto('/workspaces/career-rag');

  const resources = page.locator('section.section-card').filter({
    has: page.getByRole('heading', { name: 'Resources' }),
  });

  await expect(resources.getByText('Serving index')).toBeVisible();
  await expect(resources.getByText('Lifecycle', { exact: true })).toBeVisible();
  await expect(resources.getByText('loaded').first()).toBeVisible();
  await expect(resources.getByText('Storage', { exact: true })).toBeVisible();
  await expect(resources.getByText('balanced', { exact: true })).toBeVisible();
  await expect(resources.getByText('Capacity warnings:')).toBeVisible();
  await expect(resources.getByText('Vector backend operations')).toBeVisible();
  await expect(resources.getByText('not replicas or transparent shards')).toBeVisible();
  await expect(resources.getByRole('heading', { name: 'cold-node' })).toBeVisible();

  await resources.getByRole('button', { name: 'Unload', exact: true }).click();
  await expect(resources.getByText('unloaded').first()).toBeVisible();

  await resources.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(resources.getByText('loaded').first()).toBeVisible();
});

test('runs retrieval trace, empty result, and backend error states', async ({ page }) => {
  await page.goto('/workspaces/career-rag');

  const playground = page.locator('section.section-card').filter({
    has: page.getByRole('heading', { name: 'Retrieval playground' }),
  });
  const query = playground.getByLabel('Query');
  await query.fill('What ContextForge work should I mention?');
  await playground.getByText('Advanced retrieval settings', { exact: true }).click();
  await playground.getByLabel('Path prefix').fill('projects/');
  await playground.getByLabel('Language').fill('markdown');
  await playground.getByLabel('Branch').fill('main');
  await playground.getByLabel('Reranker mode').selectOption('on');
  await playground.getByRole('button', { name: 'Run retrieval trace' }).click();

  await expect(playground.getByRole('heading', { name: 'Dense candidates' })).toBeVisible();
  await expect(playground.getByRole('heading', { name: 'Reranked candidates' })).toBeVisible();
  await expect(playground.getByRole('heading', { name: 'Final context package' })).toBeVisible();
  await expect(playground.getByText('Provider local-cpu-reranker')).toBeVisible();
  await expect(playground.getByText('ContextForge work focused on Studio E2E coverage').first()).toBeVisible();
  await expect(playground.getByRole('region', { name: 'Retrieval request diagnostics' })).toContainText(
    '"pathPrefix": "projects/"',
  );
  await playground.getByText('Chunk metadata', { exact: true }).first().click();
  await playground.getByRole('group', { name: 'Chunk metadata', exact: true }).first().focus();
  await expect(playground.getByRole('group', { name: 'Chunk metadata', exact: true }).first()).toBeFocused();

  await query.fill('empty result');
  await playground.getByRole('button', { name: 'Run retrieval trace' }).click();
  await expect(playground.getByText('No items at this stage.').first()).toBeVisible();
  await expect(playground.getByText('Final package')).toBeVisible();

  await query.fill('backend fails');
  await playground.getByRole('button', { name: 'Run retrieval trace' }).click();
  await expect(playground.getByText('Playground error:')).toBeVisible();
  await expect(playground.getByText('retrieval backend offline')).toBeVisible();
});

test('runs retrieval eval and compares profiles and saved runs', async ({ page }) => {
  await page.goto('/workspaces/career-rag');

  const evalPanel = page.locator('section.section-card').filter({
    has: page.getByRole('heading', { name: 'Retrieval evaluation' }),
  });

  await expect(evalPanel.getByText('q-context-work')).toBeVisible();
  await expect(evalPanel.getByRole('heading', { name: 'Docs QA eval' })).toBeVisible();
  await expect(evalPanel.getByText('Config hash-current')).toBeVisible();

  await evalPanel.getByRole('button', { name: 'Import standard benchmark' }).click();
  await expect(evalPanel.getByText('Standard benchmark ready:')).toBeVisible();
  await expect(evalPanel.getByLabel('Dataset')).toHaveValue('cf-standard-benchmark');
  await expect(evalPanel.getByText('q-scifact-1')).toBeVisible();

  await evalPanel.getByRole('button', { name: 'Run eval' }).click();
  await expect(evalPanel.getByRole('heading', { name: 'Candidate retrieval eval' })).toBeVisible();

  await evalPanel.getByLabel('Reranker mode').selectOption('on');
  await evalPanel.getByRole('button', { name: 'Run eval' }).click();
  await expect(evalPanel.getByText('Reranker true')).toBeVisible();
  await evalPanel.getByRole('button', { name: 'Compare reranker off/on' }).click();
  await expect(evalPanel.getByText('Config changed: yes')).toBeVisible();

  await evalPanel.getByRole('button', { name: 'Compare profiles' }).click();
  await expect(evalPanel.getByText('Δ hitAtK')).toBeVisible();
  await expect(evalPanel.getByText('+0.160')).toBeVisible();

  await evalPanel.getByRole('button', { name: 'Compare saved runs' }).click();
  await expect(evalPanel.getByText('Config changed: yes')).toBeVisible();
  await expect(evalPanel.getByText('q-context-work: hitAtK +1.000, reciprocalRank +0.500')).toBeVisible();
});

test('searches memory and creates fact, decision, and session-summary entries', async ({ page }) => {
  await page.goto('/workspaces/career-rag');

  await expect(page.getByRole('heading', { name: 'Use Studio dry-run refresh' }).first()).toBeVisible();
  await page.getByPlaceholder('Find relevant decisions, facts, or session notes').fill('refresh decision');
  await page.getByRole('button', { name: 'Search memory' }).click();
  await expect(page.getByText('1 results via memory-recall')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prefer dry-run before rebuild' })).toBeVisible();

  const form = page.locator('form.memory-form').first();
  await form.getByLabel('Title').fill('Studio remembers uploads');
  await form.getByLabel('Authored by').fill('codex');
  await form.getByLabel('Body').fill('The Studio import wizard should poll terminal jobs.');
  await form.getByLabel('Tags').fill('studio,upload');
  await form.getByRole('button', { name: 'Save memory entry' }).click();
  await expect(page.getByRole('heading', { name: 'Studio remembers uploads' })).toBeVisible();

  await form.getByLabel('Type').selectOption('decision');
  await form.getByLabel('Title').fill('Keep Playwright mocked by default');
  await form.getByLabel('Body').fill('Default browser tests should not require Docker services.');
  await form.getByRole('button', { name: 'Save memory entry' }).click();
  await expect(page.getByRole('heading', { name: 'Keep Playwright mocked by default' }).first()).toBeVisible();

  await form.getByLabel('Type').selectOption('session_summary');
  await form.getByLabel('Title').fill('UI E2E session');
  await form.getByLabel('Session ID').fill('session-e2e');
  await form.getByLabel('Body').fill('Covered retrieval, memory, export, and refresh controls.');
  await form.getByRole('button', { name: 'Save memory entry' }).click();
  await expect(page.getByRole('heading', { name: 'UI E2E session' })).toBeVisible();
  await expect(page.getByText('session session-e2e')).toBeVisible();
});

test('previews dry-run refresh plans and enqueues force refresh jobs', async ({ page }) => {
  await page.goto('/workspaces/career-rag');

  await expect(page.getByText('Source policy')).toBeVisible();
  await page.getByLabel('Enable auto refresh for /data/career').check();
  await page.getByLabel('Source trigger for /data/career').selectOption('schedule');
  await page.getByLabel('Policy refresh mode for /data/career').selectOption('force_reembed');
  await page.getByPlaceholder('5m, 1h, every 1d').fill('5m');
  await page.getByPlaceholder('daily vault sync').fill('scheduled sync check');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByText('Source policy saved.')).toBeVisible();

  await page.getByLabel('Obsidian vault path').fill('/data/notes/main-vault');
  await page.getByRole('button', { name: 'Add vault' }).click();
  await expect(page.getByText('Obsidian vault source created.')).toBeVisible();

  await page.getByLabel('Refresh mode for /data/career', { exact: true }).selectOption('rebuild_collection');
  await expect(page.getByText('Explicit rebuild:')).toBeVisible();
  await page.getByPlaceholder('after git pull or dataset update').fill('operator verification');
  await page.getByRole('button', { name: 'Preview dry-run' }).click();

  await expect(page.getByRole('heading', { name: 'Dry-run preview' })).toBeVisible();
  await expect(page.getByText('notes/new-role.md')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'resume.md' })).toBeVisible();
  await expect(page.getByText('source_remap_required')).toBeVisible();

  await page.getByLabel('Refresh mode for /data/career', { exact: true }).selectOption('force_rechunk');
  await page.getByRole('button', { name: 'Start refresh' }).click();
  await expect(page.getByText('Queued force_rechunk refresh.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open refresh job job-refresh-1' })).toBeVisible();
});

test('preserves edited retrieval settings across the scheduled overview poll', async ({ page }) => {
  await page.clock.install();
  await page.goto('/workspaces/career-rag');
  const playground = page.locator('#retrieval-playground');
  await playground.getByLabel('Profile', { exact: true }).selectOption('hybrid');
  await playground.getByLabel('Top K', { exact: true }).fill('11');
  await playground.getByLabel('Token budget', { exact: true }).fill('2500');
  await playground.getByLabel('Query', { exact: true }).fill('Preserve this controlled comparison');
  await page.clock.fastForward(11000);
  await expect(playground.getByLabel('Profile', { exact: true })).toHaveValue('hybrid');
  await expect(playground.getByLabel('Top K', { exact: true })).toHaveValue('11');
  await expect(playground.getByLabel('Token budget', { exact: true })).toHaveValue('2500');
  await expect(playground.getByLabel('Query', { exact: true })).toHaveValue('Preserve this controlled comparison');
});

test('announces memory and evaluation validation failures and navigates by keyboard', async ({ page }) => {
  await page.goto('/workspaces/career-rag');
  await page
    .getByRole('navigation', { name: 'Workspace sections' })
    .getByRole('link', { name: 'Memory', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#memory')).toBeFocused();
  await page.locator('#memory').getByRole('button', { name: 'Save memory entry' }).click();
  await expect(page.locator('#memory').getByRole('alert')).toContainText('Body is required.');
  const evaluation = page.locator('#evaluation');
  await evaluation.getByLabel('Baseline profile').selectOption('agent-context');
  await evaluation.getByLabel('Candidate profile').selectOption('agent-context');
  await evaluation.getByRole('button', { name: 'Compare profiles', exact: true }).click();
  await expect(evaluation.getByRole('alert')).toContainText('Choose two different profiles');
});
