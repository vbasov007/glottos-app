import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser, createTestWorkspace } from './setup';

let app: any;
let pool: any;
let sessionId: string;
let userId: string;

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

beforeEach(async () => {
  const user = await createTestUser(pool);
  sessionId = user.sessionId;
  userId = user.userId;
  await createTestWorkspace(pool, userId);
  // Provide an OpenAI key via app_settings so the handler proceeds to fetch
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('openai_api_key', 'test-openai-key')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/ocr-extract', () => {
  it('should require authentication', async () => {
    const res = await request(app)
      .post('/api/ocr-extract')
      .send({ image: TINY_PNG, language: 'de' });

    expect(res.status).toBe(401);
  });

  it('should reject missing image', async () => {
    const res = await request(app)
      .post('/api/ocr-extract')
      .set('X-Session-Id', sessionId)
      .send({ language: 'de' });

    expect(res.status).toBe(400);
  });

  it('should reject non-data-URL image', async () => {
    const res = await request(app)
      .post('/api/ocr-extract')
      .set('X-Session-Id', sessionId)
      .send({ image: 'https://example.com/foo.png', language: 'de' });

    expect(res.status).toBe(400);
  });

  it('should reject missing language', async () => {
    const res = await request(app)
      .post('/api/ocr-extract')
      .set('X-Session-Id', sessionId)
      .send({ image: TINY_PNG });

    expect(res.status).toBe(400);
  });

  it('should return extracted text on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'Guten Tag\nWie geht es dir?' } }],
        usage: { prompt_tokens: 50, completion_tokens: 12 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app)
      .post('/api/ocr-extract')
      .set('X-Session-Id', sessionId)
      .send({ image: TINY_PNG, language: 'de' });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Guten Tag\nWie geht es dir?');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-openai-key',
        }),
      })
    );
    // Image should be sent with detail:"low" for fastest inference
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const imagePart = sentBody.messages[0].content.find((c: any) => c.type === 'image_url');
    expect(imagePart.image_url.detail).toBe('low');
  });

  it('should propagate OpenAI errors as 502 with status, model and detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({
        error: { message: 'rate limited', type: 'rate_limit_exceeded', code: 'rate_limit' },
      }),
    }));

    const res = await request(app)
      .post('/api/ocr-extract')
      .set('X-Session-Id', sessionId)
      .send({ image: TINY_PNG, language: 'de' });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain('429');
    expect(res.body.error).toContain('rate limited');
    expect(res.body.error).toContain('type=rate_limit_exceeded');
    expect(res.body.error).toContain('code=rate_limit');
  });

  it('should return 422 when OpenAI replies with a refusal/clarification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'Could you provide a higher-resolution image or a closer crop of the page? The current image is too blurry to read accurately.' } }],
        usage: { prompt_tokens: 80, completion_tokens: 30 },
      }),
    }));

    const res = await request(app)
      .post('/api/ocr-extract')
      .set('X-Session-Id', sessionId)
      .send({ image: TINY_PNG, language: 'de' });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('higher-resolution');
  });

  it('should report upstream non-2xx without a JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '<html>Bad Gateway</html>',
    }));

    const res = await request(app)
      .post('/api/ocr-extract')
      .set('X-Session-Id', sessionId)
      .send({ image: TINY_PNG, language: 'de' });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain('503');
    expect(res.body.error).toContain('Bad Gateway');
  });
});
