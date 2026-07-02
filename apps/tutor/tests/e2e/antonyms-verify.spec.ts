import { test, expect, Page } from '@playwright/test';
import { mockLogin, mockTts } from './helpers';

// Custom explain payload for the German word "groß" that includes BOTH the
// existing near_synonyms list and the NEW antonyms list, to verify the
// antonyms section renders and sits after near-synonyms.
const RESULT_GROSS = {
  input_language: 'de',
  input_type: 'word',
  selection: 'groß',
  meanings: ['big', 'large', 'tall'],
  lemma_translation: 'big',
  translation: null,
  target_translations: [],
  part_of_speech: 'adjective',
  morphology: { lemma: 'groß', degree: 'POS' },
  forms: {
    noun: {},
    verb: {},
    adjective: { positiv: 'groß', komparativ: 'größer', superlativ: 'am größten' },
  },
  sentence_structure: null,
  highlights: [],
  grammar_notes: [],
  examples: [{ text: 'Das Haus ist groß.', translation: 'The house is big.' }],
  near_synonyms: [
    { word: 'riesig', difference: 'Much stronger — huge/enormous, not just big.' },
  ],
  antonyms: [
    { word: 'klein', meaning: 'small' },
    { word: 'winzig', meaning: 'tiny' },
  ],
  notes: [],
};

function mockExplainGross(page: Page) {
  return page.route('**/api/explain', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: RESULT_GROSS }),
    });
  });
}

// Re-route /api/state to a given interface language (registered AFTER mockLogin
// so it takes precedence). Mirrors the minimal shape the app needs to boot.
function mockStateLang(page: Page, interfaceLanguage: string) {
  const prefs = {
    interfaceLanguage,
    explanationLanguage: 'en',
    defaultTextLanguage: 'de',
    theme: 'light',
    setupCompleted: true,
    tutorialCompleted: true,
  };
  return page.route('**/api/state', async (route, request) => {
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            name: 'E2E Test User', email: 'e2e@test.com', picture: '', role: 'user',
            active_workspace_id: 'ws-1', preferences: prefs, subscription_status: 'active',
          },
          workspaces: [{ id: 'ws-1', name: 'Workspace 1', position: 0 }],
          activeWorkspaceId: 'ws-1',
          state: { text: '', textLanguage: 'de' },
          updatedAt: new Date().toISOString(),
          preferences: prefs,
          appSettings: { free_daily_explains: '999', free_daily_tts: '999', disabled_text_languages: '' },
        }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }) });
    }
  });
}

// Re-route /api/state to set the user's role (admin gates the regenerate button).
function mockStateRole(page: Page, role: 'user' | 'admin') {
  const prefs = {
    interfaceLanguage: 'en', explanationLanguage: 'en', defaultTextLanguage: 'de',
    theme: 'light', setupCompleted: true, tutorialCompleted: true,
  };
  return page.route('**/api/state', async (route, request) => {
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          user: { name: 'E2E Test User', email: 'e2e@test.com', picture: '', role, active_workspace_id: 'ws-1', preferences: prefs, subscription_status: 'active' },
          workspaces: [{ id: 'ws-1', name: 'Workspace 1', position: 0 }],
          activeWorkspaceId: 'ws-1',
          state: { text: '', textLanguage: 'de' },
          updatedAt: new Date().toISOString(), preferences: prefs,
          appSettings: { free_daily_explains: '999', free_daily_tts: '999', disabled_text_languages: '' },
        }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }) });
    }
  });
}

function preventSyncConflict(page: Page) {
  return page.route('**/api/state/*/timestamp', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: null }) });
  });
}

// A "groß" explanation as it would have been cached BEFORE the antonyms field
// existed: input_type word, but no `antonyms` key at all.
const STALE_GROSS = {
  input_language: 'de', input_type: 'word', selection: 'groß',
  meanings: ['big'], lemma_translation: 'big', translation: null,
  target_translations: [], part_of_speech: 'adjective',
  morphology: { lemma: 'groß' }, forms: { noun: {}, verb: {}, adjective: {} },
  sentence_structure: null, highlights: [], grammar_notes: [],
  examples: [{ text: 'Das Haus ist groß.', translation: 'The house is big.' }],
  notes: [],
};

