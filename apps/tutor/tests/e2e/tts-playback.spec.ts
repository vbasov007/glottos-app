import { test, expect } from '@playwright/test';
import { mockLogin, mockExplain, mockTts } from './helpers';

test.describe('TTS Playback', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
    await mockExplain(page);
    await mockTts(page);
    // Prevent sync conflict dialogs from blocking interactions
    await page.route('**/api/state/*/timestamp', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updatedAt: null }),
      });
    });
  });

  test('listen full text button appears after entering text', async ({ page }) => {
    await page.goto('/app');
    await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });

    const textarea = page.locator('textarea').first();
    await textarea.fill('Der Tisch ist groß.');

    // The listen full text button should appear (data-tutorial="listen-full-btn")
    const listenBtn = page.locator('[data-tutorial="listen-full-btn"]');
    await expect(listenBtn).toBeVisible({ timeout: 5000 });
  });

  test('clicking a word in read mode shows floating toolbar with Listen and Explain', async ({ page }) => {
    // This test only works on desktop viewports (floating toolbar is !isTouchDevice)
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      test.skip();
      return;
    }

    await page.goto('/app');
    await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });

    // Enter text — this triggers editMode=true via onChange
    const textarea = page.locator('textarea').first();
    await textarea.fill('Der Tisch ist groß.');

    // Switch to read mode by clicking the toggle button (shows "Read" when editMode=true)
    // The button has class hidden lg:flex — only visible on lg screens
    const readBtn = page.locator('[data-tutorial="toolbar"] button span', { hasText: /^Read$/ }).first();
    await expect(readBtn).toBeVisible({ timeout: 5000 });
    await readBtn.click();

    // Now in read mode, tappable word spans should be visible
    const wordSpan = page.locator('[data-token-index]').first();
    await expect(wordSpan).toBeVisible({ timeout: 5000 });
    await wordSpan.click();

    // Floating toolbar with Listen and Explain buttons should appear
    const listenButton = page.locator('button', { hasText: /^Listen$/ }).first();
    const explainButton = page.locator('button', { hasText: /^Explain$/ }).first();
    await expect(listenButton).toBeVisible({ timeout: 5000 });
    await expect(explainButton).toBeVisible({ timeout: 5000 });
  });

  test('hide text button toggles text visibility', async ({ page }) => {
    await page.goto('/app');
    await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });

    // Find the hide text button (data-tutorial="hide-text-btn")
    const hideBtn = page.locator('[data-tutorial="hide-text-btn"]');
    await expect(hideBtn).toBeVisible({ timeout: 5000 });

    // Check initial state — button should contain "Hide text" (en translation)
    const hideSpan = hideBtn.locator('span');
    await expect(hideSpan).toContainText('Hide text');

    // Click to hide
    await hideBtn.click();

    // Button text should change to "Show text"
    await expect(hideSpan).toContainText('Show text');

    // Click again to show
    await hideBtn.click();
    await expect(hideSpan).toContainText('Hide text');
  });

  test('quick explain input is visible in the toolbar on desktop', async ({ page }) => {
    // Quick input is only shown on desktop (!isTouchDevice)
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      test.skip();
      return;
    }

    await page.goto('/app');
    await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });

    // Quick explain input (data-tutorial="quick-input")
    const quickInput = page.locator('[data-tutorial="quick-input"]');
    await expect(quickInput).toBeVisible({ timeout: 5000 });

    // Should contain an input element
    const input = quickInput.locator('input');
    await expect(input).toBeVisible();
  });
});
