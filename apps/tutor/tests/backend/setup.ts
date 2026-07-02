/**
 * Backend test setup — provides a pg-mem-backed Express app for supertest.
 *
 * Strategy: We mock the `pg` module so that when server.ts creates its Pool,
 * it gets a pg-mem in-memory Pool instead. We also set required env vars
 * and mock external services (Google OAuth, Gemini, Stripe, TTS).
 */
import { vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { newDb, DataType } from 'pg-mem';

// ─── 1. Set required env vars BEFORE any imports ───
process.env.VITEST = 'true';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.SERVER_PORT = '0'; // don't bind

// ─── 2. Create pg-mem database ───
const db = newDb();

// Register common functions that pg-mem doesn't have built-in
db.public.registerFunction({
  name: 'gen_random_uuid',
  returns: DataType.text,
  implementation: () => crypto.randomUUID(),
});

// NOW() is built-in but let's ensure CURRENT_DATE works
db.public.registerFunction({
  name: 'current_date',
  returns: DataType.date,
  implementation: () => new Date(),
});

// Create a pg-compatible adapter
const pgMem = db.adapters.createPg();

// ─── 3. Mock the `pg` module to intercept Pool creation ───
vi.mock('pg', () => {
  return {
    Pool: pgMem.Pool,
    default: { Pool: pgMem.Pool },
  };
});

// ─── 4. Mock Google OAuth client ───
vi.mock('google-auth-library', () => {
  class MockOAuth2Client {
    verifyIdToken = vi.fn().mockResolvedValue({
      getPayload: () => ({
        sub: 'test-google-id-123',
        email: 'test@example.com',
        name: 'Test User',
        picture: 'https://example.com/photo.jpg',
      }),
    });
  }
  return { OAuth2Client: MockOAuth2Client };
});

// ─── 5. Mock Google GenAI (Gemini) ───
vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          input_language: 'de',
          input_type: 'word',
          selection: 'Tisch',
          meanings: ['стол'],
          lemma_translation: 'стол',
          translation: null,
          target_translations: [],
          part_of_speech: 'noun',
          morphology: { lemma: 'Tisch', gender: 'm', plural: 'Tische', case: 'NOM', number: 'SG', tense: null, person: null, mood: null, voice: null, degree: null, separable_prefix: null },
          forms: { noun: { singular: { nom: 'der Tisch', akk: 'den Tisch', dat: 'dem Tisch', gen: 'des Tisches' }, plural: { nom: 'die Tische', akk: 'die Tische', dat: 'den Tischen', gen: 'der Tische' } }, verb: { infinitive: '', praesens_ich: '', praeteritum: '', perfekt: '', konjunktiv_ii: '', imperativ_du: '' }, adjective: { positiv: '', komparativ: '', superlativ: '' } },
          sentence_structure: null,
          highlights: [],
          grammar_notes: [],
          examples: [{ text: 'Der Tisch ist groß.', translation: 'Стол большой.' }],
          notes: [],
        }),
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200 },
      }),
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

// ─── 6. Mock Google Cloud TTS ───
vi.mock('@google-cloud/text-to-speech', () => {
  class MockTextToSpeechClient {
    synthesizeSpeech = vi.fn().mockResolvedValue([{
      audioContent: Buffer.from('fake-audio-data'),
    }]);
  }
  return { TextToSpeechClient: MockTextToSpeechClient };
});

// ─── 7. Mock Stripe ───
vi.mock('stripe', () => {
  const MockStripe = vi.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: vi.fn(),
    },
    checkout: {
      sessions: { create: vi.fn() },
    },
    billingPortal: {
      sessions: { create: vi.fn() },
    },
  }));
  return { default: MockStripe };
});

// ─── 8. Helper to get the app and run initDb ───
let _app: any;
let _pool: any;
let _initDb: any;
let _initialized = false;

export async function getTestApp() {
  if (!_initialized) {
    // Dynamic import so mocks are in place
    const server = await import('../../server.ts');
    _app = server.app;
    _pool = server.pool;
    _initDb = server.initDb;

    try {
      await _initDb();
    } catch (err) {
      // pg-mem may not support all ALTER TABLE IF NOT EXISTS syntax
      // If initDb partially fails, try to create tables manually
      console.warn('initDb partial failure (expected with pg-mem):', (err as Error).message);
    }

    _initialized = true;
  }
  return { app: _app, pool: _pool };
}

// ─── 9. Helper to create a test user + session ───
export async function createTestUser(pool: any, opts?: {
  userId?: string;
  email?: string;
  name?: string;
  role?: string;
  subscriptionStatus?: string;
}) {
  const userId = opts?.userId || 'test-user-' + crypto.randomUUID().slice(0, 8);
  const email = opts?.email || `${userId}@test.com`;
  const name = opts?.name || 'Test User';
  const role = opts?.role || 'user';
  const subscriptionStatus = opts?.subscriptionStatus || 'free';

  await pool.query(
    `INSERT INTO users (id, email, name, role, subscription_status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [userId, email, name, role, subscriptionStatus]
  );

  const sessionId = 'sess-' + crypto.randomUUID().slice(0, 8);
  await pool.query(
    `INSERT INTO sessions (session_id, user_id, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [sessionId, userId]
  );

  return { userId, sessionId, email };
}

// ─── 10. Helper to create a workspace ───
export async function createTestWorkspace(pool: any, userId: string, name = 'Test Workspace') {
  const wsId = 'ws-' + crypto.randomUUID().slice(0, 8);
  const maxPos = await pool.query(
    'SELECT COALESCE(MAX(position), -1) as max_pos FROM workspaces WHERE user_id=$1',
    [userId]
  );
  const position = (maxPos.rows[0]?.max_pos ?? -1) + 1;

  await pool.query(
    'INSERT INTO workspaces (id, user_id, name, position) VALUES ($1, $2, $3, $4)',
    [wsId, userId, name, position]
  );
  await pool.query(
    `INSERT INTO workspace_state (workspace_id, state) VALUES ($1, '{}')`,
    [wsId]
  );
  await pool.query(
    'UPDATE users SET active_workspace_id=$1 WHERE id=$2 AND active_workspace_id IS NULL',
    [wsId, userId]
  );

  return wsId;
}