// Boot the app with a persisted explanation cache holding the STALE groß above,
// so we can prove the cache is invalidated (re-fetched) rather than served.
function mockStateWithStaleCache(page: Page) {
  const prefs = {
    interfaceLanguage: 'en', explanationLanguage: 'en', defaultTextLanguage: 'de',
    theme: 'light', setupCompleted: true, tutorialCompleted: true,
  };
  return page.route('**/api/state', async (route, request) => {
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          user: { name: 'E2E Test User', email: 'e2e@test.com', picture: '', role: 'user', active_workspace_id: 'ws-1', preferences: prefs, subscription_status: 'active' },
          workspaces: [{ id: 'ws-1', name: 'Workspace 1', position: 0 }],
          activeWorkspaceId: 'ws-1',
          state: { text: 'groß und klein.', textLanguage: 'de', explainHistory: ['groß'], explanationCache: { 'groß': STALE_GROSS } },
          updatedAt: new Date().toISOString(),
          preferences: prefs,
          appSettings: { free_daily_explains: '999', free_daily_tts: '999', disabled_text_languages: '' },
        }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }) });
    }
  });
}

async function explainFirstWord(page: Page, text: string, labels = { read: 'Read', explain: 'Explain' }) {
  await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });
  // With empty state the app is in edit mode (textarea); when text is preloaded
  // from server state it boots straight into read mode (tokens, no textarea).
  const textarea = page.locator('textarea').first();
  if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) {
    await textarea.fill(text);
    const readBtn = page.locator('[data-tutorial="toolbar"] button span', { hasText: new RegExp(`^${labels.read}$`) }).first();
    await readBtn.click();
  }
  await page.waitForSelector('[data-token-index]', { timeout: 5000 });
  await page.locator('[data-token-index]').first().click();
  const explainBtn = page.locator('button', { hasText: new RegExp(`^${labels.explain}$`) }).first();
  await expect(explainBtn).toBeVisible({ timeout: 5000 });
  await explainBtn.click();
}

