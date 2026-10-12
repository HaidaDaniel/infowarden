import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockEmptyStudioApi, mockStudioApi } from './studio-api-fixtures';

const primaryRoutes = ['/', '/import', '/workspaces/career-rag', '/workspaces/career-rag/ask', '/benchmarks'] as const;
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'compact-desktop', width: 1280, height: 720 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 390, height: 844 },
];

async function waitForRouteState(page: Page, route: string, emptyDashboard = false) {
  if (route === '/' && emptyDashboard) {
    await expect(page.getByRole('heading', { name: 'No workspaces yet' })).toBeVisible();
  } else if (route === '/') {
    await expect(page.getByRole('heading', { name: 'Studio dashboard for your context workspaces' })).toBeVisible();
  } else if (route === '/import') {
    await expect(page.getByRole('heading', { name: 'Upload a dataset into a workspace' })).toBeVisible();
  } else if (route === '/workspaces/career-rag') {
    await expect(page.getByRole('heading', { name: 'Career RAG' })).toBeVisible();
  } else if (route === '/workspaces/career-rag/ask') {
    await expect(page.getByRole('heading', { name: 'Ask', exact: true })).toBeVisible();
  } else if (route === '/benchmarks') {
    await expect(page.getByRole('heading', { name: 'Standard retrieval benchmark' })).toBeVisible();
  }
}

for (const viewport of viewports) {
  test(`Studio primary routes fit ${viewport.name} without page overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of primaryRoutes) {
      await (route === '/' ? mockEmptyStudioApi(page) : mockStudioApi(page));
      await page.goto(route);
      await waitForRouteState(page, route, route === '/');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
        .toBe(true, `${viewport.name} ${route} has page-level horizontal overflow`);
    }
  });
}

test('automated accessibility smoke reports no serious or critical violations', async ({ page }) => {
  const states = [
    { name: 'dashboard-empty', route: '/', empty: true },
    { name: 'dashboard-populated', route: '/', empty: false },
    { name: 'import', route: '/import', empty: false },
    { name: 'workspace', route: '/workspaces/career-rag', empty: false },
    { name: 'retrieval', route: '/workspaces/career-rag', empty: false },
    { name: 'ask', route: '/workspaces/career-rag/ask', empty: false },
  ];

  for (const state of states) {
    await (state.empty ? mockEmptyStudioApi(page) : mockStudioApi(page));
    await page.goto(state.route);
    await waitForRouteState(page, state.route, state.empty);
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrCritical = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(seriousOrCritical, `${state.name} accessibility violations`).toEqual([]);
  }
});

test('long diagnostic content stays inside the phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStudioApi(page, { longContent: true });
  await page.goto('/workspaces/career-rag');
  await expect(page.getByRole('heading', { name: /workspace-x{20}/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
});

test('keyboard can skip the sidebar and focus main content', async ({ page }) => {
  await mockEmptyStudioApi(page);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('reduced motion disables interactive transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockStudioApi(page);
  await page.goto('/');
  await waitForRouteState(page, '/');
  await expect
    .poll(() =>
      page
        .locator('.resource-card.interactive')
        .first()
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration)),
    )
    .toBeLessThan(0.01);
});
