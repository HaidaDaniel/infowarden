import { expect, test } from '@playwright/test';

test.describe('optional live Studio smoke', () => {
  test.skip(process.env.STUDIO_E2E_LIVE !== '1', 'Set STUDIO_E2E_LIVE=1 to run against a live API.');

  test('loads the Studio shell against the configured backend', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Studio' })).toBeVisible();
    await expect(page.getByText('http://localhost:3000')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Studio dashboard|Dashboard unavailable/ }),
    ).toBeVisible();
  });

  test('loads a live workspace detail view when configured', async ({ page }) => {
    const workspaceId = process.env.STUDIO_E2E_WORKSPACE_ID;
    test.skip(!workspaceId, 'Set STUDIO_E2E_WORKSPACE_ID to verify a live workspace detail page.');

    await page.goto(`/workspaces/${workspaceId}`);

    const workspaceName = process.env.STUDIO_E2E_WORKSPACE_NAME;
    if (workspaceName) {
      await expect(page.getByRole('heading', { name: workspaceName })).toBeVisible();
    } else {
      await expect(page.getByText(workspaceId!)).toBeVisible();
    }

    const resources = page.locator('section.section-card').filter({
      has: page.getByRole('heading', { name: 'Resources' }),
    });
    await expect(resources.getByText('Serving index')).toBeVisible();
    await expect(resources.getByText('Lifecycle', { exact: true })).toBeVisible();
    await expect(resources.getByText('loaded').first()).toBeVisible();
    if (process.env.STUDIO_E2E_EXPECTED_VECTOR_BACKEND_ID) {
      await expect(resources.getByText(process.env.STUDIO_E2E_EXPECTED_VECTOR_BACKEND_ID).first()).toBeVisible();
    }
    if (process.env.STUDIO_E2E_EXPECTED_SERVING_REVISION_ID) {
      await expect(resources.getByText(process.env.STUDIO_E2E_EXPECTED_SERVING_REVISION_ID).first()).toBeVisible();
    }
    if (process.env.STUDIO_E2E_EXPECTED_COLLECTION_NAME) {
      await expect(resources.getByText(process.env.STUDIO_E2E_EXPECTED_COLLECTION_NAME).first()).toBeVisible();
    }

    for (const sourceType of (process.env.STUDIO_E2E_EXPECTED_SOURCE_TYPES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)) {
      await expect(page.getByRole('heading', { name: sourceType }).first()).toBeVisible();
    }
  });
});
