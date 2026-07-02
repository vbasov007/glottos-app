import { test, expect } from '@playwright/test';
import { mockTts } from './helpers';

test.describe('Embed Mode', () => {
  async function setupEmbedMocks(page: import('@playwright/test').Page) {
    // Catch-all for any API call to prevent hanging
    await page.route('**/api/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
    await mockTts(page);

    // Set userPrefs in localStorage so the app skips language setup
    await page.addInitScript(() => {
      localStorage.setItem('userPrefs', JSON.stringify({
        interfaceLanguage: 'en',
        explanationLanguage: 'en',
        defaultTextLanguage: 'de',
        theme: 'light',
        setupCompleted: true,
        tutorialCompleted: true,
      }));
    });
  }

  test('/embed loads without header and without workspace tabs', async ({ page }) => {
    await setupEmbedMocks(page);
    await page.goto('/embed', { waitUntil: 'domcontentloaded' });

    // Wait for the toolbar to appear (app is loaded)
    const toolbar = page.locator('[data-tutorial="toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 15000 });

    // Header should NOT be present
    const header = page.locator('header');
    await expect(header).toHaveCount(0);

    // Workspace tabs should NOT be present
    const workspaceTabs = page.locator('[data-tutorial="workspace-tabs"]');
    await expect(workspaceTabs).toHaveCount(0);
  });

  test('/app?embed=true loads in embed mode', async ({ page }) => {
    await setupEmbedMocks(page);
    await page.goto('/app?embed=true', { waitUntil: 'domcontentloaded' });

    const toolbar = page.locator('[data-tutorial="toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 15000 });

    // Header should NOT be present in embed mode
    const header = page.locator('header');
    await expect(header).toHaveCount(0);

    // Workspace tabs should NOT be present
    const workspaceTabs = page.locator('[data-tutorial="workspace-tabs"]');
    await expect(workspaceTabs).toHaveCount(0);
  });

  test('edit mode toggle is not visible in embed mode', async ({ page }) => {
    await setupEmbedMocks(page);
    await page.goto('/embed', { waitUntil: 'domcontentloaded' });

    const toolbar = page.locator('[data-tutorial="toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 15000 });

    // The edit/read mode toggle button should not exist in embed mode
    const editToggle = toolbar.locator('button span', { hasText: /^(Read|Edit)$/ });
    await expect(editToggle).toHaveCount(0);
  });

  test('textarea is not shown in embed mode (read-only forced)', async ({ page }) => {
    await setupEmbedMocks(page);
    await page.goto('/embed', { waitUntil: 'domcontentloaded' });

    const toolbar = page.locator('[data-tutorial="toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 15000 });

    // No textarea should be visible — embed mode is read-only
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveCount(0);
  });
});
