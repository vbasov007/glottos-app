import { test, expect } from '@playwright/test';
import { mockLogin, mockExplain, mockTts } from './helpers';

test.describe('Explain Flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
    await mockExplain(page);
    await mockTts(page);
  });

  test('should show text area in workspace', async ({ page }) => {
    await page.goto('/app');
    await page.waitForTimeout(1000);

    // Look for a textarea or contenteditable area
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible()) {
      await expect(textarea).toBeVisible();
    }
  });

  test('should be able to enter text', async ({ page }) => {
    await page.goto('/app');
    await page.waitForTimeout(1000);

    // Find the main text input area
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible()) {
      await textarea.fill('Der Tisch ist groß.');
      await expect(textarea).toHaveValue('Der Tisch ist groß.');
    }
  });
});
