import { test, expect } from '@playwright/test';
import { mockLogin, mockExplain, mockTts } from './helpers';

/**
 * Helper: enter text and switch to read mode on desktop.
 * Returns true if read mode was entered successfully.
 */
async function enterTextAndSwitchToReadMode(page: import('@playwright/test').Page, text: string): Promise<boolean> {
  await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });

  const textarea = page.locator('textarea').first();
  await textarea.fill(text);

  // The Read/Edit toggle button is only visible on lg screens (hidden lg:flex)
  const readBtn = page.locator('[data-tutorial="toolbar"] button span', { hasText: /^Read$/ }).first();
  const isDesktop = await readBtn.isVisible({ timeout: 3000 }).catch(() => false);

  if (isDesktop) {
    await readBtn.click();
    // Wait for read mode: word spans should appear
    await page.waitForSelector('[data-token-index]', { timeout: 5000 });
    return true;
  }

  // On mobile, blur the textarea to exit edit mode
  await page.locator('[data-tutorial="toolbar"]').click();
  const hasTokens = await page.locator('[data-token-index]').first().isVisible({ timeout: 3000 }).catch(() => false);
  return hasTokens;
}

/**
 * Override the workspace timestamp/state endpoint to prevent sync conflict dialogs.
 * Must be called AFTER mockLogin (later routes take precedence in Playwright).
 */
async function preventSyncConflict(page: import('@playwright/test').Page) {
  // Override /api/state/ws-*/timestamp to return null updatedAt (no conflict)
  await page.route('**/api/state/*/timestamp', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ updatedAt: null }),
    });
  });
}

test.describe('Explain Detail', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
    await mockExplain(page);
    await mockTts(page);
    await preventSyncConflict(page);
  });

  test('enter text, click word in read mode, explanation panel appears', async ({ page }) => {
    // Floating toolbar with Explain is desktop-only
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      test.skip();
      return;
    }

    await page.goto('/app');
    await enterTextAndSwitchToReadMode(page, 'Der Tisch ist groß.');

    // Click a word
    const wordSpan = page.locator('[data-token-index]').first();
    await wordSpan.click();

    // Click the Explain button on the floating toolbar
    const explainBtn = page.locator('button', { hasText: /^Explain$/ }).first();
    await expect(explainBtn).toBeVisible({ timeout: 5000 });
    await explainBtn.click();

    // Wait for result to appear in the results panel
    const resultsPanel = page.locator('[data-tutorial="results-panel"]');
    await expect(resultsPanel).toBeVisible({ timeout: 5000 });

    // The selection heading "Tisch" should appear (from mock)
    await expect(resultsPanel.getByRole('heading', { name: 'Tisch' })).toBeVisible({ timeout: 5000 });
  });

  test('explanation panel shows part of speech and meanings', async ({ page }) => {
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      test.skip();
      return;
    }

    await page.goto('/app');
    await enterTextAndSwitchToReadMode(page, 'Der Tisch ist groß.');

    const wordSpan = page.locator('[data-token-index]').first();
    await wordSpan.click();

    const explainBtn = page.locator('button', { hasText: /^Explain$/ }).first();
    await expect(explainBtn).toBeVisible({ timeout: 5000 });
    await explainBtn.click();

    const resultsPanel = page.locator('[data-tutorial="results-panel"]');

    // Part of speech "noun" should be visible
    await expect(resultsPanel.locator('text=noun').first()).toBeVisible({ timeout: 5000 });

    // Meaning "table" should be visible
    await expect(resultsPanel.locator('text=table').first()).toBeVisible({ timeout: 5000 });

    // Heading "Tisch"
    await expect(resultsPanel.getByRole('heading', { name: 'Tisch' })).toBeVisible({ timeout: 5000 });
  });

  test('after explaining a word, it appears in the explanation history', async ({ page }) => {
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      test.skip();
      return;
    }

    await page.goto('/app');
    await enterTextAndSwitchToReadMode(page, 'Der Tisch ist groß.');

    const wordSpan = page.locator('[data-token-index]').first();
    await wordSpan.click();

    const explainBtn = page.locator('button', { hasText: /^Explain$/ }).first();
    await expect(explainBtn).toBeVisible({ timeout: 5000 });
    await explainBtn.click();

    // Wait for result
    const resultsPanel = page.locator('[data-tutorial="results-panel"]');
    await expect(resultsPanel.getByRole('heading', { name: 'Tisch' })).toBeVisible({ timeout: 5000 });

    // The explanation history nav should show "1 / 1" indicating one explained word
    await expect(resultsPanel.locator('text=1 / 1')).toBeVisible({ timeout: 5000 });
  });

  test('quick explain: type a word, click explain, result appears', async ({ page }) => {
    // Quick input is desktop-only (!isTouchDevice)
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      test.skip();
      return;
    }

    await page.goto('/app');
    await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });

    // Find the quick input area
    const quickInputArea = page.locator('[data-tutorial="quick-input"]');
    await expect(quickInputArea).toBeVisible({ timeout: 5000 });

    const input = quickInputArea.locator('input');
    await input.fill('Tisch');

    // Click the explain button (the last button in the quick-input div — Sparkles icon)
    const explainBtn = quickInputArea.locator('button').last();
    await explainBtn.click();

    // Result should appear in results panel
    const resultsPanel = page.locator('[data-tutorial="results-panel"]');
    await expect(resultsPanel.getByRole('heading', { name: 'Tisch' })).toBeVisible({ timeout: 5000 });
    await expect(resultsPanel.locator('text=table').first()).toBeVisible({ timeout: 5000 });
  });
});
