import { test, expect } from '@playwright/test';
import { mockTts } from './helpers';

test.describe('State Persistence', () => {
  test('on page load, state is fetched from /api/state', async ({ page }) => {
    let stateRequested = false;

    // Set up session in localStorage
    await page.addInitScript(() => {
      localStorage.setItem('session_id', 'e2e-test-session');
      localStorage.setItem('user', JSON.stringify({
        name: 'E2E Test User',
        email: 'e2e@test.com',
        picture: '',
        role: 'user',
      }));
      localStorage.setItem('preferences', JSON.stringify({
        interfaceLanguage: 'en',
        explanationLanguage: 'en',
        defaultTextLanguage: 'de',
        theme: 'light',
        setupCompleted: true,
        tutorialCompleted: true,
      }));
    });

    // Intercept state GET and track it
    await page.route('**/api/state', async (route, request) => {
      if (request.method() === 'GET') {
        stateRequested = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              name: 'E2E Test User',
              email: 'e2e@test.com',
              picture: '',
              role: 'user',
              active_workspace_id: 'ws-1',
              preferences: {
                interfaceLanguage: 'en',
                explanationLanguage: 'en',
                defaultTextLanguage: 'de',
                theme: 'light',
                setupCompleted: true,
                tutorialCompleted: true,
              },
              subscription_status: 'active',
            },
            workspaces: [{ id: 'ws-1', name: 'Workspace 1', position: 0 }],
            activeWorkspaceId: 'ws-1',
            state: { text: 'Existing text from server', textLanguage: 'de' },
            updatedAt: new Date().toISOString(),
            preferences: {
              interfaceLanguage: 'en',
              explanationLanguage: 'en',
              defaultTextLanguage: 'de',
              theme: 'light',
              setupCompleted: true,
              tutorialCompleted: true,
            },
            appSettings: {
              free_daily_explains: '999',
              free_daily_tts: '999',
              disabled_text_languages: '',
            },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }),
        });
      }
    });

    // Mock other endpoints
    await page.route('**/api/state/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: {}, updatedAt: new Date().toISOString() }),
      });
    });
    await page.route('**/api/subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'active', periodEnd: null, cancelAtPeriodEnd: false,
          usage: { explains: 0, tts: 0, generates: 0 },
          limits: null, wavUsage: { text: 0, flashcards: 0 }, wavLimits: null,
        }),
      });
    });
    await page.route('**/api/preferences', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**/api/workspaces', async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ id: 'ws-new', name: 'New Workspace', position: 1 }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/log', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await mockTts(page);

    await page.goto('/app');

    // Wait for the app to load and fetch state
    await page.waitForSelector('[data-tutorial="toolbar"]', { timeout: 10000 });

    expect(stateRequested).toBe(true);
  });

  test('after entering text, a save request is sent to /api/state with the text', async ({ page }) => {
    let savedBody: any = null;

    await page.addInitScript(() => {
      localStorage.setItem('session_id', 'e2e-test-session');
      localStorage.setItem('user', JSON.stringify({
        name: 'E2E Test User',
        email: 'e2e@test.com',
        picture: '',
        role: 'user',
      }));
      localStorage.setItem('preferences', JSON.stringify({
        interfaceLanguage: 'en',
        explanationLanguage: 'en',
        defaultTextLanguage: 'de',
        theme: 'light',
        setupCompleted: true,
        tutorialCompleted: true,
      }));
    });

    // Intercept state requests — capture PUT body
    await page.route('**/api/state', async (route, request) => {
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              name: 'E2E Test User',
              email: 'e2e@test.com',
              picture: '',
              role: 'user',
              active_workspace_id: 'ws-1',
              preferences: {
                interfaceLanguage: 'en',
                explanationLanguage: 'en',
                defaultTextLanguage: 'de',
                theme: 'light',
                setupCompleted: true,
                tutorialCompleted: true,
              },
              subscription_status: 'active',
            },
            workspaces: [{ id: 'ws-1', name: 'Workspace 1', position: 0 }],
            activeWorkspaceId: 'ws-1',
            state: { text: '', textLanguage: 'de' },
            updatedAt: new Date().toISOString(),
            preferences: {
              interfaceLanguage: 'en',
              explanationLanguage: 'en',
              defaultTextLanguage: 'de',
              theme: 'light',
              setupCompleted: true,
              tutorialCompleted: true,
            },
            appSettings: {
              free_daily_explains: '999',
              free_daily_tts: '999',
              disabled_text_languages: '',
            },
          }),
        });
      } else if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        if (body?.state?.text) {
          savedBody = body;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }),
        });
      }
    });

    await page.route('**/api/state/**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ state: {}, updatedAt: new Date().toISOString() }),
      });
    });
    await page.route('**/api/subscription', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          status: 'active', periodEnd: null, cancelAtPeriodEnd: false,
          usage: { explains: 0, tts: 0, generates: 0 },
          limits: null, wavUsage: { text: 0, flashcards: 0 }, wavLimits: null,
        }),
      });
    });
    await page.route('**/api/preferences', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**/api/workspaces', async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ id: 'ws-new', name: 'New Workspace', position: 1 }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/log', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await mockTts(page);

    await page.goto('/app');
    await page.waitForSelector('textarea', { timeout: 10000 });

    // Enter text
    const textarea = page.locator('textarea').first();
    await textarea.fill('Neuer Text zum Speichern');

    // Wait for debounced save (app uses 2s debounce)
    await page.waitForTimeout(3000);

    // Verify the save was called with the entered text
    expect(savedBody).not.toBeNull();
    expect(savedBody.state.text).toBe('Neuer Text zum Speichern');
  });
});
