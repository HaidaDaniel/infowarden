import { expect, test } from '@playwright/test';
import { mockEmptyStudioApi, mockStudioApi } from './studio-api-fixtures';

test('renders populated dashboard health, queue, workspaces, jobs, and collections', async ({ page }) => {
  await mockStudioApi(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Studio dashboard for your context workspaces' })).toBeVisible();
  await expect(page.getByText('Queue pressure')).toBeVisible();
  await expect(page.getByText('active', { exact: true })).toBeVisible();
  await expect(page.getByText('qdrant')).toBeVisible();
  await expect(page.getByText('connection refused')).toBeVisible();
  await expect(page.getByRole('link', { name: /Career RAG/ }).first()).toBeVisible();
  await expect(page.getByText('/data/career').first()).toBeVisible();
  await expect(page.getByText('cf_career_active')).toBeVisible();
  await expect(page.getByText('personal_work_history')).toBeVisible();
});

test('renders empty dashboard states without live backend dependencies', async ({ page }) => {
  await mockEmptyStudioApi(page);

  await page.goto('/');

  await expect(page.getByText('No workspaces yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import your first workspace' })).toHaveAttribute('href', '/import');
  await expect(page.getByText('No indexing jobs yet')).toBeVisible();
  await expect(page.getByText('No active collections')).toBeVisible();
  await expect(page.getByText('No workspace kinds yet')).toBeVisible();
});

test('surfaces auth failure and reloads after saving the admin key', async ({ page }) => {
  await mockStudioApi(page, { requireAuth: true });

  await page.goto('/');

  await expect(page.getByText('API key required or invalid')).toBeVisible();
  await page.getByText('Connection settings', { exact: true }).click();
  await page.getByLabel('Admin API key').fill('secret-key');
  await page.getByRole('button', { name: 'Save key' }).click();

  await expect(page.getByRole('heading', { name: 'Studio dashboard for your context workspaces' })).toBeVisible();
  await expect(page.getByText('Key saved locally for this browser.')).toBeVisible();
});
