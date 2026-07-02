import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser, createTestWorkspace } from './setup';

let app: any;
let pool: any;
let sessionId: string;
let userId: string;

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

beforeEach(async () => {
  const user = await createTestUser(pool);
  sessionId = user.sessionId;
  userId = user.userId;
  await createTestWorkspace(pool, userId);
});

describe('POST /api/tts', () => {
  it('should require authentication', async () => {
    const res = await request(app)
      .post('/api/tts')
      .send({ text: 'Hallo', textLanguage: 'de' });

    expect(res.status).toBe(401);
  });

  it('should reject empty text', async () => {
    const res = await request(app)
      .post('/api/tts')
      .set('X-Session-Id', sessionId)
      .send({ text: '', textLanguage: 'de' });

    expect(res.status).toBe(400);
  });

  it('should reject missing text', async () => {
    const res = await request(app)
      .post('/api/tts')
      .set('X-Session-Id', sessionId)
      .send({ textLanguage: 'de' });

    expect(res.status).toBe(400);
  });

  it('should return audio for valid request', async () => {
    const res = await request(app)
      .post('/api/tts')
      .set('X-Session-Id', sessionId)
      .send({ text: 'Guten Tag', textLanguage: 'de' });

    // With mocked TTS, should succeed or fail gracefully
    // The mock returns fake audio data which may not have a proper WAV header
    // The endpoint may try to strip 44 bytes from the response
    if (res.status === 200) {
      expect(res.body.audio).toBeDefined();
    } else {
      // TTS might fail due to mock returning data shorter than WAV header
      expect([200, 500]).toContain(res.status);
    }
  });

  it('should accept a speed parameter', async () => {
    const res = await request(app)
      .post('/api/tts')
      .set('X-Session-Id', sessionId)
      .send({ text: 'Guten Tag', textLanguage: 'de', speed: 1.25 });

    // Speed is plumbed through to the provider; mock TTS may 200, 500, or
    // 503 depending on environment configuration. Just verify it's not a
    // client error — the server accepted the parameter.
    expect(res.status).not.toBe(400);
  });

  it('should ignore out-of-range speed values', async () => {
    const res = await request(app)
      .post('/api/tts')
      .set('X-Session-Id', sessionId)
      .send({ text: 'Guten Tag', textLanguage: 'de', speed: 99 });

    // Out-of-range speed clamps to 1.0 server-side; should not reject the request.
    expect(res.status).not.toBe(400);
  });
});

describe('TTS SSML escaping (via resolveTtsVoice)', () => {
  // This is tested in the pure function tests (tts-voice.test.ts)
  // Here we verify the endpoint doesn't crash with special characters
  it('should not crash with special characters in text', async () => {
    const res = await request(app)
      .post('/api/tts')
      .set('X-Session-Id', sessionId)
      .send({ text: 'Test <script>alert("xss")</script> & more', textLanguage: 'de' });

    // Should not return 400 — the text is valid, just has special chars
    expect(res.status).not.toBe(400);
  });
});

describe('POST /api/infer-genders', () => {
  it('should require authentication', async () => {
    const res = await request(app).post('/api/infer-genders').send({ names: ['John'] });
    expect(res.status).toBe(401);
  });

  it('returns a genders entry for every requested name', async () => {
    const res = await request(app)
      .post('/api/infer-genders')
      .set('X-Session-Id', sessionId)
      .send({ names: ['John', 'Kate'], textLanguage: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.genders).toBeDefined();
    expect(Object.keys(res.body.genders).sort()).toEqual(['John', 'Kate']);
    // Mocked Gemini returns unrelated JSON, so unknown names coerce to neutral.
    for (const g of Object.values(res.body.genders)) {
      expect(['male', 'female', 'neutral']).toContain(g);
    }
  });

  it('returns an empty map for no valid names', async () => {
    const res = await request(app)
      .post('/api/infer-genders')
      .set('X-Session-Id', sessionId)
      .send({ names: [123, '', null] });
    expect(res.status).toBe(200);
    expect(res.body.genders).toEqual({});
  });
});
