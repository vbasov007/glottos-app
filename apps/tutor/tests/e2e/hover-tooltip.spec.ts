import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers';

// Pre-seeded state: text "Der Tisch ist groß." with one cached word explanation
// (Tisch → table). Mobile is gated out so this spec only runs in chromium.
const TEXT = 'Der Tisch ist groß.';

async function mockStateWithExplanation(page: import('@playwright/test').Page) {
  await page.route('**/api/state', async (route, request) => {
    if (request.method() !== 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }),
      });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          name: 'E2E', email: 'e@test', picture: '', role: 'user',
          active_workspace_id: 'ws-1',
          preferences: { interfaceLanguage: 'en', explanationLanguage: 'en', defaultTextLanguage: 'de', theme: 'light', setupCompleted: true, tutorialCompleted: true },
          subscription_status: 'active',
        },
        workspaces: [{ id: 'ws-1', name: 'Workspace 1', position: 0 }],
        activeWorkspaceId: 'ws-1',
        state: {
          text: TEXT,
          textLanguage: 'de',
          explainHistory: ['Tisch'],
          explanationCache: {
            Tisch: {
              input_language: 'de',
              input_type: 'word',
              selection: 'Tisch',
              meanings: ['table'],
              lemma_translation: 'Tisch',
              translation: null,
              target_translations: [],
              part_of_speech: 'noun',
              morphology: { lemma: 'Tisch', gender: 'm', plural: 'Tische', case: 'NOM', number: 'SG' },
              forms: {
                noun: { singular: { nom: 'der Tisch', akk: 'den Tisch', dat: 'dem Tisch', gen: 'des Tisches' }, plural: { nom: 'die Tische', akk: 'die Tische', dat: 'den Tischen', gen: 'der Tische' } },
                verb: {}, adjective: {},
              },
              sentence_structure: null, highlights: [], grammar_notes: [], examples: [], notes: [],
            },
          },
        },
        updatedAt: new Date().toISOString(),
        preferences: { interfaceLanguage: 'en', explanationLanguage: 'en', defaultTextLanguage: 'de', theme: 'light', setupCompleted: true, tutorialCompleted: true },
        appSettings: { free_daily_explains: '999', free_daily_tts: '999', disabled_text_languages: '' },
      }),
    });
  });
}

test.describe('Hover tooltip for explained tokens', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'desktop-only feature');

  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
    await mockStateWithExplanation(page);
  });

  // Playwright's locator.hover() doesn't always fire React's onMouseMove on
  // an outer container — issue a couple of explicit mouse moves with a tiny
  // wiggle so the synthetic mousemove definitely propagates.
  async function moveOver(page: import('@playwright/test').Page, locator: import('@playwright/test').Locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('locator has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
  }

  test('shows the main translation after ~1 s hover over an explained word', async ({ page }) => {
    await page.goto('/app');
    const tisch = page.locator('[data-token-index]', { hasText: 'Tisch' }).first();
    await expect(tisch).toBeVisible({ timeout: 10000 });
    await expect(tisch).toHaveClass(/font-semibold/);

    await moveOver(page, tisch);
    // Just after the move, well before the 1 s dwell threshold, no tooltip.
    await expect(page.getByTestId('hover-tooltip')).toHaveCount(0);
    // After the dwell + render the tooltip lands within ~1.2 s; allow 3 s for slow CI.
    await expect(page.getByTestId('hover-tooltip')).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('hover-tooltip')).toHaveText('table');
  });

  test('no tooltip on unexplained words even after the dwell time', async ({ page }) => {
    await page.goto('/app');
    const gross = page.locator('[data-token-index]', { hasText: 'groß' }).first();
    await expect(gross).toBeVisible({ timeout: 10000 });
    await moveOver(page, gross);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('hover-tooltip')).toHaveCount(0);
  });

  test('moving off the token hides the tooltip', async ({ page }) => {
    await page.goto('/app');
    const tisch = page.locator('[data-token-index]', { hasText: 'Tisch' }).first();
    await expect(tisch).toBeVisible({ timeout: 10000 });

    await moveOver(page, tisch);
    await expect(page.getByTestId('hover-tooltip')).toBeVisible({ timeout: 3000 });

    const der = page.locator('[data-token-index]', { hasText: 'Der' }).first();
    await moveOver(page, der);
    await expect(page.getByTestId('hover-tooltip')).toHaveCount(0);
  });
});
