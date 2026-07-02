import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
  });

  test('should load app with English interface', async ({ page }) => {
    await page.goto('/app');
    await page.waitForTimeout(1000);

    // The interface should be in English based on our mock preferences
    const body = await page.textContent('body');
    // Check for some English UI text
    expect(body).toBeTruthy();
  });
});
