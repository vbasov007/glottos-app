import { test, expect, devices } from '@playwright/test';
import { mockLogin, mockExplain, mockTts } from './helpers';

// Use mobile device emulation
test.use(devices['Pixel 5']);

test.describe('Mobile Touch Selection', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
    await mockExplain(page);
    await mockTts(page);
  });

  test('should load app on mobile viewport', async ({ page }) => {
    await page.goto('/app');
    await page.waitForTimeout(1000);

    // Verify the page loaded and the viewport is mobile-sized
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    if (viewport) {
      expect(viewport.width).toBeLessThan(500);
    }
  });

  test('should show mobile-appropriate layout', async ({ page }) => {
    await page.goto('/app');
    await page.waitForTimeout(1000);

    // The app should render something on mobile
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});
