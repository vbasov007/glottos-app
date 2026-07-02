import { Page } from '@playwright/test';

/**
 * Mock the /api/auth/google endpoint and set up a fake session
 * so E2E tests don't need real Google OAuth.
 */
export async function mockLogin(page: Page) {
  // Intercept the auth endpoint
  await page.route('**/api/auth/google', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: 'e2e-test-session',
        user: {
          name: 'E2E Test User',
          email: 'e2e@test.com',
          picture: '',
          role: 'user',
        },
      }),
    });
  });

  // Intercept state load
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
          workspaces: [
            { id: 'ws-1', name: 'Workspace 1', position: 0 },
          ],
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
    } else {
      // PUT/POST state save — just acknowledge
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }),
      });
    }
  });

  // Mock state save for specific workspace IDs
  await page.route('**/api/state/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: {}, updatedAt: new Date().toISOString() }),
    });
  });

  // Mock subscription
  await page.route('**/api/subscription', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'active',
        periodEnd: null,
        cancelAtPeriodEnd: false,
        usage: { explains: 0, tts: 0, generates: 0 },
        limits: null,
        wavUsage: { text: 0, flashcards: 0 },
        wavLimits: null,
      }),
    });
  });

  // Mock preferences save
  await page.route('**/api/preferences', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  // Mock workspace operations
  await page.route('**/api/workspaces', async (route, request) => {
    if (request.method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'ws-' + Date.now(),
          name: 'New Workspace',
          position: 1,
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Mock log endpoint
  await page.route('**/api/log', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  // Set session in localStorage before navigation
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
}

/**
 * Mock the explain endpoint to return a canned response
 */
export async function mockExplain(page: Page, response?: Record<string, unknown>) {
  await page.route('**/api/explain', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: response || {
          input_language: 'de',
          input_type: 'word',
          selection: 'Tisch',
          meanings: ['table'],
          lemma_translation: 'table',
          translation: null,
          target_translations: [],
          part_of_speech: 'noun',
          morphology: {
            lemma: 'Tisch',
            gender: 'm',
            plural: 'Tische',
            case: 'NOM',
            number: 'SG',
          },
          forms: {
            noun: {
              singular: { nom: 'der Tisch', akk: 'den Tisch', dat: 'dem Tisch', gen: 'des Tisches' },
              plural: { nom: 'die Tische', akk: 'die Tische', dat: 'den Tischen', gen: 'der Tische' },
            },
            verb: {},
            adjective: {},
          },
          sentence_structure: null,
          highlights: [],
          grammar_notes: [],
          examples: [{ text: 'Der Tisch ist groß.', translation: 'The table is big.' }],
          notes: [],
        },
      }),
    });
  });
}

/**
 * Mock TTS endpoint
 */
export async function mockTts(page: Page) {
  await page.route('**/api/tts', async (route) => {
    // Return a minimal valid base64 PCM (silence)
    const silence = Buffer.alloc(4800).toString('base64'); // 100ms of silence at 24kHz
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ audio: silence }),
    });
  });
}