test.describe('Antonyms section', () => {
  test('renders antonyms after near-synonyms (en header "Antonyms")', async ({ page }) => {
    await mockLogin(page);
    await mockTts(page);
    await mockExplainGross(page);
    await preventSyncConflict(page);

    await page.goto('/app');
    await explainFirstWord(page, 'groß und klein.');

    const panel = page.locator('[data-tutorial="results-panel"]');
    await expect(panel).toBeVisible({ timeout: 5000 });
    // confirm the explanation actually loaded (heading = mock selection)
    await expect(panel.getByRole('heading', { name: 'groß' })).toBeVisible({ timeout: 5000 });

    // English header
    const antHeader = panel.getByRole('heading', { name: 'Antonyms', level: 4 });
    await expect(antHeader).toBeVisible({ timeout: 5000 });

    // Antonym words + glosses
    await expect(panel.getByText('klein', { exact: true })).toBeVisible();
    await expect(panel.getByText('winzig', { exact: true })).toBeVisible();
    await expect(panel.getByText('small', { exact: true })).toBeVisible();
    await expect(panel.getByText('tiny', { exact: true })).toBeVisible();

    // Near-synonyms header present and ABOVE antonyms
    const nearHeader = panel.getByRole('heading', { name: 'Closely related', level: 4 });
    await expect(nearHeader).toBeVisible();
    const nearY = (await nearHeader.boundingBox())!.y;
    const antY = (await antHeader.boundingBox())!.y;
    expect(antY).toBeGreaterThan(nearY);

    await page.screenshot({ path: 'test-results/antonyms-en.png', fullPage: true });
  });

  test('header is localized for ru interface ("Антонимы")', async ({ page }) => {
    await mockLogin(page);
    await mockStateLang(page, 'ru');
    await mockTts(page);
    await mockExplainGross(page);
    await preventSyncConflict(page);

    await page.goto('/app');
    await explainFirstWord(page, 'groß und klein.', { read: 'Чтение', explain: 'Объяснить' });

    const panel = page.locator('[data-tutorial="results-panel"]');
    await expect(panel).toBeVisible({ timeout: 5000 });
    await expect(panel.getByRole('heading', { name: 'Антонимы', level: 4 })).toBeVisible({ timeout: 5000 });
    await expect(panel.getByText('klein', { exact: true })).toBeVisible();

    await page.screenshot({ path: 'test-results/antonyms-ru.png', fullPage: true });
  });

  test('stale cached word (no antonyms) is re-fetched and gains antonyms', async ({ page }) => {
    await mockLogin(page);
    await mockStateWithStaleCache(page);
    await mockTts(page);
    await preventSyncConflict(page);

    // Track that the network re-fetch actually happens (vs. serving the stale cache).
    let explainCalls = 0;
    await page.route('**/api/explain', async (route) => {
      explainCalls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: RESULT_GROSS }) });
    });

    await page.goto('/app');
    await explainFirstWord(page, 'groß und klein.');

    const panel = page.locator('[data-tutorial="results-panel"]');
    await expect(panel).toBeVisible({ timeout: 5000 });
    // The stale cache had NO antonyms; these only appear if it was re-fetched.
    await expect(panel.getByRole('heading', { name: 'Antonyms', level: 4 })).toBeVisible({ timeout: 5000 });
    await expect(panel.getByText('klein', { exact: true })).toBeVisible();

    expect(explainCalls).toBeGreaterThan(0);
  });

  test('fresh cached word (antonyms: []) is served from cache, not re-fetched', async ({ page }) => {
    await mockLogin(page);
    // Seed a fresh entry: word with an empty (but present) antonyms array.
    const freshGross = { ...STALE_GROSS, antonyms: [] as Array<{ word: string; meaning: string }> };
    await page.route('**/api/state', async (route, request) => {
      if (request.method() === 'GET') {
        const prefs = { interfaceLanguage: 'en', explanationLanguage: 'en', defaultTextLanguage: 'de', theme: 'light', setupCompleted: true, tutorialCompleted: true };
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            user: { name: 'E2E Test User', email: 'e2e@test.com', picture: '', role: 'user', active_workspace_id: 'ws-1', preferences: prefs, subscription_status: 'active' },
            workspaces: [{ id: 'ws-1', name: 'Workspace 1', position: 0 }],
            activeWorkspaceId: 'ws-1',
            state: { text: 'groß und klein.', textLanguage: 'de', explainHistory: ['groß'], explanationCache: { 'groß': freshGross } },
            updatedAt: new Date().toISOString(), preferences: prefs,
            appSettings: { free_daily_explains: '999', free_daily_tts: '999', disabled_text_languages: '' },
          }),
        });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }) });
      }
    });
    await mockTts(page);
    await preventSyncConflict(page);

    let explainCalls = 0;
    await page.route('**/api/explain', async (route) => {
      explainCalls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: RESULT_GROSS }) });
    });

    await page.goto('/app');
    await explainFirstWord(page, 'groß und klein.');

    const panel = page.locator('[data-tutorial="results-panel"]');
    await expect(panel.getByRole('heading', { name: 'groß' })).toBeVisible({ timeout: 5000 });
    // Cache hit: no antonyms section (the fresh entry had none) and no network call.
    await expect(panel.getByRole('heading', { name: 'Antonyms', level: 4 })).toHaveCount(0);
    expect(explainCalls).toBe(0);
  });

  test('admin regenerate button drops the cache and refetches', async ({ page }) => {
    await mockLogin(page);
    await mockStateRole(page, 'admin');
    await mockTts(page);
    await preventSyncConflict(page);

    let explainCalls = 0;
    await page.route('**/api/explain', async (route) => {
      explainCalls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: RESULT_GROSS }) });
    });

    await page.goto('/app');
    await explainFirstWord(page, 'groß und klein.');

    const panel = page.locator('[data-tutorial="results-panel"]');
    await expect(panel.getByRole('heading', { name: 'groß' })).toBeVisible({ timeout: 5000 });
    expect(explainCalls).toBe(1); // initial explain (cache miss)

    // The regenerate button is admin-only; click it → cache drop + refetch.
    const regen = page.getByRole('button', { name: 'Regenerate (admin)' });
    await expect(regen).toBeVisible();
    await regen.click();

    await expect.poll(() => explainCalls, { timeout: 5000 }).toBe(2);
    await expect(panel.getByRole('heading', { name: 'groß' })).toBeVisible();
  });

  test('non-admin does not see the regenerate button', async ({ page }) => {
    await mockLogin(page);
    await mockStateRole(page, 'user');
    await mockTts(page);
    await mockExplainGross(page);
    await preventSyncConflict(page);

    await page.goto('/app');
    await explainFirstWord(page, 'groß und klein.');

    const panel = page.locator('[data-tutorial="results-panel"]');
    await expect(panel.getByRole('heading', { name: 'groß' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Regenerate (admin)' })).toHaveCount(0);
  });
});
