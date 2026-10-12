import { expect, test } from '@playwright/test';
import { mockStudioApi } from './studio-api-fixtures';

test.beforeEach(async ({ page }) => {
  await mockStudioApi(page);
});

test('imports standard benchmark and runs reranker off/on leaderboard pair', async ({ page }) => {
  await page.goto('/benchmarks');

  await expect(page.getByRole('heading', { name: 'Standard retrieval benchmark' })).toBeVisible();
  await expect(page.getByLabel('Workspace')).toHaveValue('career-rag');
  await expect(page.getByRole('row').filter({ hasText: 'career-rag' })).toContainText('1');

  await page.getByRole('button', { name: 'Import benchmark' }).click();
  await expect(page.getByText('Import queued:')).toBeVisible();

  await page.getByRole('button', { name: 'Run off/on pair' }).click();
  await expect(page.getByText('Latest off/on delta:')).toBeVisible();
  await expect(page.getByText('1.000 / 0.920').first()).toBeVisible();
});
