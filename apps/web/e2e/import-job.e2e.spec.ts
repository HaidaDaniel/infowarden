import { expect, test } from '@playwright/test';
import { mockStudioApi } from './studio-api-fixtures';

test('creates a workspace, uploads a dataset, enqueues indexing, and opens terminal job detail', async ({ page }) => {
  await mockStudioApi(page);
  await page.goto('/import');

  await page.getByLabel('Workspace action').selectOption('new');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Research Docs');
  await page.getByLabel('Slug').fill('research-docs');
  await page.getByLabel('Source name').fill('E2E Upload');
  await page.getByLabel('Dataset file or ZIP').setInputFiles({
    name: 'dataset.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Dataset\n\nStudio upload e2e fixture.'),
  });
  await page.getByRole('button', { name: 'Upload and start indexing' }).click();

  await expect(page.getByText('Research Docs (research-docs)')).toBeVisible();
  await expect(page.getByText('upload://upload-1')).toBeVisible();
  await expect(page.getByText('dataset.md')).toBeVisible();
  await expect(page.getByText('job-import-1')).toBeVisible();
  await expect(page.getByText('Indexing completed')).toBeVisible();

  await page.getByRole('link', { name: 'Open job detail' }).click();
  await expect(page).toHaveURL(/\/jobs\/job-import-1$/);
  await expect(page.getByRole('heading', { name: 'job-import-1' })).toBeVisible();
  await expect(page.getByText('validationReportId')).toBeVisible();
});

test('shows structured managed upload errors', async ({ page }) => {
  await mockStudioApi(page, { failUpload: true });
  await page.goto('/import');

  await page.getByLabel('Dataset file or ZIP').setInputFiles({
    name: 'malware.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not supported'),
  });
  await page.getByRole('button', { name: 'Upload and start indexing' }).click();

  await expect(page.getByText('managed_upload_unsupported_file')).toBeVisible();
  await expect(page.getByText('Only text-like files and ZIP archives are supported.')).toBeVisible();
  await expect(page.getByText(/Existing workspace data is unchanged/)).toBeVisible();
});

test('renders successful and failed terminal job detail states with stats and logs', async ({ page }) => {
  await mockStudioApi(page);

  await page.goto('/jobs/job-success');
  await expect(page.getByRole('heading', { name: 'job-success' })).toBeVisible();
  await expect(page.getByText('Indexing completed')).toBeVisible();
  await expect(page.getByText('chunksCreated')).toBeVisible();

  await page.goto('/jobs/job-failed');
  await expect(page.getByRole('heading', { name: 'job-failed' })).toBeVisible();
  await expect(page.getByText('Low confidence text extraction')).toBeVisible();
  await expect(page.getByText('Parser failed on broken.pdf')).toBeVisible();
  await expect(page.getByText('document_parse_failed')).toBeVisible();
});

test('explains job-detail recovery when the backend is temporarily unavailable', async ({ page }) => {
  await mockStudioApi(page, { failJobDetail: true });
  await page.goto('/jobs/job-unavailable');

  await expect(page.getByRole('heading', { name: 'Job unavailable' })).toBeVisible();
  await expect(page.getByText('Existing workspace data is unchanged.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
});
