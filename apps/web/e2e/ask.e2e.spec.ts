import { expect, test } from '@playwright/test';
import { mockStudioApi } from './studio-api-fixtures';

test.beforeEach(async ({ page }) => {
  await mockStudioApi(page);
});

test('opens the ask page from the workspace detail and shows the ask form', async ({ page }) => {
  await page.goto('/workspaces/career-rag');

  await expect(page.getByRole('heading', { name: 'Career RAG' })).toBeVisible();
  await page.getByRole('link', { name: 'Open Ask playground' }).click();
  await expect(page).toHaveURL(/\/workspaces\/career-rag\/ask/);

  await expect(page.getByRole('heading', { name: 'Ask', exact: true })).toBeVisible();
  await expect(page.getByLabel('Query')).toBeVisible();
  await expect(page.getByLabel('Mode')).toHaveValue('rag_answer');
  await expect(page.getByLabel('Profile')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run ask' })).toBeDisabled();
});

test('runs chunks mode and displays source-grouped chunks with provenance', async ({ page }) => {
  await page.goto('/workspaces/career-rag/ask');

  const ask = page.locator('section.section-card').filter({
    has: page.getByRole('heading', { name: 'Ask', exact: true }),
  });

  await ask.getByLabel('Mode').selectOption('chunks');
  await ask.getByLabel('Query').fill('Where is queue pressure explained?');
  await ask.getByLabel('Path prefix').fill('notes/');
  await ask.getByRole('button', { name: 'Run ask' }).click();

  await expect(ask.getByRole('heading', { name: 'Retrieved chunks' })).toBeVisible();
  await expect(ask.getByRole('heading', { name: 'src-local' })).toBeVisible();
  await expect(ask.getByRole('heading', { name: 'src-ops' })).toBeVisible();
  await expect(ask.getByText('projects/contextforge.md').first()).toBeVisible();
  await expect(ask.getByText('notes/queue.md').first()).toBeVisible();
  await expect(ask.getByText('lines 10-20').first()).toBeVisible();
  await expect(ask.getByText('Revision: rev-local-1')).toBeVisible();
  await expect(ask.getByText('Revision: rev-ops-1')).toBeVisible();
  await expect(ask.getByText('trace-ask-e2e')).toBeVisible();
  await expect(ask.getByText('38 ms')).toBeVisible();
  await expect(ask.getByRole('link', { name: 'Open the workspace retrieval playground' })).toHaveAttribute(
    'href',
    '/workspaces/career-rag',
  );
});

test('runs rag_answer mode and displays answer, citations, provider, and diagnostics', async ({ page }) => {
  await page.goto('/workspaces/career-rag/ask');

  const ask = page.locator('section.section-card').filter({
    has: page.getByRole('heading', { name: 'Ask', exact: true }),
  });

  await ask.getByLabel('Query').fill('Where is queue pressure explained?');
  await ask.getByLabel('LLM provider').fill('local-llm-2');
  await ask.getByRole('button', { name: 'Run ask' }).click();

  await expect(ask.getByRole('heading', { name: 'Answer' })).toBeVisible();
  await expect(ask.getByText(/ContextForge work focuses on Studio E2E coverage/)).toBeVisible();
  await expect(ask.getByRole('heading', { name: 'Citations' })).toBeVisible();
  await expect(ask.getByText('C1', { exact: true })).toBeVisible();
  await expect(ask.getByText('C2', { exact: true })).toBeVisible();
  await expect(ask.getByText('lines 3-8').first()).toBeVisible();
  await expect(ask.getByText('local-llm-2')).toBeVisible();
  await expect(ask.getByText('qwen3-14b')).toBeVisible();
  await expect(ask.getByText('openai_compatible')).toBeVisible();
  await expect(ask.getByText('640 ms')).toBeVisible();
  await expect(ask.getByText('681 ms')).toBeVisible();
  await expect(ask.getByText('512', { exact: true })).toBeVisible();
  await expect(ask.getByText(/sys 24 \/ instr 8 \/ query 10 \/ out 512 \/ safety 32/)).toBeVisible();
  await expect(ask.getByText('626')).toBeVisible();
  await expect(ask.getByText('trace-ask-e2e')).toBeVisible();
});

test('displays structured provider and budget errors from the backend', async ({ page }) => {
  await page.goto('/workspaces/career-rag/ask');

  const ask = page.locator('section.section-card').filter({
    has: page.getByRole('heading', { name: 'Ask', exact: true }),
  });

  await ask.getByLabel('Query').fill('provider down');
  await ask.getByRole('button', { name: 'Run ask' }).click();

  await expect(ask.getByText('Ask error: llm_unavailable:')).toBeVisible();
  await expect(ask.getByText('Answer LLM provider is unavailable')).toBeVisible();
  await expect(ask.getByText('stage generate_answer')).toBeVisible();
  await expect(ask.getByText('retryable')).toBeVisible();
  await expect(ask.getByText(/workspace and existing retrieval data are unchanged/)).toBeVisible();
  await expect(ask.getByRole('link', { name: 'return to the workspace retrieval playground' })).toHaveAttribute(
    'href',
    '/workspaces/career-rag',
  );
  await expect(ask.getByText(/"providerConfigId": "prov-local"/)).toBeVisible();

  await ask.getByLabel('Query').fill('budget empty');
  await ask.getByRole('button', { name: 'Run ask' }).click();

  await expect(ask.getByText('Ask error: answer_output_budget_empty:')).toBeVisible();
  await expect(ask.getByText('Retrieval profile reserves no tokens for answer generation')).toBeVisible();
  await expect(ask.getByText('stage prepare_answer_budget')).toBeVisible();
});
