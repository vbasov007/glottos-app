import { test, expect } from '@playwright/test';
import { mockLogin, mockTts } from './helpers';

test.describe('Modal Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
    await mockTts(page);
  });

  test('settings modal can be opened from user menu', async ({ page }) => {
    await page.goto('/app');

    // Wait for the app to load
    await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });

    // The user avatar button is in the header — click it to open the user menu
    // The user menu has a settings button with data-tutorial="settings-btn"
    // First we need to hover/click the user avatar to show the menu
    const userAvatar = page.locator('header button').last();
    await userAvatar.click();

    // Click the Settings button
    const settingsBtn = page.locator('[data-tutorial="settings-btn"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    // Settings modal should be visible — it has "Settings" heading
    const settingsHeading = page.locator('h2', { hasText: /settings/i });
    await expect(settingsHeading).toBeVisible({ timeout: 5000 });

    // Close button (x) should be present in the modal
    const closeBtn = page.locator('.fixed button', { hasText: '\u00d7' }).first();
    await expect(closeBtn).toBeVisible();

    // Click close to dismiss
    await closeBtn.click();

    // Settings heading should no longer be visible
    await expect(settingsHeading).not.toBeVisible({ timeout: 3000 });
  });

  test('feedback modal can be opened', async ({ page }) => {
    await page.goto('/app');
    await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });

    // Click the feedback button in the header (data-tutorial="feedback-btn")
    const feedbackBtn = page.locator('[data-tutorial="feedback-btn"]');
    await expect(feedbackBtn).toBeVisible({ timeout: 5000 });
    await feedbackBtn.click();

    // Feedback modal should appear with "Feedback" heading
    const feedbackHeading = page.locator('h2', { hasText: /feedback/i });
    await expect(feedbackHeading).toBeVisible({ timeout: 5000 });
  });

  test('modals have a close button that dismisses them', async ({ page }) => {
    await page.goto('/app');
    await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });

    // Open feedback modal
    const feedbackBtn = page.locator('[data-tutorial="feedback-btn"]');
    await feedbackBtn.click();

    const feedbackHeading = page.locator('h2', { hasText: /feedback/i });
    await expect(feedbackHeading).toBeVisible({ timeout: 5000 });

    // Find and click the close button (X icon or × character)
    const closeBtn = page.locator('.fixed button').filter({ has: page.locator('svg') }).first();
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // Modal should be dismissed
    await expect(feedbackHeading).not.toBeVisible({ timeout: 3000 });
  });
});
