import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers';

test.describe('Authentication', () => {
  test('should show landing page when not logged in', async ({ page }) => {
    await page.goto('/');
    // Landing page should be visible for unauthenticated users
    await expect(page).toHaveURL('/');
  });

  test('should load app when session exists', async ({ page }) => {
    await mockLogin(page);
    await page.goto('/app');

    // Wait for the app to load
    await page.waitForTimeout(1000);

    // The app should be visible (not redirected to landing)
    const url = page.url();
    expect(url).toContain('/app');
  });
});
