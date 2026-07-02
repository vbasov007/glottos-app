import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers';

// 1x1 transparent PNG — valid bytes the browser will actually decode in the
// resize helper's <img> + canvas pipeline.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test.describe('OCR from image', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
  });

  test('happy path: extracts text from image into editor', async ({ page }, testInfo) => {
    const ocrRequests: any[] = [];
    await page.route('**/api/ocr-extract', async (route, request) => {
      ocrRequests.push(JSON.parse(request.postData() || '{}'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: 'Guten Tag\nWie geht es dir?' }),
      });
    });

    await page.goto('/app');

    // There are TWO entry points when the editor is empty: a toolbar button
    // and a larger tile in the empty-state. Target the toolbar by its title
    // attribute — that disambiguates from the tile on mobile, where the tile's
    // description text is hidden and both buttons would share the same role
    // name "From image".
    const fromImageBtn = page.getByTitle('From image');
    await expect(fromImageBtn).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: '/tmp/ocr-shots/1-toolbar.png' });

    await fromImageBtn.click();

    // Modal opens with picker
    const modalTitle = page.getByRole('heading', { name: /extract text from image/i });
    await expect(modalTitle).toBeVisible();
    await page.screenshot({ path: '/tmp/ocr-shots/2-modal-empty.png' });

    // Submit button disabled until an image is picked
    const submitBtn = page.getByRole('button', { name: /^extract text$/i });
    await expect(submitBtn).toBeDisabled();

    // Set the hidden file input directly
    // Two hidden inputs now: camera (capture="environment") and library.
    // Either accepts setInputFiles for the test — pick the library one.
    const fileInput = page.locator('input[type="file"]:not([capture])');
    await fileInput.setInputFiles({
      name: 'sign.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });

    // Preview should appear and submit enables
    const preview = page.locator('img[src^="data:image/"]');
    await expect(preview).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    // Cropper renders over the preview, plus the crop hint label
    await expect(page.locator('.ReactCrop')).toBeVisible();
    await expect(page.getByText(/drag to select/i)).toBeVisible();

    await page.screenshot({ path: '/tmp/ocr-shots/3-modal-with-preview.png' });

    await submitBtn.click();

    // Modal should close
    await expect(modalTitle).toBeHidden({ timeout: 5000 });

    // Editor should now display the extracted text — when text is present the app
    // renders the editor as a read-mode <div>, not the empty-state textarea.
    await expect(page.getByText('Guten Tag', { exact: false })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Wie geht es dir?', { exact: false })).toBeVisible();
    await page.screenshot({ path: '/tmp/ocr-shots/4-text-loaded.png' });

    // Verify what the backend received: a data URL + the textLanguage
    expect(ocrRequests).toHaveLength(1);
    expect(ocrRequests[0].image).toMatch(/^data:image\/jpeg;base64,/);
    expect(ocrRequests[0].language).toBe('de');
  });

  test('shows "no text found" message when extraction returns empty', async ({ page }, testInfo) => {
    await page.route('**/api/ocr-extract', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: '' }),
      });
    });

    await page.goto('/app');
    await page.getByTitle('From image').click();
    await page.locator('input[type="file"]:not([capture])').setInputFiles({
      name: 'blank.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await page.getByRole('button', { name: /^extract text$/i }).click();

    // Modal stays open, error message visible, editor still empty
    await expect(page.getByText(/no readable text/i)).toBeVisible();
    await expect(page.locator('textarea').first()).toHaveValue('');
    await page.screenshot({ path: '/tmp/ocr-shots/5-no-text-found.png' });
  });

  test('entry points disappear once editor has text', async ({ page }) => {
    await page.goto('/app');
    const textarea = page.locator('textarea').first();
    await textarea.fill('Some existing text');
    // Both the toolbar button AND the empty-state tile should be gone now.
    await expect(page.getByRole('button', { name: /from image/i })).toHaveCount(0);
  });
});
