import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { getPool } from '@glottos/shared';
import { OAuth2Client } from 'google-auth-library';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { GoogleGenAI } from '@google/genai';
import Stripe from 'stripe';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { LANGUAGES as FRONTEND_LANGUAGES } from './src/i18n/languages';
import {
  initDeck as srsInitDeck,
  selectNext as srsSelectNext,
  record as srsRecord,
  reconcile as srsReconcile,
  xMax as srsXMax,
  DEFAULT_CONFIG,
  type DeckSched,
} from './src/lib/intervalScheduler';

// Interval cap M = 1 → X_MAX = N (one full deck pass). This keeps the deck
// dense: with intervals never exceeding the deck size, a card's virtual-time
// interval tracks its position in the show order, so "don't know" (interval 4)
// resurfaces a card ~4 cards later rather than immediately. A larger M lets
// mastered cards drift far enough apart that the deck goes sparse and the
// interval stops corresponding to a card count.
const SRS_CONFIG = { ...DEFAULT_CONFIG, M: 1 };
import { isOcrRefusal, verifyTelegramInitData, signLinkState, verifyLinkState, estimateCostUsd, TTS_VOICE_CATALOG, TtsVoiceEntry, buildAntonymBackfillPrompt, coerceAntonyms, buildPrompt } from './server-utils';
import { signSsoToken, verifySsoToken } from './sso';
import {
  TIMEOUTS as SERVER_TIMEOUTS,
  SESSION_TTL_DAYS,
  POOL,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMITS,
  CLEANUP_INTERVAL_MS,
} from './server-constants';
dotenv.config();

// #15 — Validate required env vars before starting
const REQUIRED_ENV = ['DATABASE_URL', 'GOOGLE_CLIENT_ID'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = express();

// Stripe setup — initialize before express.json() so webhook can use raw body
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// Stripe webhook must be registered BEFORE express.json() for raw body access
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(404).json({ error: 'Stripe not configured' });
  }
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        if (userId && session.subscription) {
          await pool.query(
            'UPDATE users SET stripe_customer_id=$1, subscription_id=$2, subscription_status=$3 WHERE id=$4',
            [session.customer as string, session.subscription as string, 'active', userId]
          );
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        // current_period_end moved to items in newer Stripe API versions
        const periodEnd = sub.items?.data?.[0]?.current_period_end;
        await pool.query(
          `UPDATE users SET subscription_status=$1, subscription_id=$2,
           subscription_period_end=$3, cancel_at_period_end=$4
           WHERE stripe_customer_id=$5`,
          [
            sub.status === 'active' || sub.status === 'trialing' ? sub.status : sub.status === 'past_due' ? 'past_due' : 'free',
            sub.id,
            periodEnd ? new Date(periodEnd * 1000) : null,
            sub.cancel_at_period_end,
            customerId,
          ]
        );
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        await pool.query(
          `UPDATE users SET subscription_status='free', subscription_id=NULL,
           subscription_period_end=NULL, cancel_at_period_end=FALSE
           WHERE stripe_customer_id=$1`,
          [customerId]
        );
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        await pool.query(
          "UPDATE users SET subscription_status='past_due' WHERE stripe_customer_id=$1",
          [customerId]
        );
        break;
      }
    }
  } catch (err) {
    console.error('Stripe webhook handler error:', err);
  }

  res.json({ received: true });
});

app.use(express.json({ limit: '50mb' }));  // TTS base64 can be large
app.use(express.urlencoded({ extended: true }));  // Google OAuth redirect POSTs form data
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : process.env.APP_URL
    ? [process.env.APP_URL.replace(/\/$/, '')]
    : undefined; // undefined = permissive in dev (no APP_URL set)

app.set('trust proxy', 1); // trust first proxy (nginx / App Platform) for correct client IP

// Permissive CORS for public/API-key endpoints — must be BEFORE global cors
// so that external pages, iframes, and scripts can call these endpoints
const publicCors = cors({ origin: true, credentials: false });
app.options('/api/create-shared', publicCors);
app.options('/api/shared/:id', publicCors);

app.use(cors({
  origin: ALLOWED_ORIGINS || true,
  credentials: true,
}));

// Rate limiters (per IP, using X-Forwarded-For from trusted proxy)
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMITS.API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const ttsLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMITS.TTS_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many TTS requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMITS.AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

// Build/version stamp — `build-info.json` is written at image build time (see
// Dockerfile) so you can confirm at a glance which commit production is running:
//   curl https://<host>/api/health
// Registered before the rate limiter and before auth so it's always reachable.
const SERVER_STARTED_AT = new Date().toISOString();
let BUILD_INFO: { commit: string; builtAt: string | null };
try {
  BUILD_INFO = JSON.parse(readFileSync(new URL('./build-info.json', import.meta.url), 'utf-8'));
} catch {
  // No stamp (e.g. local dev where the image build step didn't run).
  BUILD_INFO = { commit: process.env.GIT_COMMIT || 'dev', builtAt: null };
}
console.log(`[startup] build commit=${BUILD_INFO.commit} builtAt=${BUILD_INFO.builtAt ?? 'n/a'}`);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    commit: BUILD_INFO.commit,
    builtAt: BUILD_INFO.builtAt,
    startedAt: SERVER_STARTED_AT,
  });
});

app.use('/api/', apiLimiter);

// The Postgres pool is now the ONE shared pool from @glottos/shared (one database
// for both apps). The sslmode-stripping + managed-cert SSL workaround lives there.
const pool = getPool();
pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
});
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Wrap async route handlers so unhandled rejections reach the error middleware
type AsyncHandler = (req: any, res: express.Response, next: express.NextFunction) => Promise<any>;
const asyncHandler = (fn: AsyncHandler): express.RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Initialize Google Cloud TTS
let ttsClient: TextToSpeechClient | null = null;
if (process.env.GOOGLE_CLOUD_TTS_CREDENTIALS) {
  try {
    const credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_CLOUD_TTS_CREDENTIALS, 'base64').toString()
    );
    ttsClient = new TextToSpeechClient({ credentials });
  } catch (err) {
    console.warn('Failed to initialize Google Cloud TTS:', err);
  }
}

// Pricing constants (USD) — update here when API prices change
const PRICING = {
  gemini_flash: { inputPerToken: 0.15 / 1_000_000, outputPerToken: 0.60 / 1_000_000 },
  tts: { perChar: 16.0 / 1_000_000 },
};

// Language configuration
// TTS config derived from the single source of truth in src/i18n/languages.ts
const LANGUAGES: Record<string, { ttsLang: string; ttsVoice: string; ttsAzureVoice: string; defaultTtsProvider?: 'google' | 'azure' }> =
  Object.fromEntries(
    Object.entries(FRONTEND_LANGUAGES).map(([code, lang]) => [code, {
      ttsLang: lang.ttsLang,
      ttsVoice: lang.ttsVoice,
      ttsAzureVoice: lang.ttsAzureVoice,
      ...(lang.defaultTtsProvider ? { defaultTtsProvider: lang.defaultTtsProvider } : {}),
    }])
  );

// User-selectable voice catalog, narrowed to entries that actually synthesized
// audio at startup. Frontend's GET /api/tts/voices returns from this map.
// Populated asynchronously by verifyTtsVoiceCatalog() — until that finishes,
// the map is empty and the endpoint returns [] (frontend hides the voice
// button until a non-empty list arrives).
const verifiedVoiceCatalog: Record<string, TtsVoiceEntry[]> = {};

// Yandex SpeechKit language → voice mapping
const YANDEX_VOICES: Record<string, { lang: string; voice: string }> = {
  de: { lang: 'de-DE', voice: 'lea' },
  en: { lang: 'en-US', voice: 'john' },
  fr: { lang: 'fr-FR', voice: 'lea' },
  es: { lang: 'es-ES', voice: 'lea' },
  he: { lang: 'he-IL', voice: 'naomi' },
  ru: { lang: 'ru-RU', voice: 'marina' },
  hr: { lang: 'de-DE', voice: 'lea' }, // no Croatian in Yandex, fallback to German
  ja: { lang: 'ja-JP', voice: 'lea' }, // limited support, fallback
};

// Azure TTS — synthesize via REST API, returns raw PCM base64
// Azure token cache — tokens are valid for 10 minutes, refresh at 9
let azureTokenCache: { token: string; region: string; expiresAt: number } | null = null;

async function azureTts(text: string, voiceName: string, _languageCode: string, azureKey: string, azureRegion: string, speed: number = 1.0): Promise<string> {
  // Extract locale from voice name (e.g. "ka-GE-GiorgiNeural" → "ka-GE", "de-DE-Seraphina:DragonHDLatestNeural" → "de-DE")
  const parts = voiceName.split('-');
  const azureLang = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : _languageCode;

  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inner = speed && speed !== 1
    ? `<prosody rate="${Math.round(speed * 100)}%">${escaped}</prosody>`
    : escaped;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${azureLang}"><voice name="${voiceName}">${inner}</voice></speak>`;

  const keyPreview = azureKey.substring(0, 6) + '...' + azureKey.substring(azureKey.length - 4);
  // Token exchange: api.cognitive.microsoft.com; TTS synthesis: tts.speech.microsoft.com
  const ttsUrl = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;

  // Try direct key auth first, then token-based auth as fallback
  let lastError = '';
  for (const authMethod of ['direct', 'token'] as const) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
      'User-Agent': 'Glottos-TTS',
    };

    if (authMethod === 'token') {
      // Exchange key for bearer token
      const tokenUrl = `https://${azureRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': azureKey, 'Content-Length': '0' },
      });
      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        lastError = `Token auth failed (${tokenRes.status}): ${errText}`;
        console.error(`[azure-tts] token exchange failed: ${tokenRes.status} key=${keyPreview} region=${azureRegion}`);
        continue;
      }
      headers['Authorization'] = `Bearer ${await tokenRes.text()}`;
    } else {
      headers['Ocp-Apim-Subscription-Key'] = azureKey;
    }

    const response = await Promise.race([
      fetch(ttsUrl, { method: 'POST', headers, body: ssml }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Azure TTS request timeout')), SERVER_TIMEOUTS.TTS)),
    ]);

    if (response.ok) {
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      return audioBuffer.toString('base64');
    }

    const errText = await response.text();
    lastError = `${authMethod} auth: HTTP ${response.status}: ${errText}`;
    console.error(`[azure-tts] ${authMethod} auth failed: ${response.status} key=${keyPreview} region=${azureRegion} voice=${voiceName} body=${errText.substring(0, 500)}`);
  }

  throw new Error(`Azure TTS failed (key=${keyPreview}, region=${azureRegion}): ${lastError}`);
}

// Helper: resolve per-language TTS provider and voice from settings
function resolveTtsVoice(textLanguage: string, settings: Record<string, string>): { provider: 'google' | 'azure'; voice: string } {
  const lang = LANGUAGES[textLanguage] || LANGUAGES['de'];
  const globalProvider = settings.tts_provider || 'google';

  try {
    const overrides = settings.tts_voices ? JSON.parse(settings.tts_voices) : {};
    const entry = overrides[textLanguage];
    if (entry && typeof entry === 'object' && entry.provider && entry.voice) {
      return { provider: entry.provider, voice: entry.voice };
    }
    // Backward compat: string value = google voice override
    if (entry && typeof entry === 'string') {
      return { provider: 'google', voice: entry };
    }
  } catch { /* ignore bad JSON */ }

  // No override — use per-language default provider, then global provider
  const effectiveProvider = lang.defaultTtsProvider || (globalProvider === 'azure' ? 'azure' : 'google');
  if (effectiveProvider === 'azure') {
    return { provider: 'azure', voice: lang.ttsAzureVoice };
  }
  return { provider: 'google', voice: lang.ttsVoice };
}

// Language labels for prompt generation
const LANGUAGE_LABELS: Record<string, string> = {
  de: 'German', en: 'English', fr: 'French', es: 'Spanish',
  he: 'Hebrew', ru: 'Russian', zh: 'Chinese (Mandarin)', it: 'Italian',
  pt: 'Portuguese', ar: 'Arabic', hr: 'Croatian', ja: 'Japanese',
  ko: 'Korean', nl: 'Dutch', pl: 'Polish', tr: 'Turkish',
  uk: 'Ukrainian', sv: 'Swedish', da: 'Danish', no: 'Norwegian',
  fi: 'Finnish', cs: 'Czech', el: 'Greek', ro: 'Romanian',
  hu: 'Hungarian', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian',
  hi: 'Hindi', bn: 'Bengali', sk: 'Slovak', bg: 'Bulgarian',
  sr: 'Serbian', ca: 'Catalan', ka: 'Georgian', hy: 'Armenian',
  kk: 'Kazakh', uz: 'Uzbek', lv: 'Latvian', lt: 'Lithuanian', et: 'Estonian',
};

const LOGOGRAPHIC_LANGUAGES = new Set(['zh', 'ja']);
const getTextLimit = (lang: string) => LOGOGRAPHIC_LANGUAGES.has(lang) ? 500 : 2000;

// Init DB tables on startup
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      preferences JSONB DEFAULT '{"interfaceLanguage":"en","explanationLanguage":"en"}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_state (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      state JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL DEFAULT 'Workspace 1',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS workspace_state (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      state JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS active_workspace_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{"interfaceLanguage":"en","explanationLanguage":"en"}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Add cost-tracking and device columns to activity_log
  await pool.query(`
    ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS input_units INTEGER;
    ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS output_units INTEGER;
    ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS device TEXT;
    ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS model TEXT;
    ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS provider TEXT;
    ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS language TEXT;
    ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
  `);

  // Stripe subscription columns on users
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE;
  `);

  // Daily usage tracking for quota enforcement
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_usage (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
      explain_count INTEGER NOT NULL DEFAULT 0,
      tts_count INTEGER NOT NULL DEFAULT 0,
      generate_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, usage_date)
    );
  `);

  // WAV download columns on daily_usage (summed weekly for quota)
  await pool.query(`
    ALTER TABLE daily_usage ADD COLUMN IF NOT EXISTS wav_text_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE daily_usage ADD COLUMN IF NOT EXISTS wav_flashcard_count INTEGER NOT NULL DEFAULT 0;
  `);

  // App-wide settings (LLM model, thinking budget, etc.)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO app_settings (key, value) VALUES ('llm_model', 'gemini-2.5-flash-lite') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('llm_fallback_model', 'gemini-2.5-flash-lite') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('thinking_budget', '-1') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('llm_provider', 'gemini') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('deepseek_endpoint', 'https://api.deepseek.com/v1') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('deepseek_api_key', '') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('tts_provider', 'google') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('yandex_tts_api_key', '') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('free_daily_explains', '5') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('free_daily_tts', '5') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('free_daily_generates', '2') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('free_max_generate_sentences', '10') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('free_max_text_length', '800') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('disabled_text_languages', '') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('free_weekly_wav_text', '1') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('free_weekly_wav_flashcards', '1') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('tts_voices', '{}') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('azure_tts_key', '') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('azure_tts_region', 'westeurope') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('russian_stress_model', 'gemini-2.5-flash') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('anon_daily_explains', '3') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('anon_daily_tts', '3') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('anon_daily_generates', '1') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('anon_session_ttl_days', '7') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('anon_max_text_length', '400') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('anon_max_generate_sentences', '5') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('free_trial_days', '0') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('free_limits_enabled', 'true') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('anon_limits_enabled', 'true') ON CONFLICT DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('anon_max_workspaces', '1') ON CONFLICT DO NOTHING;
  `);

  // Index for monitoring time-range queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
  `);

  // Promo sources for tracking promotion channels
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promo_sources (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS source_code TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
  `);

  // Shared lessons for link sharing
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_lessons (
      id TEXT PRIMARY KEY,
      creator_user_id TEXT REFERENCES users(id),
      workspace_id TEXT,
      state JSONB NOT NULL,
      text_language TEXT NOT NULL DEFAULT 'de',
      workspace_name TEXT,
      share_source TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE shared_lessons ADD COLUMN IF NOT EXISTS workspace_name TEXT;
    ALTER TABLE shared_lessons ADD COLUMN IF NOT EXISTS share_source TEXT;
    ALTER TABLE shared_lessons ADD COLUMN IF NOT EXISTS workspace_id TEXT;
    ALTER TABLE shared_lessons ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ready';
    ALTER TABLE shared_lessons ADD COLUMN IF NOT EXISTS progress_total INTEGER DEFAULT 0;
    ALTER TABLE shared_lessons ADD COLUMN IF NOT EXISTS progress_done INTEGER DEFAULT 0;
    ALTER TABLE shared_lessons ADD COLUMN IF NOT EXISTS content_hash TEXT;
  `);

  // API keys for external access
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      key_hash TEXT UNIQUE NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // User-level flashcard decks (shared across all workspaces)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flashcard_decks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_flashcard_decks_user ON flashcard_decks(user_id);
    CREATE TABLE IF NOT EXISTS flashcard_deck_cards (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
      source_text TEXT NOT NULL,
      text_language TEXT NOT NULL,
      explanation JSONB NOT NULL,
      frequency SMALLINT NOT NULL DEFAULT 2,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (deck_id, source_text)
    );
    CREATE INDEX IF NOT EXISTS idx_flashcard_deck_cards_deck ON flashcard_deck_cards(deck_id);
    ALTER TABLE flashcard_deck_cards ADD COLUMN IF NOT EXISTS explanation_language TEXT;
  `);

  // The unique (user_id, name) index was added after duplicates already existed
  // in production. Dedupe first by appending a short id suffix to all but the
  // oldest row in each group, then create the index. Once the constraint is
  // enforced, duplicates can't reappear, so the dedupe becomes a permanent
  // no-op and the CREATE INDEX IF NOT EXISTS short-circuits.
  try {
    const dedupe = await pool.query(`
      WITH ranked AS (
        SELECT id, user_id, name,
               ROW_NUMBER() OVER (PARTITION BY user_id, name ORDER BY created_at, id) AS rn
          FROM flashcard_decks
      )
      UPDATE flashcard_decks d
         SET name = d.name || ' #' || SUBSTRING(d.id FROM 1 FOR 8)
        FROM ranked r
       WHERE d.id = r.id AND r.rn > 1
       RETURNING d.id
    `);
    if (dedupe.rowCount && dedupe.rowCount > 0) {
      console.log(`[initDb] Renamed ${dedupe.rowCount} duplicate deck name(s) before adding unique index`);
    }
  } catch (err: any) {
    // pg-mem (used in tests) doesn't support CTE + UPDATE...FROM. That's fine —
    // tests start with a clean DB so there are no dupes to rename anyway. In prod
    // (real Postgres) this branch shouldn't fire; if it does we still try the index.
    console.warn('[initDb] Dedupe step skipped:', err?.message || err);
  }
  try {
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_flashcard_decks_user_name ON flashcard_decks(user_id, name)');
  } catch (err: any) {
    // Don't take the whole app down if this single index can't be created — the
    // 23505 catch in the route handlers still keeps user-facing dups out.
    console.warn('[initDb] Could not enforce unique deck name index:', err?.message || err);
  }

  // Per-(user, card, direction) SRS state. Rows are created lazily on the
  // first grade — a card with no row for a given direction is treated as a
  // fresh CardState (phase=new, due=null) for that direction. Forward =
  // target→native (default); reverse = native→target.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS srs_card_state (
      user_id        TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id        TEXT        NOT NULL REFERENCES flashcard_deck_cards(id) ON DELETE CASCADE,
      deck_id        TEXT        NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
      direction      TEXT        NOT NULL DEFAULT 'forward' CHECK (direction IN ('forward','reverse')),
      phase          TEXT        NOT NULL DEFAULT 'new' CHECK (phase IN ('new','learning','review')),
      step_index     SMALLINT    NOT NULL DEFAULT 0,
      ease           REAL        NOT NULL DEFAULT 2.3,
      interval_days  REAL        NOT NULL DEFAULT 0,
      due            TIMESTAMPTZ,
      reps           INTEGER     NOT NULL DEFAULT 0,
      lapses         INTEGER     NOT NULL DEFAULT 0,
      is_leech       BOOLEAN     NOT NULL DEFAULT FALSE,
      last_reviewed  TIMESTAMPTZ,
      PRIMARY KEY (user_id, card_id, direction)
    );
  `);
  // Migration for prod tables created before the direction column existed.
  // Default existing rows to 'forward' and recreate the PK to include direction.
  try {
    await pool.query("ALTER TABLE srs_card_state ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'forward'");
  } catch (err: any) { console.warn('[initDb] srs direction column add skipped:', err?.message || err); }
  try {
    // Only do the PK swap if the current PK is the old (user_id, card_id) shape.
    // Wrapped — if it fails we keep going; the runtime upsert below uses the
    // shape that matches whichever PK exists.
    await pool.query('ALTER TABLE srs_card_state DROP CONSTRAINT IF EXISTS srs_card_state_pkey');
    await pool.query('ALTER TABLE srs_card_state ADD PRIMARY KEY (user_id, card_id, direction)');
  } catch (err: any) { console.warn('[initDb] srs PK swap skipped:', err?.message || err); }
  // Partial indexes — wrap individually so pg-mem failures don't take down init.
  try {
    await pool.query("CREATE INDEX IF NOT EXISTS idx_srs_due ON srs_card_state (user_id, deck_id, due) WHERE phase <> 'new'");
  } catch (err: any) { console.warn('[initDb] idx_srs_due skipped:', err?.message || err); }
  try {
    await pool.query("CREATE INDEX IF NOT EXISTS idx_srs_new ON srs_card_state (user_id, deck_id) WHERE phase = 'new'");
  } catch (err: any) { console.warn('[initDb] idx_srs_new skipped:', err?.message || err); }
  try {
    await pool.query("CREATE INDEX IF NOT EXISTS idx_srs_leech ON srs_card_state (user_id, deck_id) WHERE is_leech");
  } catch (err: any) { console.warn('[initDb] idx_srs_leech skipped:', err?.message || err); }

  // Interval-doubling scheduler state (replaces the SM-2 srs_card_state above,
  // which is now retained untouched as a backup). Per (user, deck, direction):
  // a virtual review clock `t`, the shuffle `seed`, and the deck size `n` at
  // init. Per (user, card, direction): the card's `rank` in the shuffle
  // (phase = rank/n), its current interval `x`, and `next_due` (virtual time of
  // its next appearance). A card with no row is implicitly fresh.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS srs_deck_sched (
      user_id    TEXT     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id    TEXT     NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
      direction  TEXT     NOT NULL DEFAULT 'forward' CHECK (direction IN ('forward','reverse')),
      seed       BIGINT   NOT NULL,
      n          INTEGER  NOT NULL,
      t          BIGINT   NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, deck_id, direction)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS srs_card_sched (
      user_id    TEXT     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id    TEXT     NOT NULL REFERENCES flashcard_deck_cards(id) ON DELETE CASCADE,
      deck_id    TEXT     NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
      direction  TEXT     NOT NULL DEFAULT 'forward' CHECK (direction IN ('forward','reverse')),
      rank       INTEGER  NOT NULL,
      x          INTEGER  NOT NULL,
      next_due   BIGINT   NOT NULL,
      PRIMARY KEY (user_id, card_id, direction)
    );
  `);
  try {
    await pool.query("CREATE INDEX IF NOT EXISTS idx_srs_card_sched_deck ON srs_card_sched (user_id, deck_id, direction)");
  } catch (err: any) { console.warn('[initDb] idx_srs_card_sched_deck skipped:', err?.message || err); }

  // Allow anonymous users (no email)
  await pool.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`);

  // Migration: for each user in user_state with no workspaces, create "Workspace 1"
  const { rows: toMigrate } = await pool.query(`
    SELECT us.user_id, us.state FROM user_state us
    WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.user_id = us.user_id)
  `);
  for (const row of toMigrate) {
    const wsId = crypto.randomUUID();
    await pool.query('INSERT INTO workspaces (id, user_id, name, position) VALUES ($1,$2,$3,0)', [wsId, row.user_id, 'Workspace 1']);
    await pool.query('INSERT INTO workspace_state (workspace_id, state) VALUES ($1,$2)', [wsId, row.state]);
    await pool.query('UPDATE users SET active_workspace_id=$1 WHERE id=$2', [wsId, row.user_id]);
  }
}

// Read all app settings as key-value object (cached with 30s TTL)
let settingsCache: { data: Record<string, string>; expiresAt: number } | null = null;
function invalidateSettingsCache() { settingsCache = null; }
async function getAppSettings(): Promise<Record<string, string>> {
  if (settingsCache && Date.now() < settingsCache.expiresAt) return settingsCache.data;
  const { rows } = await pool.query('SELECT key, value FROM app_settings');
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  settingsCache = { data: settings, expiresAt: Date.now() + 30_000 };
  return settings;
}

// Activity logging helper. The cost-evaluation feature widened this from a
// detail-only logger to one that captures provider/model/language/duration so
// /api/admin/cost-log can reconstruct a bill. Most non-LLM call sites pass
// just { detail } or no opts at all — same shape as before, options object.
interface ActivityLogOpts {
  detail?: string;
  inputUnits?: number;    // tokens for LLM, characters for TTS
  outputUnits?: number;   // completion tokens; undefined for TTS
  device?: string;        // 'mobile' | 'desktop'
  model?: string;         // e.g. 'gemini-2.5-flash-lite', 'gpt-5-nano', voice id for TTS
  provider?: string;      // 'gemini' | 'deepseek' | 'openai' | 'google-tts' | 'azure-tts' | 'yandex-tts'
  language?: string;      // iso language code from the request
  durationMs?: number;    // wall-clock latency of the upstream call
}

async function logActivity(userId: string, action: string, opts: ActivityLogOpts = {}) {
  try {
    await pool.query(
      `INSERT INTO activity_log
        (user_id, action, detail, input_units, output_units, device, model, provider, language, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId, action,
        opts.detail || null,
        opts.inputUnits ?? null,
        opts.outputUnits ?? null,
        opts.device || null,
        opts.model || null,
        opts.provider || null,
        opts.language || null,
        opts.durationMs ?? null,
      ]
    );
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

// Helper: detect device type from User-Agent header
function detectDevice(req: express.Request): 'mobile' | 'desktop' {
  const ua = req.headers['user-agent'] || '';
  return /Mobile|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop';
}

// Helper: check if a user is exempt from quota limits (trial period, limits disabled)
function isExemptFromLimits(userRole: string, createdAt: string | null, settings: Record<string, string>): boolean {
  const prefix = userRole === 'anonymous' ? 'anon' : 'free';
  const enabledKey = `${prefix}_limits_enabled`;
  if (settings[enabledKey] === 'false') return true;
  const trialDays = parseInt(settings.free_trial_days || '0', 10);
  if (trialDays > 0 && createdAt) {
    const trialEnd = new Date(createdAt).getTime() + trialDays * 86400_000;
    if (Date.now() < trialEnd) return true;
  }
  return false;
}

// Helper: get Azure TTS credentials from env or app settings
function getAzureCredentials(settings: Record<string, string>): { key: string; region: string } {
  return {
    key: process.env.AZURE_TTS_KEY || settings.azure_tts_key || '',
    region: process.env.AZURE_TTS_REGION || settings.azure_tts_region || 'westeurope',
  };
}

// Helper: verify workspace belongs to user, returns workspace row or null
async function authorizeWorkspace(userId: string, workspaceId: string): Promise<{ id: string; name: string } | null> {
  const { rows } = await pool.query('SELECT id, name FROM workspaces WHERE id=$1 AND user_id=$2', [workspaceId, userId]);
  return rows.length ? rows[0] : null;
}

// Increment daily usage counter after a successful request
async function incrementUsage(userId: string, action: 'explain' | 'tts' | 'generate') {
  const col = action === 'explain' ? 'explain_count' : action === 'tts' ? 'tts_count' : 'generate_count';
  await pool.query(
    `INSERT INTO daily_usage (user_id, usage_date, ${col})
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, usage_date)
     DO UPDATE SET ${col} = daily_usage.${col} + 1`,
    [userId]
  );
}

// Quota middleware factory — checks daily usage for free-tier users
function checkQuota(action: 'explain' | 'tts' | 'generate') {
  return async (req: express.Request & { userId?: string }, res: express.Response, next: express.NextFunction) => {
    // Skip if Stripe not configured (dev mode = unlimited)
    if (!stripe) return next();
    const userId = req.userId;
    if (!userId) return next();

    // Check if user is paid
    const { rows: userRows } = await pool.query('SELECT subscription_status, role, created_at FROM users WHERE id=$1', [userId]);
    const user = userRows[0];
    if (!user) return next();
    const status = user.subscription_status || 'free';
    if (status === 'active' || status === 'trialing' || status === 'past_due') return next();

    // Determine limit key prefix based on user role
    const isAnonymous = user.role === 'anonymous';
    const prefix = isAnonymous ? 'anon' : 'free';

    const settings = await getAppSettings();

    // Skip if limits are disabled or user is in trial
    if (isExemptFromLimits(user.role, user.created_at, settings)) return next();

    const col = action === 'explain' ? 'explain_count' : action === 'tts' ? 'tts_count' : 'generate_count';
    const { rows: usageRows } = await pool.query(
      `SELECT ${col} FROM daily_usage WHERE user_id=$1 AND usage_date=CURRENT_DATE`,
      [userId]
    );
    const used = usageRows[0]?.[col] || 0;

    const limitKey = action === 'explain' ? `${prefix}_daily_explains` : action === 'tts' ? `${prefix}_daily_tts` : `${prefix}_daily_generates`;
    const limit = parseInt(settings[limitKey] || '5', 10);

    if (used >= limit) {
      return res.status(429).json({ error: 'quota_exceeded', limit, used, isAnonymous });
    }
    next();
  };
}

// Auth middleware: reads X-Session-Id header, attaches userId to request
async function requireAuth(req: express.Request & { userId?: string }, res: express.Response, next: express.NextFunction) {
  // Accept session ID from header or query param (sendBeacon can't set headers)
  const sessionId = (req.headers['x-session-id'] as string | undefined) || (req.query.sid as string | undefined);
  if (!sessionId) return res.status(401).json({ error: 'No session' });
  const { rows } = await pool.query(
    'SELECT user_id FROM sessions WHERE session_id=$1 AND expires_at > NOW()',
    [sessionId]
  );
  if (!rows.length) return res.status(401).json({ error: 'Invalid or expired session' });
  req.userId = rows[0].user_id;
  next();
}

// API key auth middleware: reads X-API-Key header, validates against api_keys table
async function requireApiKey(req: express.Request & { apiKeyId?: string }, res: express.Response, next: express.NextFunction) {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey) return res.status(401).json({ error: 'Missing API key' });
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const { rows } = await pool.query('SELECT id FROM api_keys WHERE key_hash=$1', [keyHash]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid API key' });
  req.apiKeyId = rows[0].id;
  next();
}

// Helper: convert anonymous user data to a Google user
// Merge two user rows into one. The Google-rooted user (survivor) wins by
// design: all workspaces, sessions, legacy user_state and active workspace
// move onto it; the merged-away user's telegram_id is grafted on so future
// Telegram sign-ins resolve to the Google user. daily_usage and activity_log
// auto-cascade when we delete the merged-away row (their FKs are ON DELETE
// CASCADE). Caller is responsible for any post-merge identity refresh on
// `surviving` (email/name/picture/google_sub).
async function mergeIntoGoogle(mergedAwayUserId: string, survivingUserId: string): Promise<void> {
  if (mergedAwayUserId === survivingUserId) return;
  // Workspaces — workspaces.id is independent, no PK conflict.
  await pool.query('UPDATE workspaces SET user_id=$1 WHERE user_id=$2', [survivingUserId, mergedAwayUserId]);
  // Sessions — session_id is the PK, user_id is just an FK. UPDATE moves them
  // intact so the user's currently-open Mini App / browser stays signed in.
  await pool.query('UPDATE sessions SET user_id=$1 WHERE user_id=$2', [survivingUserId, mergedAwayUserId]);
  // Legacy user_state blob: PK is user_id. Drop the survivor's row (if any),
  // then move the merged-away user's row over.
  await pool.query('DELETE FROM user_state WHERE user_id=$1', [survivingUserId]);
  await pool.query('UPDATE user_state SET user_id=$1 WHERE user_id=$2', [survivingUserId, mergedAwayUserId]);
  // Transfer identity bits the survivor doesn't already have.
  await pool.query(`
    UPDATE users SET
      telegram_id = COALESCE(telegram_id, (SELECT telegram_id FROM users WHERE id=$2)),
      active_workspace_id = COALESCE(active_workspace_id, (SELECT active_workspace_id FROM users WHERE id=$2))
    WHERE id=$1
  `, [survivingUserId, mergedAwayUserId]);
  // shared_lessons.creator_user_id references users(id) with no CASCADE — move
  // any rows over to the surviving user before deleting the merged-away one.
  await pool.query('UPDATE shared_lessons SET creator_user_id=$1 WHERE creator_user_id=$2', [survivingUserId, mergedAwayUserId]);
  // Drop the merged-away user — daily_usage + activity_log cascade.
  await pool.query('DELETE FROM users WHERE id=$1', [mergedAwayUserId]);
}

async function convertAnonymousToGoogle(anonUserId: string, googleId: string): Promise<void> {
  // Read anon user metadata before transfer
  const { rows: anonRows } = await pool.query('SELECT active_workspace_id, source_code FROM users WHERE id=$1', [anonUserId]);
  // Transfer workspaces, usage, activity in parallel
  await Promise.all([
    pool.query('UPDATE workspaces SET user_id=$1 WHERE user_id=$2', [googleId, anonUserId]),
    pool.query('UPDATE daily_usage SET user_id=$1 WHERE user_id=$2', [googleId, anonUserId]),
    pool.query('UPDATE activity_log SET user_id=$1 WHERE user_id=$2', [googleId, anonUserId]),
  ]);
  // Copy active workspace and promo source
  const updates: Promise<any>[] = [];
  if (anonRows[0]?.active_workspace_id) {
    updates.push(pool.query('UPDATE users SET active_workspace_id=$1 WHERE id=$2', [anonRows[0].active_workspace_id, googleId]));
  }
  if (anonRows[0]?.source_code) {
    updates.push(pool.query('UPDATE users SET source_code=$1 WHERE id=$2 AND source_code IS NULL', [anonRows[0].source_code, googleId]));
  }
  if (updates.length) await Promise.all(updates);
  // Delete anonymous sessions + user
  await pool.query('DELETE FROM sessions WHERE user_id=$1', [anonUserId]);
  await pool.query('DELETE FROM users WHERE id=$1', [anonUserId]);
}

// POST /api/auth/google — exchange Google credential for session_id
app.post('/api/auth/google', authLimiter, asyncHandler(async (req, res) => {
  const { credential } = req.body;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload()!;
    const { sub, email, name, picture } = payload;
    const role = process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL ? 'admin' : 'user';

    // Check for anonymous session to convert
    const anonSessionId = req.headers['x-session-id'] as string | undefined;
    let converted = false;
    let anonUserId: string | null = null;
    if (anonSessionId) {
      const { rows: sessRows } = await pool.query(
        'SELECT user_id FROM sessions WHERE session_id=$1 AND expires_at > NOW()', [anonSessionId]
      );
      if (sessRows.length) {
        const { rows: anonUserRows } = await pool.query('SELECT id, role FROM users WHERE id=$1', [sessRows[0].user_id]);
        if (anonUserRows.length && anonUserRows[0].role === 'anonymous') {
          anonUserId = anonUserRows[0].id;
        }
      }
    }

    // Find existing user by linkage:
    //   1) google_sub column (account linked to a non-Google-rooted user, e.g. Telegram)
    //   2) id = sub (legacy Google users whose id was set to the Google sub)
    //   3) none → create a new user with id = sub (legacy shape, keeps existing flow)
    const { rows: linkedRows } = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE google_sub=$1', [sub]
    );
    let userId: string;
    if (linkedRows.length) {
      userId = linkedRows[0].id;
      await pool.query(
        'UPDATE users SET email=$1, name=$2, picture=$3, role=$4 WHERE id=$5',
        [email, name, picture, role, userId]
      );
    } else {
      const { rows: legacyRows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE id=$1', [sub]);
      if (legacyRows.length) {
        userId = sub!;
        // Backfill google_sub so future logins use the canonical lookup path.
        await pool.query(
          'UPDATE users SET email=$1, name=$2, picture=$3, role=$4, google_sub=COALESCE(google_sub, $5) WHERE id=$6',
          [email, name, picture, role, sub, userId]
        );
      } else {
        userId = sub!;
        await pool.query(
          `INSERT INTO users (id, email, name, picture, role, google_sub) VALUES ($1,$2,$3,$4,$5,$1)`,
          [sub, email, name, picture, role]
        );
      }
    }

    if (anonUserId) {
      await convertAnonymousToGoogle(anonUserId, userId);
      converted = true;
    }

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
    await pool.query(
      'INSERT INTO sessions (session_id, user_id, expires_at) VALUES ($1,$2,$3)',
      [sessionId, userId, expiresAt]
    );
    // Tag user with promo source if this is their first login
    const sourceCode = req.body.source_code;
    if (sourceCode && typeof sourceCode === 'string') {
      await pool.query(
        `UPDATE users SET source_code = $1 WHERE id = $2 AND source_code IS NULL`,
        [sourceCode.slice(0, 8), userId]
      );
    }
    logActivity(userId, converted ? 'anonymous_convert' : 'login');
    res.json({ sessionId, user: { name, email, picture, role }, converted });
  } catch (e) {
    res.status(401).json({ error: 'Invalid credential' });
  }
}));

// POST /api/auth/sso — exchange a cross-app SSO token for a tutor session.
// Token is minted by glottos-courses (or any future sibling app) and verified
// here against the shared HMAC secret. Mirrors /api/auth/google's session
// shape including the anonymous-conversion path, so the SSO landing flow is
// indistinguishable from a fresh Google sign-in for everything downstream.
app.post('/api/auth/sso', authLimiter, asyncHandler(async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }
  const payload = verifySsoToken(token);
  if (!payload || payload.aud !== 'tutor') {
    return res.status(401).json({ error: 'Invalid SSO token' });
  }
  const { sub, email, name, picture } = payload;
  const role = process.env.ADMIN_EMAIL && email && email === process.env.ADMIN_EMAIL ? 'admin' : 'user';

  // Optional anonymous-conversion: if the incoming request already had an
  // anonymous session, transfer its workspaces to the resolved user. Same
  // shape as the Google handler so SSO arrivals don't lose trial data.
  const anonSessionId = req.headers['x-session-id'] as string | undefined;
  let anonUserId: string | null = null;
  if (anonSessionId) {
    const { rows: sessRows } = await pool.query(
      'SELECT user_id FROM sessions WHERE session_id=$1 AND expires_at > NOW()', [anonSessionId]
    );
    if (sessRows.length) {
      const { rows: anonUserRows } = await pool.query('SELECT id, role FROM users WHERE id=$1', [sessRows[0].user_id]);
      if (anonUserRows.length && anonUserRows[0].role === 'anonymous') {
        anonUserId = anonUserRows[0].id;
      }
    }
  }

  // User lookup: same precedence as /api/auth/google — google_sub link,
  // then legacy id=sub, then email fallback, then create new.
  const { rows: linkedRows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE google_sub=$1', [sub]);
  let userId: string;
  let converted = false;
  if (linkedRows.length) {
    userId = linkedRows[0].id;
    await pool.query(
      'UPDATE users SET email=COALESCE($1,email), name=COALESCE($2,name), picture=COALESCE($3,picture), role=$4 WHERE id=$5',
      [email ?? null, name ?? null, picture ?? null, role, userId]
    );
  } else {
    const { rows: legacyRows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE id=$1', [sub]);
    if (legacyRows.length) {
      userId = sub;
      await pool.query(
        'UPDATE users SET email=COALESCE($1,email), name=COALESCE($2,name), picture=COALESCE($3,picture), role=$4, google_sub=COALESCE(google_sub, $5) WHERE id=$6',
        [email ?? null, name ?? null, picture ?? null, role, sub, userId]
      );
    } else {
      // Fallback by email — a tutor user who linked Google after registering
      // would have google_sub set; this catches the (rare) case where they
      // registered with email-only on courses but Google on tutor.
      let byEmailId: string | null = null;
      if (email) {
        const { rows: emailRows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [email]);
        if (emailRows.length) byEmailId = emailRows[0].id;
      }
      if (byEmailId) {
        userId = byEmailId;
        await pool.query(
          'UPDATE users SET name=COALESCE($1,name), picture=COALESCE($2,picture), role=$3, google_sub=COALESCE(google_sub, $4) WHERE id=$5',
          [name ?? null, picture ?? null, role, sub, userId]
        );
      } else {
        userId = sub;
        await pool.query(
          `INSERT INTO users (id, email, name, picture, role, google_sub) VALUES ($1,$2,$3,$4,$5,$1)`,
          [sub, email ?? null, name ?? null, picture ?? null, role]
        );
      }
    }
  }

  if (anonUserId && anonUserId !== userId) {
    await convertAnonymousToGoogle(anonUserId, userId);
    converted = true;
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  await pool.query(
    'INSERT INTO sessions (session_id, user_id, expires_at) VALUES ($1,$2,$3)',
    [sessionId, userId, expiresAt]
  );
  logActivity(userId, converted ? 'sso_login_convert' : 'sso_login');
  res.json({ sessionId, user: { name, email, picture, role }, converted });
}));

// POST /api/sso/mint — produce a token a sibling app can exchange for a
// session. Requires a tutor-side session (requireAuth). Returns 400 for
// anonymous users / users with no google_sub AND no email — the caller falls
// back to a plain link in that case.
app.post('/api/sso/mint', authLimiter, requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { rows } = await pool.query<{ google_sub: string | null; email: string | null; name: string | null; picture: string | null; role: string }>(
    'SELECT google_sub, email, name, picture, role FROM users WHERE id=$1', [req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  const { google_sub, email, name, picture, role } = rows[0];
  if (role === 'anonymous' || (!google_sub && !email)) {
    return res.status(400).json({ error: 'SSO not available for this account' });
  }
  // Identity key is google_sub when we have it (same as the courses side),
  // otherwise fall back to email. The consumer is expected to look up first
  // by google_sub, then by email.
  const sub = google_sub || email!;
  const token = signSsoToken({ iss: 'tutor', aud: 'courses', sub, email, name, picture });
  if (!token) return res.status(503).json({ error: 'SSO not configured' });
  res.json({ token });
}));

// POST /api/auth/google/redirect — Google OAuth redirect callback (for iOS Safari)
app.post('/api/auth/google/redirect', authLimiter, asyncHandler(async (req, res) => {
  const { credential } = req.body;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload()!;
    const { sub: id, email, name, picture } = payload;
    const role = process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL ? 'admin' : 'user';
    await pool.query(
      `INSERT INTO users (id, email, name, picture, role) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET email=$2, name=$3, picture=$4, role=$5`,
      [id, email, name, picture, role]
    );
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
    await pool.query(
      'INSERT INTO sessions (session_id, user_id, expires_at) VALUES ($1,$2,$3)',
      [sessionId, id, expiresAt]
    );
    logActivity(id!, 'login');
    const safeSessionId = JSON.stringify(sessionId);
    // The redirect HTML checks for anon_session_id and calls conversion if present
    // Belt-and-suspenders session handoff: we still write localStorage here,
    // but ALSO pass the session id via the URL fragment to /app. iOS Safari
    // with "Prevent Cross-Site Tracking" sometimes loses a localStorage write
    // made between setItem and an immediate window.location navigation; the
    // fragment is the recovery path. /app reads it on boot, writes localStorage
    // there (the destination page lives long enough to flush), and scrubs the
    // fragment from the URL so it doesn't linger in history or bookmarks.
    res.send(`<!DOCTYPE html><html><head><title>Signing in…</title></head><body><script>
var anonSid=localStorage.getItem('session_id');
localStorage.setItem('session_id',${safeSessionId});
var src=localStorage.getItem('promo_source');
var tasks=[];
if(src){localStorage.removeItem('promo_source');
tasks.push(fetch('/api/tag-source',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Id':${safeSessionId}},body:JSON.stringify({source_code:src})}));}
if(anonSid&&anonSid!==${safeSessionId}){
tasks.push(fetch('/api/auth/convert-anonymous',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Id':${safeSessionId}},body:JSON.stringify({anonSessionId:anonSid})}));}
Promise.all(tasks).finally(function(){window.location.href='/app#sid='+encodeURIComponent(${safeSessionId});});
</script></body></html>`);
  } catch (e) {
    res.status(401).send(`<!DOCTYPE html><html><head><title>Login failed</title></head><body>
<p>Authentication failed. <a href="/">Try again</a></p></body></html>`);
  }
}));

// POST /api/auth/anonymous — create anonymous session for users who want to try without registration
app.post('/api/auth/anonymous', authLimiter, asyncHandler(async (req, res) => {
  const userId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, name, role) VALUES ($1, 'Anonymous', 'anonymous')`,
    [userId]
  );
  const settings = await getAppSettings();
  const ttlDays = parseInt(settings.anon_session_ttl_days || '7', 10);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlDays * 86400_000);
  await pool.query(
    'INSERT INTO sessions (session_id, user_id, expires_at) VALUES ($1,$2,$3)',
    [sessionId, userId, expiresAt]
  );
  // Create one workspace
  const wsId = crypto.randomUUID();
  await pool.query('INSERT INTO workspaces (id, user_id, name, position) VALUES ($1,$2,$3,0)', [wsId, userId, 'Workspace 1']);
  await pool.query('UPDATE users SET active_workspace_id=$1 WHERE id=$2', [wsId, userId]);
  // Tag with promo source if provided
  const sourceCode = req.body.source_code;
  if (sourceCode && typeof sourceCode === 'string') {
    await pool.query(`UPDATE users SET source_code = $1 WHERE id = $2`, [sourceCode.slice(0, 8), userId]);
  }
  logActivity(userId, 'anonymous_login');
  res.json({ sessionId, user: { name: 'Anonymous', email: null, picture: null, role: 'anonymous' } });
}));

// POST /api/auth/telegram — verify Telegram WebApp initData and issue a session.
// The frontend calls this once on launch when running inside a Telegram Mini App.
app.post('/api/auth/telegram', authLimiter, asyncHandler(async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return res.status(503).json({ error: 'Telegram auth not configured.' });
  }
  const { initData } = req.body;
  if (!initData || typeof initData !== 'string') {
    return res.status(400).json({ error: 'Missing initData' });
  }
  const tgUser = verifyTelegramInitData(initData, botToken);
  if (!tgUser) {
    return res.status(401).json({ error: 'Invalid initData' });
  }

  const role = 'user';
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim() || 'Telegram user';
  const picture = tgUser.photo_url || null;

  // Find existing Telegram-backed user or create a new one. Identity is keyed
  // by Telegram numeric id; the user.id stays UUID-shaped to keep the column
  // homogeneous with Google/anonymous users.
  const { rows: existing } = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE telegram_id=$1',
    [tgUser.id]
  );
  let userId: string;
  if (existing.length) {
    userId = existing[0].id;
    await pool.query('UPDATE users SET name=$1, picture=$2 WHERE id=$3', [name, picture, userId]);
  } else {
    userId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, telegram_id, name, picture, role, email) VALUES ($1, $2, $3, $4, $5, NULL)`,
      [userId, tgUser.id, name, picture, role]
    );
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  await pool.query(
    'INSERT INTO sessions (session_id, user_id, expires_at) VALUES ($1, $2, $3)',
    [sessionId, userId, expiresAt]
  );

  logActivity(userId, existing.length ? 'telegram_login' : 'telegram_signup');
  res.json({ sessionId, user: { name, email: null, picture, role } });
}));

// POST /api/auth/link-google — attach a Google identity to the currently
// signed-in user. After linking, a Sign-in-with-Google on a fresh device
// resolves to the same account via the users.google_sub column.
app.post('/api/auth/link-google', authLimiter, requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Missing credential' });
  let payload: any;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Invalid credential' });
  }
  const { sub, email, name, picture } = payload || {};
  if (!sub) return res.status(401).json({ error: 'Invalid credential' });

  // If this Google account already owns a different user row, merge: current
  // user's workspaces/sessions/telegram_id all move onto the Google user.
  const { rows: conflict } = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE google_sub=$1 OR id=$1', [sub]
  );
  let targetUserId = req.userId;
  let merged = false;
  if (conflict.length && conflict[0].id !== req.userId) {
    await mergeIntoGoogle(req.userId, conflict[0].id);
    targetUserId = conflict[0].id;
    merged = true;
  }

  const role = process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL ? 'admin' : null;
  if (role) {
    await pool.query(
      'UPDATE users SET google_sub=COALESCE(google_sub, $1), email=$2, name=$3, picture=COALESCE($4, picture), role=$5 WHERE id=$6',
      [sub, email, name, picture, role, targetUserId]
    );
  } else {
    await pool.query(
      'UPDATE users SET google_sub=COALESCE(google_sub, $1), email=$2, name=$3, picture=COALESCE($4, picture) WHERE id=$5',
      [sub, email, name, picture, targetUserId]
    );
  }

  const { rows } = await pool.query<{ name: string | null; email: string | null; picture: string | null; role: string }>(
    'SELECT name, email, picture, role FROM users WHERE id=$1', [targetUserId]
  );
  logActivity(targetUserId, merged ? 'link_google_merge' : 'link_google');
  res.json({ user: rows[0], merged });
}));

// External-browser Google linking, used by clients that can't render the
// Google Identity Services iframe (Telegram WebView blocks it). The client
// opens /api/auth/google/link-start in the user's default browser via
// Telegram.WebApp.openLink(); after consent Google redirects to
// /api/auth/google/link-callback, which links the account and shows a
// "return to Telegram" page.

function getLinkStateSecret(): string | null {
  const base = process.env.GOOGLE_CLIENT_SECRET;
  if (!base) return null;
  return createHash('sha256').update('link-state-v1|' + base).digest('hex');
}

function getLinkRedirectUri(req: express.Request): string {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  if (appUrl) return `${appUrl}/api/auth/google/link-callback`;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  const host = req.get('host');
  return `${proto}://${host}/api/auth/google/link-callback`;
}

function linkResultPage(message: string, success: boolean): string {
  const icon = success ? '✅' : '⚠️';
  const subtitle = success
    ? 'You can close this tab and return to Telegram.'
    : 'Please return to Telegram and try again.';
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>polyGlottos</title><style>
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;background:#0f0f10;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#1c1c1f;border-radius:16px;padding:32px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.4)}
.icon{font-size:48px;margin-bottom:12px;line-height:1}
h1{font-size:18px;font-weight:600;margin:0 0 8px}
p{font-size:14px;color:#a0a0a8;margin:0;line-height:1.5}
</style></head><body><div class="card"><div class="icon">${icon}</div><h1>${esc(message)}</h1><p>${esc(subtitle)}</p></div></body></html>`;
}

// GET /api/auth/google/link-start?sid=<sessionId>
app.get('/api/auth/google/link-start', asyncHandler(async (req, res) => {
  const sid = req.query.sid as string | undefined;
  if (!sid) return res.type('html').send(linkResultPage('Missing session id.', false));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const stateSecret = getLinkStateSecret();
  if (!clientId || !stateSecret) {
    return res.type('html').send(linkResultPage('Google sign-in is not configured on the server.', false));
  }

  const { rows } = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM sessions WHERE session_id=$1 AND expires_at > NOW()', [sid]
  );
  if (!rows.length) {
    return res.type('html').send(linkResultPage('Your session has expired. Re-open the Mini App.', false));
  }

  const state = signLinkState(rows[0].user_id, stateSecret);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getLinkRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}));

// GET /api/auth/google/link-callback?code=...&state=...
app.get('/api/auth/google/link-callback', asyncHandler(async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const errParam = req.query.error as string | undefined;

  if (errParam) {
    return res.type('html').send(linkResultPage(`Sign-in canceled: ${errParam}`, false));
  }
  if (!code || !state) {
    return res.type('html').send(linkResultPage('Missing code or state.', false));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const stateSecret = getLinkStateSecret();
  if (!clientId || !clientSecret || !stateSecret) {
    return res.type('html').send(linkResultPage('Google sign-in is not configured on the server.', false));
  }

  const verified = verifyLinkState(state, stateSecret);
  if (!verified) {
    return res.type('html').send(linkResultPage('Invalid or expired state. Please try linking again.', false));
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getLinkRedirectUri(req),
        grant_type: 'authorization_code',
      }).toString(),
    });
    const tokens = await tokenRes.json() as { id_token?: string; error?: string };
    if (!tokens.id_token) {
      console.error('Google OAuth token exchange failed:', tokens);
      return res.type('html').send(linkResultPage('Google sign-in failed.', false));
    }

    const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      return res.type('html').send(linkResultPage('Invalid Google identity.', false));
    }
    const { sub, email, name, picture } = payload;

    const { rows: conflict } = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE google_sub=$1 OR id=$1', [sub]
    );
    let targetUserId = verified.uid;
    let merged = false;
    if (conflict.length && conflict[0].id !== verified.uid) {
      await mergeIntoGoogle(verified.uid, conflict[0].id);
      targetUserId = conflict[0].id;
      merged = true;
    }

    const role = process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL ? 'admin' : null;
    if (role) {
      await pool.query(
        'UPDATE users SET google_sub=COALESCE(google_sub, $1), email=$2, name=$3, picture=COALESCE($4, picture), role=$5 WHERE id=$6',
        [sub, email, name, picture, role, targetUserId]
      );
    } else {
      await pool.query(
        'UPDATE users SET google_sub=COALESCE(google_sub, $1), email=$2, name=$3, picture=COALESCE($4, picture) WHERE id=$5',
        [sub, email, name, picture, targetUserId]
      );
    }

    logActivity(targetUserId, merged ? 'link_google_redirect_merge' : 'link_google_redirect');
    const message = merged
      ? `Linked ${email} — workspaces merged`
      : `Linked ${email}`;
    res.type('html').send(linkResultPage(message, true));
  } catch (e) {
    console.error('Link callback error:', e);
    const detail = e instanceof Error ? e.message : String(e);
    res.type('html').send(linkResultPage(`An error occurred: ${detail.slice(0, 200)}`, false));
  }
}));

// POST /api/auth/convert-anonymous — transfer anonymous data to Google user (called from redirect flow)
app.post('/api/auth/convert-anonymous', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { anonSessionId } = req.body;
  if (!anonSessionId) return res.json({ ok: false });
  const { rows: sessRows } = await pool.query(
    'SELECT user_id FROM sessions WHERE session_id=$1', [anonSessionId]
  );
  if (!sessRows.length) return res.json({ ok: false });
  const { rows: anonUserRows } = await pool.query('SELECT id, role FROM users WHERE id=$1', [sessRows[0].user_id]);
  if (!anonUserRows.length || anonUserRows[0].role !== 'anonymous') return res.json({ ok: false });
  await convertAnonymousToGoogle(anonUserRows[0].id, req.userId);
  res.json({ ok: true });
}));

// POST /api/tag-source — tag user with promo source (only if not already tagged)
app.post('/api/tag-source', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { source_code } = req.body;
  if (source_code && typeof source_code === 'string') {
    await pool.query(
      `UPDATE users SET source_code = $1 WHERE id = $2 AND source_code IS NULL`,
      [source_code.slice(0, 8), req.userId]
    );
  }
  res.json({ ok: true });
}));

// GET /api/state — load workspaces + active workspace state
app.get('/api/state', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const userRow = await pool.query('SELECT name, email, picture, role, active_workspace_id, preferences, subscription_status, subscription_period_end, cancel_at_period_end, created_at FROM users WHERE id=$1', [req.userId]);
  let activeWsId = userRow.rows[0]?.active_workspace_id;
  const preferences = userRow.rows[0]?.preferences || { interfaceLanguage: 'en', explanationLanguage: 'en' };

  // New user: create first workspace
  if (!activeWsId) {
    activeWsId = crypto.randomUUID();
    await pool.query('INSERT INTO workspaces (id, user_id, name, position) VALUES ($1,$2,$3,0)', [activeWsId, req.userId, 'Workspace 1']);
    await pool.query('UPDATE users SET active_workspace_id=$1 WHERE id=$2', [activeWsId, req.userId]);
  }

  const [wsRows, stateRow, appSettings, deckRows] = await Promise.all([
    pool.query('SELECT id, name, position FROM workspaces WHERE user_id=$1 ORDER BY position', [req.userId]),
    pool.query('SELECT state, updated_at FROM workspace_state WHERE workspace_id=$1', [activeWsId]),
    getAppSettings(),
    pool.query(
      `SELECT d.id, d.name, d.position, COUNT(c.id)::int AS card_count
       FROM flashcard_decks d
       LEFT JOIN flashcard_deck_cards c ON c.deck_id = d.id
       WHERE d.user_id=$1
       GROUP BY d.id, d.name, d.position
       ORDER BY d.position`,
      [req.userId]
    ),
  ]);

  res.json({
    user: userRow.rows[0] || null,
    workspaces: wsRows.rows,
    activeWorkspaceId: activeWsId,
    state: stateRow.rows[0]?.state || {},
    updatedAt: stateRow.rows[0]?.updated_at ? new Date(stateRow.rows[0].updated_at).toISOString() : null,
    preferences,
    appSettings,
    decks: deckRows.rows,
  });
}));

// GET /api/state/:workspaceId/timestamp — lightweight conflict check (no state blob)
app.get('/api/state/:workspaceId/timestamp', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const ws = await authorizeWorkspace(req.userId, req.params.workspaceId);
  if (!ws) return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query('SELECT updated_at FROM workspace_state WHERE workspace_id=$1', [req.params.workspaceId]);
  res.json({ updatedAt: rows[0]?.updated_at ? new Date(rows[0].updated_at).toISOString() : null });
}));

// GET /api/state/:workspaceId — load a specific workspace (used on tab switch)
app.get('/api/state/:workspaceId', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const ws = await authorizeWorkspace(req.userId, req.params.workspaceId);
  if (!ws) return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query('SELECT state, updated_at FROM workspace_state WHERE workspace_id=$1', [req.params.workspaceId]);
  res.json({ state: rows[0]?.state || {}, updatedAt: rows[0]?.updated_at ? new Date(rows[0].updated_at).toISOString() : null });
}));

// PUT or POST /api/state — save workspace state (POST used by sendBeacon on iOS)
const saveStateHandler = asyncHandler(async (req: any, res: express.Response) => {
  const { workspaceId, state, lastSavedAt, force } = req.body;
  // Validate workspace belongs to user + get current timestamp in one query
  const { rows } = await pool.query(
    `SELECT w.id, ws.updated_at FROM workspaces w
     LEFT JOIN workspace_state ws ON ws.workspace_id = w.id
     WHERE w.id=$1 AND w.user_id=$2`,
    [workspaceId, req.userId]
  );
  if (!rows.length) return res.status(403).json({ error: 'Forbidden' });

  // Conflict detection: if client sends lastSavedAt, check if another device saved since then
  if (lastSavedAt && !force && rows[0].updated_at) {
    const serverTs = new Date(rows[0].updated_at).toISOString();
    if (serverTs > lastSavedAt) {
      return res.status(409).json({ conflict: true, updatedAt: serverTs });
    }
  }

  const { rows: upserted } = await pool.query(
    `INSERT INTO workspace_state (workspace_id, state, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (workspace_id) DO UPDATE SET state=$2, updated_at=NOW()
     RETURNING updated_at`,
    [workspaceId, JSON.stringify(state)]
  );
  const updatedAt = upserted[0]?.updated_at ? new Date(upserted[0].updated_at).toISOString() : null;
  res.json({ ok: true, updatedAt });
});
app.put('/api/state', requireAuth as express.RequestHandler, saveStateHandler);
app.post('/api/state', requireAuth as express.RequestHandler, saveStateHandler);

// POST /api/workspaces — create workspace
app.post('/api/workspaces', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  // Enforce workspace limit for anonymous users
  const { rows: roleRows } = await pool.query('SELECT role FROM users WHERE id=$1', [req.userId]);
  if (roleRows[0]?.role === 'anonymous') {
    const wsSettings = await getAppSettings();
    if (wsSettings.anon_limits_enabled !== 'false') {
      const maxWs = parseInt(wsSettings.anon_max_workspaces || '1', 10);
      const { rows: wsCount } = await pool.query('SELECT COUNT(*)::int AS cnt FROM workspaces WHERE user_id=$1', [req.userId]);
      if (wsCount[0].cnt >= maxWs) return res.status(403).json({ error: 'Workspace limit reached', limit: maxWs });
    }
  }
  const { name } = req.body;
  const { rows: posRows } = await pool.query('SELECT COALESCE(MAX(position)+1,0) AS pos FROM workspaces WHERE user_id=$1', [req.userId]);
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO workspaces (id, user_id, name, position) VALUES ($1,$2,$3,$4)', [id, req.userId, name || 'Workspace', posRows[0].pos]);
  logActivity(req.userId, 'workspace_create', { detail: name || 'Workspace' });
  res.json({ id, name: name || 'Workspace', position: posRows[0].pos });
}));

// PATCH /api/workspaces/:id — rename workspace
app.patch('/api/workspaces/:id', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { name } = req.body;
  await pool.query('UPDATE workspaces SET name=$1 WHERE id=$2 AND user_id=$3', [name, req.params.id, req.userId]);
  logActivity(req.userId, 'workspace_rename', { detail: name });
  res.json({ ok: true });
}));

// DELETE /api/workspaces/:id — delete workspace (refuses if last)
app.delete('/api/workspaces/:id', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { rows: all } = await pool.query('SELECT id, position FROM workspaces WHERE user_id=$1 ORDER BY position', [req.userId]);
  if (all.length <= 1) return res.status(409).json({ error: 'Cannot delete last workspace' });
  await pool.query('DELETE FROM workspaces WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  logActivity(req.userId, 'workspace_delete');
  const remaining = all.filter((w: any) => w.id !== req.params.id);
  const newActive = remaining[0].id;
  await pool.query('UPDATE users SET active_workspace_id=$1 WHERE id=$2 AND active_workspace_id=$3', [newActive, req.userId, req.params.id]);
  res.json({ newActiveWorkspaceId: newActive });
}));

// PATCH /api/users/active-workspace — update active workspace on tab switch
app.patch('/api/users/active-workspace', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { workspaceId } = req.body;
  await pool.query('UPDATE users SET active_workspace_id=$1 WHERE id=$2', [workspaceId, req.userId]);
  logActivity(req.userId, 'workspace_switch');
  res.json({ ok: true });
}));

// PUT /api/preferences — save user preferences
app.put('/api/preferences', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const prefs: Record<string, any> = {
    interfaceLanguage: req.body.interfaceLanguage || 'en',
    explanationLanguage: req.body.explanationLanguage || 'en',
    defaultTextLanguage: req.body.defaultTextLanguage || 'de',
    theme: req.body.theme === 'dark' ? 'dark' : 'light',
    setupCompleted: !!req.body.setupCompleted,
  };
  if (req.body.activeDeckId === null) prefs.activeDeckId = null;
  else if (typeof req.body.activeDeckId === 'string') prefs.activeDeckId = req.body.activeDeckId;
  await pool.query(
    'UPDATE users SET preferences=$1 WHERE id=$2',
    [JSON.stringify(prefs), req.userId]
  );
  logActivity(req.userId, 'preferences_change', { detail: JSON.stringify(prefs) });
  res.json({ ok: true });
}));

// --- Flashcard decks ---
// Verify deck belongs to userId. Returns deck row or null.
async function authorizeDeck(userId: string, deckId: string) {
  const { rows } = await pool.query('SELECT id, user_id FROM flashcard_decks WHERE id=$1', [deckId]);
  if (!rows.length || rows[0].user_id !== userId) return null;
  return rows[0];
}

// GET /api/decks — list user's decks with card counts
app.get('/api/decks', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.position, COUNT(c.id)::int AS card_count
     FROM flashcard_decks d
     LEFT JOIN flashcard_deck_cards c ON c.deck_id = d.id
     WHERE d.user_id=$1
     GROUP BY d.id, d.name, d.position
     ORDER BY d.position`,
    [req.userId]
  );
  res.json(rows);
}));

// POST /api/decks — create new deck
app.post('/api/decks', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const name = (typeof req.body.name === 'string' && req.body.name.trim()) || 'Deck';
  const { rows: posRows } = await pool.query(
    'SELECT COALESCE(MAX(position)+1,0) AS pos FROM flashcard_decks WHERE user_id=$1',
    [req.userId]
  );
  const id = crypto.randomUUID();
  try {
    await pool.query(
      'INSERT INTO flashcard_decks (id, user_id, name, position) VALUES ($1,$2,$3,$4)',
      [id, req.userId, name, posRows[0].pos]
    );
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: 'duplicate_name' });
    throw err;
  }
  res.json({ id, name, position: posRows[0].pos, card_count: 0 });
}));

// PATCH /api/decks/:id — rename deck
app.patch('/api/decks/:id', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const deck = await authorizeDeck(req.userId, req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  const name = (typeof req.body.name === 'string' && req.body.name.trim()) || 'Deck';
  try {
    await pool.query('UPDATE flashcard_decks SET name=$1, updated_at=NOW() WHERE id=$2', [name, req.params.id]);
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: 'duplicate_name' });
    throw err;
  }
  res.json({ ok: true });
}));

// DELETE /api/decks/:id — delete deck (cascades to cards)
app.delete('/api/decks/:id', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const deck = await authorizeDeck(req.userId, req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  await pool.query('DELETE FROM flashcard_decks WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// GET /api/decks/:id/cards — list cards in deck
app.get('/api/decks/:id/cards', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const deck = await authorizeDeck(req.userId, req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT id, source_text, text_language, explanation, explanation_language, position
     FROM flashcard_deck_cards WHERE deck_id=$1 ORDER BY position, created_at`,
    [req.params.id]
  );
  res.json(rows);
}));

// POST /api/decks/:id/cards — add card (upsert on (deck_id, source_text))
app.post('/api/decks/:id/cards', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const deck = await authorizeDeck(req.userId, req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  const { source_text, text_language, explanation, explanation_language } = req.body;
  if (typeof source_text !== 'string' || !source_text.trim()) return res.status(400).json({ error: 'source_text required' });
  if (typeof text_language !== 'string' || !text_language.trim()) return res.status(400).json({ error: 'text_language required' });
  if (!explanation || typeof explanation !== 'object') return res.status(400).json({ error: 'explanation required' });
  // Optional — older clients may not send it, in which case the back's language
  // is inferred at read time from the user's current preference (with the
  // known stale-language caveat that motivated this column).
  const explanationLanguage = typeof explanation_language === 'string' && explanation_language.trim()
    ? explanation_language.trim() : null;
  const id = crypto.randomUUID();
  const { rows: posRows } = await pool.query(
    'SELECT COALESCE(MAX(position)+1,0) AS pos FROM flashcard_deck_cards WHERE deck_id=$1',
    [req.params.id]
  );
  const { rows } = await pool.query(
    `INSERT INTO flashcard_deck_cards (id, deck_id, source_text, text_language, explanation, explanation_language, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (deck_id, source_text) DO UPDATE SET
        explanation = EXCLUDED.explanation,
        text_language = EXCLUDED.text_language,
        explanation_language = EXCLUDED.explanation_language
     RETURNING id`,
    [id, req.params.id, source_text, text_language, JSON.stringify(explanation), explanationLanguage, posRows[0].pos]
  );
  res.json({ id: rows[0].id });
}));

// DELETE /api/decks/:id/cards/:cardId — delete card
app.delete('/api/decks/:id/cards/:cardId', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const deck = await authorizeDeck(req.userId, req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  const { rowCount } = await pool.query(
    'DELETE FROM flashcard_deck_cards WHERE id=$1 AND deck_id=$2',
    [req.params.cardId, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Card not found' });
  res.json({ ok: true });
}));

// GET /api/decks/:id/srs — interval-doubling scheduler state for this user ×
// deck. One row per (card, direction) that has entered the scheduler; cards
// without a row are implicitly "new" in that direction and the UI infers that.
app.get('/api/decks/:id/srs', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const deck = await authorizeDeck(req.userId, req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT card_id, direction, rank, x, next_due
       FROM srs_card_sched
      WHERE user_id=$1 AND deck_id=$2`,
    [req.userId, req.params.id]
  );
  // Normalise BIGINT (pg returns it as a string) for the JSON payload.
  res.json(rows.map((r: any) => ({
    card_id: r.card_id, direction: r.direction, rank: r.rank, x: r.x, next_due: Number(r.next_due),
  })));
}));

// --- SRS: interval-doubling practice -----------------------------------------------------
// Streaming model: each request selects the single next card (argmin of
// next_due + phase) against the persisted per-(user, deck, direction) virtual
// clock. Grading records the answer and returns the next card. The scheduler
// core lives in src/lib/intervalScheduler (pure); persistence stays here.

const srsDirection = (v: unknown): 'forward' | 'reverse' => (v === 'reverse' ? 'reverse' : 'forward');

// Live card ids for a deck, in a stable order (used to seed/reconcile).
async function srsDeckCardIds(deckId: string): Promise<string[]> {
  const { rows } = await pool.query(
    'SELECT id FROM flashcard_deck_cards WHERE deck_id=$1 ORDER BY position, id',
    [deckId]
  );
  return rows.map((r: any) => r.id as string);
}

// Hydrate the persisted scheduler rows into a DeckSched, or null if the deck
// hasn't been initialised for this direction yet.
async function srsLoadDeck(userId: string, deckId: string, direction: string): Promise<DeckSched | null> {
  const deckRes = await pool.query(
    'SELECT n, t FROM srs_deck_sched WHERE user_id=$1 AND deck_id=$2 AND direction=$3',
    [userId, deckId, direction]
  );
  if (!deckRes.rows.length) return null;
  const cardRes = await pool.query(
    'SELECT card_id, rank, x, next_due FROM srs_card_sched WHERE user_id=$1 AND deck_id=$2 AND direction=$3',
    [userId, deckId, direction]
  );
  const cards: DeckSched['cards'] = {};
  for (const r of cardRes.rows) {
    cards[r.card_id] = { x: r.x, nextDue: Number(r.next_due), rank: r.rank };
  }
  return { n: Number(deckRes.rows[0].n), t: Number(deckRes.rows[0].t), cfg: SRS_CONFIG, cards };
}

async function srsUpsertCard(userId: string, deckId: string, direction: string, cardId: string, c: { rank: number; x: number; nextDue: number }) {
  await pool.query(
    `INSERT INTO srs_card_sched (user_id, card_id, deck_id, direction, rank, x, next_due)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, card_id, direction) DO UPDATE SET
        rank = EXCLUDED.rank, x = EXCLUDED.x, next_due = EXCLUDED.next_due`,
    [userId, cardId, deckId, direction, c.rank, c.x, c.nextDue]
  );
}

async function srsUpdateClock(userId: string, deckId: string, direction: string, n: number, t: number) {
  await pool.query(
    'UPDATE srs_deck_sched SET n=$4, t=$5 WHERE user_id=$1 AND deck_id=$2 AND direction=$3',
    [userId, deckId, direction, n, t]
  );
}

// Load the scheduler for a deck+direction, creating it (clean re-init: fresh
// shuffle, x=X0) on first use and reconciling it against the live card set
// (adding rows for newly-added cards; card deletes cascade away on their own).
// Returns the up-to-date DeckSched, or null if the deck has no cards.
async function srsEnsureDeck(userId: string, deckId: string, direction: string): Promise<DeckSched | null> {
  const cardIds = await srsDeckCardIds(deckId);
  if (cardIds.length === 0) return null;

  let deck = await srsLoadDeck(userId, deckId, direction);
  if (!deck) {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    deck = srsInitDeck(cardIds, seed, SRS_CONFIG);
    await pool.query(
      'INSERT INTO srs_deck_sched (user_id, deck_id, direction, seed, n, t) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, deckId, direction, seed, deck.n, deck.t]
    );
    for (const id of cardIds) await srsUpsertCard(userId, deckId, direction, id, deck.cards[id]);
    return deck;
  }

  // Reconcile: persist any cards that are new since the deck was initialised.
  const known = new Set(Object.keys(deck.cards));
  deck = srsReconcile(deck, cardIds);
  for (const id of cardIds) {
    if (!known.has(id)) await srsUpsertCard(userId, deckId, direction, id, deck.cards[id]);
  }
  return deck;
}

function srsCardPayload(deck: DeckSched, cardId: string | null) {
  if (cardId === null) return null;
  const c = deck.cards[cardId];
  return { cardId, x: c.x, mastery: c.x / srsXMax(deck) };
}

// POST /api/decks/:deckId/practice/next — select the next card to show.
app.post('/api/decks/:deckId/practice/next', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const deck = await authorizeDeck(req.userId, req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  const direction = srsDirection(req.body?.direction);

  const sched = await srsEnsureDeck(req.userId, req.params.deckId, direction);
  if (!sched) return res.json({ card: null, direction, deckSize: 0 });

  const sel = srsSelectNext(sched);
  // selectNext advances the virtual clock to the chosen card's next_due.
  await srsUpdateClock(req.userId, req.params.deckId, direction, sel.deck.n, sel.deck.t);

  res.json({ card: srsCardPayload(sel.deck, sel.cardId), direction, deckSize: sel.deck.n });
}));

// POST /api/decks/:deckId/cards/:cardId/grade — record an answer, return next.
app.post('/api/decks/:deckId/cards/:cardId/grade', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const deck = await authorizeDeck(req.userId, req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Not found' });

  // Verify the card belongs to the deck (so a stolen cardId from another deck can't poison state).
  const cardCheck = await pool.query(
    'SELECT 1 FROM flashcard_deck_cards WHERE id=$1 AND deck_id=$2',
    [req.params.cardId, req.params.deckId]
  );
  if (!cardCheck.rows.length) return res.status(404).json({ error: 'Card not found in deck' });

  if (typeof req.body?.remembered !== 'boolean') {
    return res.status(400).json({ error: 'remembered (boolean) required' });
  }
  const known = req.body.remembered as boolean;
  const direction = srsDirection(req.body?.direction);

  // Scheduler must exist (the client calls /practice/next first); ensure as a
  // defensive fallback so a stray grade can't 500.
  let sched = await srsEnsureDeck(req.userId, req.params.deckId, direction);
  if (!sched || !sched.cards[req.params.cardId]) {
    return res.status(404).json({ error: 'Card not scheduled' });
  }

  // Record at the current clock: known doubles x (capped at X_MAX), don't-know
  // resets to X_BASE; the card's next appearance is scheduled at t + x.
  sched = srsRecord(sched, req.params.cardId, known);
  const recorded = sched.cards[req.params.cardId];
  await srsUpsertCard(req.userId, req.params.deckId, direction, req.params.cardId, recorded);

  // Pick the next card (never the one just answered) and persist the clock.
  const sel = srsSelectNext(sched, req.params.cardId);
  await srsUpdateClock(req.userId, req.params.deckId, direction, sel.deck.n, sel.deck.t);

  logActivity(req.userId, 'srs_grade', { detail: `${direction[0]}${known ? 'r' : 'f'}:${req.params.cardId}` });

  res.json({
    recorded: { cardId: req.params.cardId, x: recorded.x },
    next: srsCardPayload(sel.deck, sel.cardId),
    direction,
  });
}));

// Gemini call with automatic fallback on 503 (model overloaded)
async function geminiWithFallback(
  contents: string,
  model: string,
  fallbackModel: string,
  config?: Record<string, any>
): Promise<{ text: string; model: string; usage?: any }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContent({ model, contents, config });
    return { text: response.text || '', model, usage: (response as any).usageMetadata };
  } catch (err: any) {
    const is503 = err?.status === 503 || err?.message?.includes('503') || err?.message?.includes('UNAVAILABLE') || err?.message?.includes('high demand');
    if (is503 && fallbackModel && fallbackModel !== model) {
      console.warn(`[llm] Model ${model} returned 503, falling back to ${fallbackModel}`);
      const response = await ai.models.generateContent({ model: fallbackModel, contents, config });
      return { text: response.text || '', model: fallbackModel, usage: (response as any).usageMetadata };
    }
    throw err;
  }
}

// Load Russian stress prompt at startup
let RUSSIAN_SSML_PROMPT = '';
try {
  RUSSIAN_SSML_PROMPT = readFileSync(
    new URL('./prompts/russian-ssml.txt', import.meta.url), 'utf-8'
  );
  console.log(`[startup] Russian SSML prompt loaded: ${RUSSIAN_SSML_PROMPT.length} chars`);
} catch (err) {
  console.error('[startup] Failed to load Russian SSML prompt:', err);
}

// Russian homograph stress resolver — adds U+0301 combining accent marks to disambiguate homographs
interface RussianStressResult {
  text: string | null;
  modelUsed?: string;
  promptTokens?: number;
  candidatesTokens?: number;
  durationMs?: number;
}

async function resolveRussianStress(text: string, model?: string, fallback?: string): Promise<RussianStressResult> {
  if (!RUSSIAN_SSML_PROMPT) {
    console.warn('[russian-stress] Prompt not loaded, skipping');
    return { text: null };
  }
  const startedAt = Date.now();
  try {
    const stressModel = model || 'gemini-2.5-flash';
    const stressFallback = fallback || 'gemini-2.5-flash-lite';
    const response = await geminiWithFallback(
      RUSSIAN_SSML_PROMPT + text, stressModel, stressFallback, { temperature: 0 }
    );
    const raw = (response.text || '').trim();
    // The response contains a scratchpad followed by the final text
    // Extract the last paragraph (after the scratchpad analysis)
    const lines = raw.split('\n').filter(l => l.trim());
    // Find the final output — it's the text with U+0301 marks, no pipes, no headers
    let result: string | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      // Skip scratchpad lines (contain | separators), headers (STEP, ##), empty
      if (line.includes('|') || line.startsWith('#') || line.startsWith('STEP') || line.startsWith('---')) continue;
      // This should be the processed text
      result = line;
      break;
    }
    const metrics = {
      modelUsed: response.model,
      promptTokens: response.usage?.promptTokenCount,
      candidatesTokens: response.usage?.candidatesTokenCount,
      durationMs: Date.now() - startedAt,
    };
    if (result && result.length > 0) {
      return { text: result, ...metrics };
    }
    console.warn('[russian-stress] Could not extract result from LLM response:', raw.substring(0, 300));
    return { text: null, ...metrics };
  } catch (err) {
    console.error('[russian-stress] Failed to resolve homographs:', err);
    return { text: null };
  }
}

// Exercise each catalog voice with a 1-char synth call. Voices that fail are
// dropped from verifiedVoiceCatalog so GET /api/tts/voices never serves a
// known-broken id. Runs in parallel across languages; sequentially within a
// language to avoid hammering one quota at once. Best-effort: any crash here
// degrades to "no voice button shown" rather than blocking the server.
async function verifyTtsVoiceCatalog(): Promise<void> {
  if (!ttsClient) {
    console.warn('[tts-voices] Google TTS client not initialised — skipping catalog verification');
    return;
  }
  const settings = await getAppSettings().catch(() => ({} as Record<string, string>));
  const { key: azureKey, region: azureRegion } = getAzureCredentials(settings);
  const startedAt = Date.now();

  await Promise.all(Object.entries(TTS_VOICE_CATALOG).map(async ([lang, voices]) => {
    const langCfg = LANGUAGES[lang];
    if (!langCfg) return;
    const verified: TtsVoiceEntry[] = [];
    for (const v of voices) {
      try {
        if (v.provider === 'azure') {
          if (!azureKey) continue;
          await azureTts('a', v.id, langCfg.ttsLang, azureKey, azureRegion);
        } else {
          await ttsClient!.synthesizeSpeech({
            input: { text: 'a' },
            voice: { languageCode: langCfg.ttsLang, name: v.id },
            audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 },
          } as any);
        }
        verified.push(v);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[tts-voices] ${lang}/${v.id} dropped: ${msg.split('\n')[0]}`);
      }
    }
    if (verified.length > 0) verifiedVoiceCatalog[lang] = verified;
  }));

  const summary = Object.entries(verifiedVoiceCatalog)
    .map(([l, v]) => `${l}:${v.length}`)
    .join(' ');
  console.log(`[tts-voices] Catalog ready in ${Date.now() - startedAt}ms — ${summary}`);
}

// GET /api/tts/voices?lang=de — list verified character voices for the
// requested language. Returns [] when the language isn't in the catalog or
// when verification hasn't completed yet (frontend hides the button).
app.get('/api/tts/voices', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const lang = typeof req.query.lang === 'string' ? req.query.lang : '';
  const voices = verifiedVoiceCatalog[lang] || [];
  res.json({ voices: voices.map(v => ({ id: v.id, name: v.name, gender: v.gender })) });
}));

// POST /api/tts — synthesize text to speech
app.post('/api/tts', ttsLimiter, requireAuth as express.RequestHandler, checkQuota('tts') as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const settings = await getAppSettings();
  const ttsProvider = settings.tts_provider || 'google';
  const device = detectDevice(req);

  const { text, textLanguage, speed: rawSpeed, voice: requestedVoice } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid text parameter' });
  }
  const speed = typeof rawSpeed === 'number' && rawSpeed > 0 && rawSpeed <= 3 ? rawSpeed : 1.0;

  // Optional per-request voice override. Validated against the verified
  // catalog — unknown ids fall back to resolveTtsVoice's default so a stale
  // user pref or a manually-typed id can't synthesize against an arbitrary
  // voice. Provider derives from the catalog entry.
  let voiceOverride: TtsVoiceEntry | null = null;
  if (typeof requestedVoice === 'string' && requestedVoice) {
    const catalog = verifiedVoiceCatalog[textLanguage] || [];
    voiceOverride = catalog.find(v => v.id === requestedVoice) || null;
  }

  // For Russian text, resolve homograph stress with U+0301 marks. The stress
  // pass is its own LLM call; log it as a separate cost-log row.
  let ttsInput = text;
  if (textLanguage === 'ru') {
    const stressed = await resolveRussianStress(text, settings.russian_stress_model, settings.llm_fallback_model);
    if (stressed.text) ttsInput = stressed.text;
    if (stressed.modelUsed) {
      logActivity(req.userId, 'russian_stress', {
        inputUnits: stressed.promptTokens, outputUnits: stressed.candidatesTokens, device,
        model: stressed.modelUsed, provider: 'gemini', language: 'ru', durationMs: stressed.durationMs,
      });
    }
  }

  const ttsStartedAt = Date.now();
  try {
    if (ttsProvider === 'yandex') {
      // Yandex SpeechKit TTS
      const yandexApiKey = settings.yandex_tts_api_key || process.env.YANDEX_TTS_API_KEY || '';
      if (!yandexApiKey) {
        return res.status(400).json({ error: 'Yandex TTS API key not configured. Set it in Admin > LLM Settings or as YANDEX_TTS_API_KEY env variable.' });
      }

      const yVoice = YANDEX_VOICES[textLanguage] || YANDEX_VOICES['de'];

      const params = new URLSearchParams({
        text,
        lang: yVoice.lang,
        voice: yVoice.voice,
        format: 'lpcm',
        sampleRateHertz: '24000',
        speed: String(speed),
      });

      const yResponse = await Promise.race([
        fetch('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', {
          method: 'POST',
          headers: {
            'Authorization': `Api-Key ${yandexApiKey}`,
          },
          body: params,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Yandex TTS request timeout')), SERVER_TIMEOUTS.TTS)
        ),
      ]);

      if (!yResponse.ok) {
        const errText = await yResponse.text();
        throw new Error(`Yandex TTS error ${yResponse.status}: ${errText}`);
      }

      // Yandex returns raw PCM (lpcm format) — exactly what the client expects
      const audioBuffer = Buffer.from(await yResponse.arrayBuffer());
      const base64Audio = audioBuffer.toString('base64');
      incrementUsage(req.userId, 'tts');
      logActivity(req.userId, 'tts_request', {
        detail: ttsInput.substring(0, 100), inputUnits: ttsInput.length, device,
        model: yVoice.voice, provider: 'yandex-tts', language: textLanguage, durationMs: Date.now() - ttsStartedAt,
      });
      res.json({ audio: base64Audio });
    } else {
      // Google or Azure TTS — voice override (verified catalog) takes
      // precedence; otherwise fall back to per-language default.
      const lang = LANGUAGES[textLanguage] || LANGUAGES['de'];
      const resolved = voiceOverride
        ? { provider: voiceOverride.provider, voice: voiceOverride.id }
        : resolveTtsVoice(textLanguage, settings);

      if (resolved.provider === 'azure') {
        const { key: azureKey, region: azureRegion } = getAzureCredentials(settings);
        if (!azureKey) {
          return res.status(400).json({ error: 'Azure TTS key not configured. Set it in Admin > TTS Settings or as AZURE_TTS_KEY env variable.' });
        }
        const base64Audio = await azureTts(ttsInput, resolved.voice, lang.ttsLang, azureKey, azureRegion, speed);
        incrementUsage(req.userId, 'tts');
        logActivity(req.userId, 'tts_request', {
          detail: ttsInput.substring(0, 100), inputUnits: ttsInput.length, device,
          model: resolved.voice, provider: 'azure-tts', language: textLanguage, durationMs: Date.now() - ttsStartedAt,
        });
        res.json({ audio: base64Audio });
      } else {
        // Google Cloud TTS (default)
        if (!ttsClient) {
          return res.status(503).json({ error: 'Google TTS service not configured' });
        }

        const request = {
          input: { text: ttsInput },
          voice: {
            languageCode: lang.ttsLang,
            name: resolved.voice,
          },
          audioConfig: {
            audioEncoding: 'LINEAR16',
            sampleRateHertz: 24000,
            speakingRate: speed,
          },
        } as any;

        const result = await ttsClient.synthesizeSpeech(request);
        const response = Array.isArray(result) ? result[0] : result;
        let audioContent = response.audioContent as Buffer;

        // Google Cloud TTS returns WAV format, strip the 44-byte WAV header to get raw PCM
        if (audioContent.length > 44 && audioContent.toString('ascii', 0, 4) === 'RIFF') {
          audioContent = audioContent.slice(44);
        }

        const base64Audio = audioContent.toString('base64');
        incrementUsage(req.userId, 'tts');
        logActivity(req.userId, 'tts_request', {
          detail: ttsInput.substring(0, 100), inputUnits: ttsInput.length, device,
          model: resolved.voice, provider: 'google-tts', language: textLanguage, durationMs: Date.now() - ttsStartedAt,
        });
        res.json({ audio: base64Audio });
      }
    }
  } catch (err) {
    console.error('TTS Error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}));

// Focused follow-up that fetches ONLY the antonyms for a word, used to recover
// the field when the all-fields explain call omits it. Gemini-only; best-effort.
async function backfillAntonyms(
  word: string, meaningHint: string, textLanguage: string, explanationLanguage: string,
  model: string, fallbackModel: string,
): Promise<Array<{ word: string; meaning: string }>> {
  const prompt = buildAntonymBackfillPrompt(word, meaningHint, textLanguage, explanationLanguage);
  const resp = await geminiWithFallback(prompt, model, fallbackModel, { responseMimeType: 'application/json' });
  const parsed = JSON.parse(resp.text || '{}');
  return coerceAntonyms(parsed.antonyms);
}

// POST /api/explain — Gemini explanation (moved from client-side)
// Core explain logic — reused by /api/explain endpoint and background processing
async function explainPhraseCore(
  phrase: string, text: string, textLanguage: string, explanationLanguage: string
): Promise<{ result: any; promptTokens?: number; candidatesTokens?: number; modelUsed?: string; provider?: string; durationMs?: number }> {
  const startedAt = Date.now();
  const settings = await getAppSettings();
  const model = settings.llm_model || 'gemini-2.5-flash-lite';
  const thinkingBudget = parseInt(settings.thinking_budget || '-1', 10);
  const llmProvider = settings.llm_provider || 'gemini';
  let modelUsed: string | undefined = model;

  const prompt = buildPrompt(textLanguage || 'de', explanationLanguage || 'en');
  const limitedText = (text || '').slice(0, getTextLimit(textLanguage || 'de'));
  const phraseIdx = (text || '').indexOf(phrase);
  const cursorContext = (text || '').substring(
    Math.max(0, phraseIdx - 20),
    Math.min((text || '').length, phraseIdx + phrase.length + 20)
  );

  const contents = prompt
    .replace('{{selected_text}}', phrase)
    .replace('{{full_text}}', limitedText)
    .replace('{{cursor_context}}', cursorContext);

  const fallbackModel = settings.llm_fallback_model || 'gemini-2.5-flash-lite';

  let result: any;
  let promptTokens: number | undefined;
  let candidatesTokens: number | undefined;

  if (llmProvider === 'deepseek') {
    const deepseekEndpoint = settings.deepseek_endpoint || 'https://api.deepseek.com/v1';
    const deepseekApiKey = settings.deepseek_api_key || process.env.DEEPSEEK_API_KEY || '';
    if (!deepseekApiKey) {
      throw new Error('DeepSeek API key not configured');
    }

    const doDeepseekRequest = () => Promise.race([
      fetch(`${deepseekEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a language tutor assistant. Always respond with valid JSON.' },
            { role: 'user', content: contents },
          ],
          response_format: { type: 'json_object' },
        }),
      }).then(async (r) => {
        if (!r.ok) {
          const errBody = await r.text();
          throw new Error(`DeepSeek API error ${r.status}: ${errBody}`);
        }
        return r.json();
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), SERVER_TIMEOUTS.DEEPSEEK)
      ),
    ]);

    let dsResponse;
    try {
      dsResponse = await doDeepseekRequest();
    } catch (firstErr) {
      console.warn('Explain (DeepSeek): first attempt failed, retrying...', firstErr);
      dsResponse = await doDeepseekRequest();
    }

    const content = dsResponse.choices?.[0]?.message?.content || '{}';
    result = JSON.parse(content);
    promptTokens = dsResponse.usage?.prompt_tokens;
    candidatesTokens = dsResponse.usage?.completion_tokens;
  } else {
    const config: Record<string, any> = {
      responseMimeType: 'application/json',
    };
    if (thinkingBudget >= 0) {
      config.thinkingConfig = { thinkingBudget };
    }

    const response = await geminiWithFallback(contents, model, fallbackModel, config);
    result = JSON.parse(response.text || '{}');
    promptTokens = response.usage?.promptTokenCount;
    candidatesTokens = response.usage?.candidatesTokenCount;
    modelUsed = response.model;
  }

  // Detect if LLM reduced a multi-word phrase to a single word and retry once
  const isMultiWord = phrase.trim().includes(' ');
  const selectionReduced = isMultiWord && result.selection && !result.selection.includes(' ');
  if (selectionReduced) {
    console.warn(`Explain: LLM reduced phrase "${phrase}" to single word "${result.selection}" — retrying`);
    try {
      const retryContents = contents + `\n\nIMPORTANT CORRECTION: You must explain the ENTIRE phrase "${phrase}" as a whole. Do NOT explain just "${result.selection}". The selection field must be exactly "${phrase}".`;
      let retryResult: any;
      if (llmProvider === 'deepseek') {
        const deepseekEndpoint = settings.deepseek_endpoint || 'https://api.deepseek.com/v1';
        const deepseekApiKey = settings.deepseek_api_key || process.env.DEEPSEEK_API_KEY || '';
        const r = await fetch(`${deepseekEndpoint}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekApiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are a language tutor assistant. Always respond with valid JSON.' }, { role: 'user', content: retryContents }], response_format: { type: 'json_object' } }),
        });
        if (r.ok) { const d = await r.json(); retryResult = JSON.parse(d.choices?.[0]?.message?.content || '{}'); }
      } else {
        const retryConfig: Record<string, any> = { responseMimeType: 'application/json' };
        if (thinkingBudget >= 0) retryConfig.thinkingConfig = { thinkingBudget };
        const retryResp = await geminiWithFallback(retryContents, model, fallbackModel, retryConfig);
        retryResult = JSON.parse(retryResp.text || '{}');
      }
      if (retryResult && retryResult.selection) {
        result = retryResult;
      }
    } catch (retryErr) {
      console.warn('Explain: phrase retry failed, using original result', retryErr);
    }
  }

  // Force selection to always match input phrase
  if (result.selection !== phrase) {
    result.selection = phrase;
  }

  // Ensure lemma_translation and meanings are populated for words/phrases
  if (result.input_type === 'word') {
    if (!result.lemma_translation && result.meanings?.length) {
      result.lemma_translation = result.meanings[0];
    }
    if ((!result.meanings || result.meanings.length === 0) && result.lemma_translation) {
      result.meanings = [result.lemma_translation];
    }
  }
  // Ensure translation is populated for sentences
  if (result.input_type === 'sentence' && !result.translation && result.meanings?.length) {
    result.translation = result.meanings.join('; ');
  }

  // Antonyms backfill — the all-fields call frequently omits `antonyms` for
  // words that clearly have an opposite (it drops the field rather than filling
  // it). Recover them with one small focused call. Best-effort: any failure
  // leaves the result unchanged. Gemini-only.
  //
  // Only run for parts of speech that plausibly HAVE an opposite — per the
  // prompt that's essentially adjectives, adverbs, and verbs. Nouns, proper
  // nouns, and function words (prepositions, conjunctions, particles, numerals,
  // pronouns…) almost never have a lexical antonym, so backfilling them just
  // burns an LLM call that always comes back empty. For those we trust the
  // model's (empty/omitted) result and let the normalization below record [].
  const pos = (result.part_of_speech || '').toLowerCase();
  const posMayHaveAntonym = pos.includes('verb') || pos.includes('adject'); // matches verb, adverb, adjective
  if (
    llmProvider !== 'deepseek' &&
    result.input_type === 'word' &&
    posMayHaveAntonym &&
    (!Array.isArray(result.antonyms) || result.antonyms.length === 0)
  ) {
    try {
      const filled = await backfillAntonyms(
        result.selection || phrase,
        result.lemma_translation || result.meanings?.[0] || '',
        textLanguage || 'de',
        explanationLanguage || 'en',
        model, fallbackModel,
      );
      if (filled.length) result.antonyms = filled;
    } catch (err) {
      console.warn('Antonyms backfill failed:', err);
    }
  }

  // Always expose `antonyms` as an array on word results. The model frequently
  // omits the field (and nouns skip the backfill above), leaving it undefined —
  // which the client's `isExplanationStale` check treats as "needs refetch",
  // so such words would re-generate on EVERY click instead of serving the
  // cached result. Normalizing to [] here satisfies the check after one fetch.
  if (result.input_type === 'word' && !Array.isArray(result.antonyms)) {
    result.antonyms = [];
  }

  return { result, promptTokens, candidatesTokens, modelUsed, provider: llmProvider, durationMs: Date.now() - startedAt };
}

app.post('/api/explain', requireAuth as express.RequestHandler, checkQuota('explain') as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { phrase, text, textLanguage, explanationLanguage } = req.body;
  if (!phrase || typeof phrase !== 'string') {
    return res.status(400).json({ error: 'Missing phrase' });
  }

  const device = detectDevice(req);

  try {
    const { result, promptTokens, candidatesTokens, modelUsed, provider, durationMs } = await explainPhraseCore(phrase, text, textLanguage, explanationLanguage);
    logActivity(req.userId, 'explain', {
      detail: phrase, inputUnits: promptTokens, outputUnits: candidatesTokens, device,
      model: modelUsed, provider, language: textLanguage, durationMs,
    });
    incrementUsage(req.userId, 'explain');
    res.json({ result, promptTokens, candidatesTokens });
  } catch (err) {
    console.error('Explain error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}));

// POST /api/explain/example-variant — "more like this" for an example phrase.
// Generates ONE additional example using the SAME meaning/role as a given
// example, but in a genuinely different situation (not a trivial reword).
async function explainVariantCore(opts: {
  selection: string;
  inputType: 'word' | 'sentence';
  textLanguage: string;
  explanationLanguage: string;
  meanings?: string[];
  translation?: string;
  targetTranslations?: Array<{ text: string; register?: string | null; note?: string | null }>;
  currentExample: { text: string; translation: string };
  otherExamples?: Array<{ text: string }>;
}): Promise<{ result: { text: string; translation: string }; promptTokens?: number; candidatesTokens?: number; modelUsed?: string; provider?: string }> {
  const settings = await getAppSettings();
  const model = settings.llm_model || 'gemini-2.5-flash-lite';
  const thinkingBudget = parseInt(settings.thinking_budget || '-1', 10);
  const llmProvider = settings.llm_provider || 'gemini';
  let modelUsed: string | undefined = model;

  const tLang = LANGUAGE_LABELS[opts.textLanguage] || opts.textLanguage;
  const eLang = LANGUAGE_LABELS[opts.explanationLanguage] || opts.explanationLanguage;

  let contextBlock: string;
  if (opts.inputType === 'sentence') {
    contextBlock = `The ${tLang} phrase/sentence being explained: "${opts.selection}".\nIts ${eLang} translation: "${opts.translation ?? ''}".`;
  } else if (opts.targetTranslations && opts.targetTranslations.length > 0) {
    contextBlock = `The user is exploring how to express "${opts.selection}" (${eLang}) in ${tLang}.\nBest ${tLang} translations: ${opts.targetTranslations.map(t => `"${t.text}"${t.register ? ` (${t.register})` : ''}`).join(', ')}.`;
  } else {
    contextBlock = `The ${tLang} word/phrase being explained: "${opts.selection}".\nIts meanings in ${eLang}: ${(opts.meanings ?? []).map(m => `"${m}"`).join(', ') || '(none provided)'}.`;
  }

  const otherList = (opts.otherExamples || []).map(o => `  - "${o.text}"`).join('\n');

  const prompt = `You are extending a language-learning explanation card with ONE additional example.

${contextBlock}

The user just clicked "more like this" on this example:
  Text: "${opts.currentExample.text}"
  Translation: "${opts.currentExample.translation}"

Existing examples already shown (DO NOT duplicate any of these — neither the situation nor the surface form):
${otherList || '  (none)'}

Generate ONE new example with these properties:
1. Uses "${opts.selection}" in the SAME meaning/sense/grammatical role as the current example. Same lexical sense — not a different meaning of the same word, not a different idiom.
2. ${opts.inputType === 'sentence' ? `Mirrors the SAME grammatical pattern/construction as the current example — a parallel frame, not a different idiom that shares surface words.` : `The word should be the meaning-carrying element, not a frozen part of an idiom. If the listed meaning is "to do", an example like "Das tut mir leid" (idiom: be sorry) is WRONG even though the word appears.`}
3. The SITUATION must be GENUINELY DIFFERENT — different topic, different actors, different setting, different time/place. NOT a trivial reword where only one noun was swapped. For example, if the current example is "I go to the cinema," do NOT produce "I go to the theater" or "I go to the park." Produce something structurally similar but contextually fresh, like "He walks to school every morning" or "We're heading to the airport tonight."
4. Simple A1–A2 ${tLang} sentence (short, learner-friendly).
5. Accurate, natural-sounding ${eLang} translation.
6. Must differ from every example listed above in both situation AND wording.

Return ONLY a JSON object (no markdown fences) with exactly two fields:
{"text": "<the new ${tLang} sentence>", "translation": "<its ${eLang} translation>"}
`;

  const fallbackModel = settings.llm_fallback_model || 'gemini-2.5-flash-lite';
  let result: { text: string; translation: string };
  let promptTokens: number | undefined;
  let candidatesTokens: number | undefined;

  if (llmProvider === 'deepseek') {
    const deepseekEndpoint = settings.deepseek_endpoint || 'https://api.deepseek.com/v1';
    const deepseekApiKey = settings.deepseek_api_key || process.env.DEEPSEEK_API_KEY || '';
    if (!deepseekApiKey) throw new Error('DeepSeek API key not configured');
    const r = await fetch(`${deepseekEndpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekApiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a language tutor assistant. Always respond with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) throw new Error(`DeepSeek API error ${r.status}: ${await r.text()}`);
    const ds = await r.json();
    result = JSON.parse(ds.choices?.[0]?.message?.content || '{}');
    promptTokens = ds.usage?.prompt_tokens;
    candidatesTokens = ds.usage?.completion_tokens;
  } else {
    const config: Record<string, any> = { responseMimeType: 'application/json', temperature: 1.0 };
    if (thinkingBudget >= 0) config.thinkingConfig = { thinkingBudget };
    const response = await geminiWithFallback(prompt, model, fallbackModel, config);
    result = JSON.parse(response.text || '{}');
    promptTokens = response.usage?.promptTokenCount;
    candidatesTokens = response.usage?.candidatesTokenCount;
    modelUsed = response.model;
  }

  if (typeof result?.text !== 'string' || typeof result?.translation !== 'string') {
    throw new Error('Invalid variant response shape from LLM');
  }
  return { result, promptTokens, candidatesTokens, modelUsed, provider: llmProvider };
}

app.post('/api/explain/example-variant', requireAuth as express.RequestHandler, checkQuota('explain') as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { selection, inputType, textLanguage, explanationLanguage, meanings, translation, targetTranslations, currentExample, otherExamples } = req.body;
  if (!selection || typeof selection !== 'string') return res.status(400).json({ error: 'Missing selection' });
  if (inputType !== 'word' && inputType !== 'sentence') return res.status(400).json({ error: 'Invalid inputType' });
  if (!currentExample || typeof currentExample.text !== 'string' || typeof currentExample.translation !== 'string') {
    return res.status(400).json({ error: 'Missing currentExample' });
  }

  const device = detectDevice(req);

  try {
    const { result, promptTokens, candidatesTokens, modelUsed, provider } = await explainVariantCore({
      selection,
      inputType,
      textLanguage: textLanguage || 'de',
      explanationLanguage: explanationLanguage || 'en',
      meanings: Array.isArray(meanings) ? meanings : undefined,
      translation: typeof translation === 'string' ? translation : undefined,
      targetTranslations: Array.isArray(targetTranslations) ? targetTranslations : undefined,
      currentExample,
      otherExamples: Array.isArray(otherExamples) ? otherExamples : undefined,
    });
    logActivity(req.userId, 'explain', {
      detail: `variant:${selection}`,
      inputUnits: promptTokens,
      outputUnits: candidatesTokens,
      device,
      model: modelUsed,
      provider,
      language: textLanguage,
    });
    incrementUsage(req.userId, 'explain');
    res.json({ result });
  } catch (err) {
    console.error('Explain variant error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}));

// POST /api/infer-genders — classify the likely gender of dialog speaker names
// so "read all" can assign a gender-matched voice per speaker. Best-effort: on
// any failure (or unparseable output) returns {} and the client falls back to a
// random voice. Not metered — one tiny call, gated by auth + the read-all action.
app.post('/api/infer-genders', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const rawNames: unknown[] = Array.isArray(req.body?.names) ? req.body.names : [];
  const names: string[] = Array.from(new Set(
    rawNames
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .map((n) => n.trim()),
  )).slice(0, 50);
  if (names.length === 0) return res.json({ genders: {} });

  const textLanguage = typeof req.body?.textLanguage === 'string' ? req.body.textLanguage : 'en';
  const langLabel = LANGUAGE_LABELS[textLanguage] || textLanguage;
  const settings = await getAppSettings();
  const model = settings.llm_model || 'gemini-2.5-flash-lite';
  const fallbackModel = settings.llm_fallback_model || model;

  const prompt = `You classify the most likely gender of a person bearing each given name.
The names come from a dialogue/script written in ${langLabel}; use the cultural context of that language.
For each name answer "male", "female", or "neutral" (genuinely unisex, or not a personal name).
Return ONLY a JSON object mapping each input name to one of those three strings, no markdown.

Names: ${JSON.stringify(names)}`;

  try {
    const resp = await geminiWithFallback(prompt, model, fallbackModel, { responseMimeType: 'application/json' });
    const parsed = JSON.parse(resp.text || '{}');
    const genders: Record<string, 'male' | 'female' | 'neutral'> = {};
    for (const name of names) {
      const v = String(parsed?.[name] ?? '').toLowerCase();
      genders[name] = v === 'male' || v === 'female' ? v : 'neutral';
    }
    res.json({ genders });
  } catch (err) {
    console.error('infer-genders error:', err);
    res.json({ genders: {} });
  }
}));

// POST /api/generate-text — AI text generation by parameters
app.post('/api/generate-text', requireAuth as express.RequestHandler, checkQuota('generate') as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { textLanguage, level, sentences, topic, instructions } = req.body;
  const dialog = req.body.dialog === true;

  const validLevels = ['A1','A2','B1','B2','C1','C2'];
  if (!validLevels.includes(level)) return res.status(400).json({ error: 'Invalid level' });

  // Fetch settings and user role in parallel
  const [settings, { rows: genUserRows }] = await Promise.all([
    getAppSettings(),
    pool.query('SELECT role, subscription_status, created_at FROM users WHERE id=$1', [req.userId]),
  ]);
  const genUser = genUserRows[0];
  const genIsPaid = genUser && (genUser.subscription_status === 'active' || genUser.subscription_status === 'trialing' || genUser.subscription_status === 'past_due');
  const genLimitsEnabled = !isExemptFromLimits(genUser?.role || 'user', genUser?.created_at || null, settings);
  let maxSentences = 30;
  if (!genIsPaid && genLimitsEnabled) {
    maxSentences = genUser?.role === 'anonymous'
      ? parseInt(settings.anon_max_generate_sentences || '5', 10)
      : parseInt(settings.free_max_generate_sentences || '10', 10);
  }
  const sentenceCount = Math.min(maxSentences, Math.max(5, parseInt(sentences) || 10));
  const model = settings.llm_model || 'gemini-2.5-flash-lite';
  const llmProvider = settings.llm_provider || 'gemini';

  const langLabel = LANGUAGE_LABELS[textLanguage] || textLanguage;

  const prompt = dialog
    ? `Generate a short dialogue of exactly ${sentenceCount} lines in the ${langLabel} language at CEFR level ${level}.

CRITICAL: The ENTIRE dialogue MUST be written in ${langLabel}. Every single word — including the persona names — must fit ${langLabel}. Do NOT write in English or any other language. The output language is ${langLabel}.
${topic ? `\nTopic / situation: ${topic}.` : '\nInvent an interesting, unexpected situation on your own — avoid clichés and common textbook themes.'}
${instructions ? `Additional requirements: ${instructions}.` : ''}

Rules:
- It is a natural conversation between EXACTLY TWO named people — only two speakers, no third persona ever appears. Give them culturally appropriate ${langLabel} first names.
- The two speakers alternate turns; every line is one of those same two names.
- EVERY line MUST start with the speaker's name, then a colon and a space, then their words — e.g. "Anna: ...". One speaker turn per line, separated by a single newline.
- Exactly ${sentenceCount} lines total. A line is one turn and may contain 1–2 short sentences.
- Make it coherent and lively — a real back-and-forth, not disconnected remarks. Use humor or a surprising angle where it fits.
- Use vocabulary and grammar structures typical for ${level} learners.
- Return ONLY the dialogue lines: no title, no narration, no stage directions, no numbering, no translations, no meta-commentary.
- Plain text only — no markdown, no bold/italic markers, no asterisks, no underscores, no hashtags, no bullet points. Just "Name: utterance" lines.`
    : `Generate a short text of exactly ${sentenceCount} sentences in the ${langLabel} language at CEFR level ${level}.

CRITICAL: The ENTIRE text MUST be written in ${langLabel}. Every single word must be in ${langLabel}. Do NOT write in English or any other language. The output language is ${langLabel}.
${topic ? `\nTopic: ${topic}.` : '\nPick an interesting, unexpected topic on your own — avoid clichés and common textbook themes.'}
${instructions ? `Additional requirements: ${instructions}.` : ''}

Rules:
- Write a coherent, engaging text — NOT a list of disconnected sentences. The sentences should flow naturally as a paragraph or short story
- Be creative: use vivid details, surprising angles, humor, or personal-style narrative where appropriate
- Vary sentence structure: mix short and long sentences, questions, exclamations, subordinate clauses
- Use vocabulary and grammar structures typical for ${level} learners, but keep the content lively and memorable
- Each generation should feel fresh and different — avoid formulaic patterns
- Return ONLY the ${langLabel} text, no numbering, no explanations, no meta-commentary, no translations
- Plain text only — no markdown, no bold/italic markers, no asterisks, no underscores, no hashtags, no bullet points`;

  const device = detectDevice(req);
  const startedAt = Date.now();

  try {
    let generatedText: string;
    let promptTokens: number | undefined;
    let candidatesTokens: number | undefined;
    let modelUsed: string = model;

    if (llmProvider === 'deepseek') {
      const deepseekEndpoint = settings.deepseek_endpoint || 'https://api.deepseek.com/v1';
      const deepseekApiKey = settings.deepseek_api_key || process.env.DEEPSEEK_API_KEY || '';
      if (!deepseekApiKey) return res.status(400).json({ error: 'DeepSeek API key not configured.' });

      const dsResponse = await fetch(`${deepseekEndpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekApiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 1.2,
        }),
      }).then(r => r.json());

      generatedText = dsResponse.choices?.[0]?.message?.content || '';
      promptTokens = dsResponse.usage?.prompt_tokens;
      candidatesTokens = dsResponse.usage?.completion_tokens;
    } else {
      const fallbackModel = settings.llm_fallback_model || 'gemini-2.5-flash-lite';
      const response = await geminiWithFallback(prompt, model, fallbackModel, { temperature: 1.2 });
      generatedText = response.text || '';
      promptTokens = response.usage?.promptTokenCount;
      candidatesTokens = response.usage?.candidatesTokenCount;
      modelUsed = response.model;
    }

    // Strip any markdown formatting the model may have included
    const plainText = generatedText.trim()
      .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
      .replace(/\*(.+?)\*/g, '$1')       // *italic*
      .replace(/__(.+?)__/g, '$1')       // __bold__
      .replace(/_(.+?)_/g, '$1')         // _italic_
      .replace(/^#+\s*/gm, '')           // # headings
      .replace(/^[-*]\s+/gm, '')         // - or * bullet points
      .replace(/^\d+\.\s+/gm, '')        // 1. numbered lists
      .replace(/`(.+?)`/g, '$1');        // `code`

    logActivity(req.userId, 'generate_text', {
      detail: topic || level, inputUnits: promptTokens, outputUnits: candidatesTokens, device,
      model: modelUsed, provider: llmProvider, language: textLanguage, durationMs: Date.now() - startedAt,
    });
    incrementUsage(req.userId, 'generate');
    res.json({ text: plainText });
  } catch (err) {
    console.error('Generate text error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}));

// POST /api/ocr-extract — extract text from an image via OpenAI vision (gpt-5-nano).
// Shares the 'generate' quota since this is a "create new text" action.
app.post('/api/ocr-extract', requireAuth as express.RequestHandler, checkQuota('generate') as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { image, language } = req.body;

  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Invalid or missing image (expected data URL)' });
  }
  if (!language || typeof language !== 'string') {
    return res.status(400).json({ error: 'Missing language' });
  }

  const settings = await getAppSettings();
  const openaiApiKey = settings.openai_api_key || process.env.OPENAI_API_KEY || '';
  const model = settings.openai_vision_model || 'gpt-5-nano';
  if (!openaiApiKey) {
    return res.status(400).json({ error: 'OpenAI API key not configured.' });
  }

  const langLabel = LANGUAGE_LABELS[language] || language;
  const device = detectDevice(req);
  const instruction = `Extract all readable text from this image. The text is in ${langLabel}.

Formatting rules:
- Join lines that were broken only by page layout (soft wrapping). A line that does not end in a sentence-final punctuation mark is part of the next line's sentence.
- Put each sentence on its own line.
- Preserve paragraph breaks (a blank line in the source separates paragraphs).
- Return only the extracted text. No commentary, no markdown, no surrounding quotes.
- If the image contains no readable text, return an empty string.
- NEVER ask the user to provide a clearer image, a different crop, or any clarification. NEVER apologise. NEVER explain that the image is blurry or low-resolution. If you cannot read the text, return an empty string — nothing else.`;

  const startedAt = Date.now();
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              { type: 'image_url', image_url: { url: image, detail: 'low' } },
            ],
          },
        ],
      }),
    });

    const rawBody = await upstream.text();
    let parsed: any = null;
    try { parsed = rawBody ? JSON.parse(rawBody) : null; } catch { /* keep parsed=null */ }

    if (!upstream.ok || parsed?.error) {
      const e = parsed?.error || {};
      const detail = [
        e.message,
        e.type && `type=${e.type}`,
        e.code && `code=${e.code}`,
        e.param && `param=${e.param}`,
      ].filter(Boolean).join(' · ');
      const message = detail || `HTTP ${upstream.status}: ${rawBody.slice(0, 200) || '(empty body)'}`;
      console.error('OpenAI OCR error:', { httpStatus: upstream.status, model, error: e, rawBody: rawBody.slice(0, 500) });
      return res.status(502).json({ error: `OpenAI (${upstream.status}, model=${model}): ${message}` });
    }

    const extracted = (parsed?.choices?.[0]?.message?.content || '').trim();
    const promptTokens = parsed?.usage?.prompt_tokens;
    const completionTokens = parsed?.usage?.completion_tokens;

    // The model sometimes ignores instructions and responds with a clarification
    // request ("Could you provide a higher-resolution image…"). Catch that and
    // surface it as an error rather than loading the meta-text into the editor.
    if (isOcrRefusal(extracted)) {
      logActivity(req.userId, 'ocr_refusal', {
        detail: language, inputUnits: promptTokens, outputUnits: completionTokens, device,
        model, provider: 'openai', language, durationMs: Date.now() - startedAt,
      });
      return res.status(422).json({ error: extracted });
    }

    logActivity(req.userId, 'ocr_extract', {
      detail: language, inputUnits: promptTokens, outputUnits: completionTokens, device,
      model, provider: 'openai', language, durationMs: Date.now() - startedAt,
    });
    incrementUsage(req.userId, 'generate');
    res.json({ text: extracted });
  } catch (err) {
    console.error('OCR extract error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `OCR failed: ${msg}` });
  }
}));

// POST /api/stripe/checkout — create Stripe Checkout session
app.post('/api/stripe/checkout', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  if (!stripe) return res.status(404).json({ error: 'Stripe not configured' });
  const { priceId } = req.body;
  if (!priceId) return res.status(400).json({ error: 'Missing priceId' });

  // Get user info + check anonymous (single query)
  const { rows } = await pool.query('SELECT stripe_customer_id, email, role FROM users WHERE id=$1', [req.userId]);
  if (rows[0]?.role === 'anonymous') return res.status(403).json({ error: 'Registration required' });
  let customerId = rows[0]?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: rows[0]?.email,
      metadata: { userId: req.userId },
    });
    customerId = customer.id;
    await pool.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2', [customerId, req.userId]);
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/app?checkout=success`,
    cancel_url: `${appUrl}/app`,
    metadata: { userId: req.userId },
  });

  res.json({ url: session.url });
}));

// POST /api/stripe/portal — create Stripe Customer Portal session
app.post('/api/stripe/portal', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  if (!stripe) return res.status(404).json({ error: 'Stripe not configured' });
  const { rows } = await pool.query('SELECT stripe_customer_id FROM users WHERE id=$1', [req.userId]);
  const customerId = rows[0]?.stripe_customer_id;
  if (!customerId) return res.status(400).json({ error: 'No billing account' });

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/app`,
  });
  res.json({ url: session.url });
}));

// GET /api/subscription — current user's subscription status and usage
app.get('/api/subscription', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { rows: userRows } = await pool.query(
    'SELECT subscription_status, subscription_period_end, cancel_at_period_end, role, created_at FROM users WHERE id=$1',
    [req.userId]
  );
  const user = userRows[0] || {};
  const status = user.subscription_status || 'free';
  const isPaid = status === 'active' || status === 'trialing' || status === 'past_due';
  const isAnon = user.role === 'anonymous';

  // Get today's usage
  const { rows: usageRows } = await pool.query(
    'SELECT explain_count, tts_count, generate_count FROM daily_usage WHERE user_id=$1 AND usage_date=CURRENT_DATE',
    [req.userId]
  );
  const usage = usageRows[0] || { explain_count: 0, tts_count: 0, generate_count: 0 };

  const settings = await getAppSettings();
  const prefix = isAnon ? 'anon' : 'free';
  const limitsEnabled = !isExemptFromLimits(user.role || 'user', user.created_at || null, settings);
  let limits: { explains: number; tts: number; generates: number } | null = null;
  if (!isPaid && limitsEnabled) {
    limits = {
      explains: parseInt(settings[`${prefix}_daily_explains`] || '5', 10),
      tts: parseInt(settings[`${prefix}_daily_tts`] || '5', 10),
      generates: parseInt(settings[`${prefix}_daily_generates`] || '2', 10),
    };
  }

  // Weekly WAV download usage
  const { rows: wavRows } = await pool.query(
    `SELECT COALESCE(SUM(wav_text_count), 0) AS wav_text, COALESCE(SUM(wav_flashcard_count), 0) AS wav_flashcards
     FROM daily_usage WHERE user_id=$1 AND usage_date >= date_trunc('week', CURRENT_DATE)::date`,
    [req.userId]
  );
  const wavUsage = {
    text: parseInt(wavRows[0]?.wav_text || '0', 10),
    flashcards: parseInt(wavRows[0]?.wav_flashcards || '0', 10),
  };
  const wavLimits = !isPaid && limitsEnabled ? {
    text: parseInt(settings.free_weekly_wav_text || '1', 10),
    flashcards: parseInt(settings.free_weekly_wav_flashcards || '1', 10),
  } : null;

  res.json({
    status,
    periodEnd: user.subscription_period_end || null,
    cancelAtPeriodEnd: user.cancel_at_period_end || false,
    usage: {
      explains: usage.explain_count,
      tts: usage.tts_count,
      generates: usage.generate_count,
    },
    limits,
    wavUsage,
    wavLimits,
    freeMaxGenerateSentences: !limitsEnabled ? 30
      : isAnon ? parseInt(settings.anon_max_generate_sentences || '5', 10)
      : parseInt(settings.free_max_generate_sentences || '10', 10),
    freeMaxTextLength: !limitsEnabled ? 0
      : isAnon ? parseInt(settings.anon_max_text_length || '400', 10)
      : parseInt(settings.free_max_text_length || '800', 10),
  });
}));

// GET /api/stripe/prices — list active prices for the configured product
app.get('/api/stripe/prices', requireAuth as express.RequestHandler, asyncHandler(async (_req: any, res) => {
  if (!stripe) return res.status(404).json({ error: 'Stripe not configured' });
  const prices = await stripe.prices.list({ active: true, expand: ['data.product'], limit: 10 });
  const items = prices.data
    .filter(p => p.type === 'recurring')
    .map(p => ({
      id: p.id,
      amount: p.unit_amount,
      currency: p.currency,
      interval: p.recurring?.interval,
      intervalCount: p.recurring?.interval_count,
      productName: typeof p.product === 'object' && p.product !== null && 'name' in p.product ? (p.product as Stripe.Product).name : '',
    }));
  res.json({ prices: items });
}));

// POST /api/log — client-side activity logging
app.post('/api/log', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { action, detail, inputUnits, outputUnits, device } = req.body;
  if (!action || typeof action !== 'string') return res.status(400).json({ error: 'Missing action' });
  logActivity(req.userId, action, { detail: detail || undefined, inputUnits, outputUnits, device });
  res.json({ ok: true });
}));

// --- Share lesson ---

function generateShareCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

app.post('/api/share', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { workspaceId, shareSource } = req.body;
  if (!workspaceId) return res.status(400).json({ error: 'Missing workspaceId' });

  // Verify workspace belongs to user and get name
  const ws = await authorizeWorkspace(req.userId, workspaceId);
  if (!ws) return res.status(403).json({ error: 'Forbidden' });
  const workspaceName = ws.name;

  // Get workspace state
  const { rows: stateRows } = await pool.query('SELECT state FROM workspace_state WHERE workspace_id=$1', [workspaceId]);
  const state = stateRows[0]?.state || {};

  // Check if this workspace was already shared — reuse the same code
  const { rows: existing } = await pool.query(
    'SELECT id FROM shared_lessons WHERE workspace_id=$1 AND creator_user_id=$2 LIMIT 1',
    [workspaceId, req.userId]
  );

  let code: string;
  if (existing.length) {
    // Update existing shared lesson with fresh state
    code = existing[0].id;
    await pool.query(
      'UPDATE shared_lessons SET state=$1, text_language=$2, workspace_name=$3, share_source=COALESCE($4, share_source) WHERE id=$5',
      [JSON.stringify(state), state.textLanguage || 'de', workspaceName, shareSource || null, code]
    );
  } else {
    // Generate unique code with collision retry
    let attempts = 0;
    while (true) {
      code = generateShareCode();
      try {
        await pool.query(
          'INSERT INTO shared_lessons (id, creator_user_id, workspace_id, state, text_language, workspace_name, share_source) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [code, req.userId, workspaceId, JSON.stringify(state), state.textLanguage || 'de', workspaceName, shareSource || null]
        );
        break;
      } catch (err: any) {
        if (err.code === '23505' && attempts < 5) { attempts++; continue; }
        throw err;
      }
    }
  }

  // Auto-create promo source so it appears in monitoring dropdown
  if (shareSource) {
    await pool.query(
      `INSERT INTO promo_sources (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
      [shareSource.slice(0, 8), shareSource]
    );
  }

  logActivity(req.userId, 'share_lesson', { detail: shareSource ? `${code} [${shareSource}]` : code });
  res.json({ code });
}));

app.get('/api/shared/:id', publicCors as express.RequestHandler, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT state, text_language, workspace_name, share_source, status, progress_total, progress_done FROM shared_lessons WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const row = rows[0];
  const response: any = { state: row.state, textLanguage: row.text_language, workspaceName: row.workspace_name, shareSource: row.share_source };
  if (row.status && row.status !== 'ready') {
    response.status = row.status;
    response.progress = { done: row.progress_done || 0, total: row.progress_total || 0 };
  }
  res.json(response);
}));

// POST /api/create-shared — create a shared workspace via API with background explanation processing
app.post('/api/create-shared', publicCors as express.RequestHandler, requireApiKey as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { text, phrases, textLanguage, explanationLanguage, name } = req.body;
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' });
  if (!Array.isArray(phrases) || phrases.length === 0) return res.status(400).json({ error: 'Missing or empty phrases array' });
  if (phrases.length > 200) return res.status(400).json({ error: 'Too many phrases (max 200)' });

  const lang = textLanguage || 'de';
  const explLang = explanationLanguage || 'ru';
  const wsName = name || 'Shared Lesson';

  // Deduplication: hash text + sorted phrases to detect identical requests
  const contentHash = createHash('sha256')
    .update(JSON.stringify({ text, phrases: [...phrases].sort(), lang, explLang }))
    .digest('hex');
  const { rows: existing } = await pool.query(
    'SELECT id, status, progress_done, progress_total FROM shared_lessons WHERE content_hash=$1 LIMIT 1',
    [contentHash]
  );
  if (existing.length) {
    const ex = existing[0];
    return res.json({ code: ex.id, status: ex.status, total: ex.progress_total, done: ex.progress_done });
  }

  // Build initial state with text but no explanations yet
  const initialState = {
    text,
    textLanguage: lang,
    history: [],
    explainHistory: [],
    result: null,
    explanationCache: {},
    originId: crypto.randomUUID(),
  };

  // Generate unique share code with collision retry
  let code = '';
  let attempts = 0;
  while (true) {
    code = generateShareCode();
    try {
      await pool.query(
        `INSERT INTO shared_lessons (id, state, text_language, workspace_name, status, progress_total, progress_done, content_hash)
         VALUES ($1, $2, $3, $4, 'processing', $5, 0, $6)`,
        [code, JSON.stringify(initialState), lang, wsName, phrases.length, contentHash]
      );
      break;
    } catch (err: any) {
      if (err.code === '23505' && attempts < 5) { attempts++; continue; }
      throw err;
    }
  }

  // Respond immediately
  res.json({ code, status: 'processing', total: phrases.length });

  // Background processing: explain each phrase sequentially
  (async () => {
    const state = { ...initialState, explanationCache: {} as Record<string, any>, explainHistory: [] as string[] };
    let done = 0;
    for (const phrase of phrases) {
      try {
        const { result } = await explainPhraseCore(phrase, text, lang, explLang);
        state.explanationCache[phrase] = result;
        state.explainHistory.push(phrase);
        if (!state.result) state.result = result; // set first result as current
        done++;
        await pool.query(
          'UPDATE shared_lessons SET state=$1, progress_done=$2 WHERE id=$3',
          [JSON.stringify(state), done, code]
        );
      } catch (err) {
        console.error(`[create-shared] Error explaining "${phrase}" for code ${code}:`, err);
        // Continue with next phrase on error
        done++;
        await pool.query(
          'UPDATE shared_lessons SET progress_done=$1 WHERE id=$2',
          [done, code]
        ).catch(() => {});
      }
    }
    // Mark as ready
    await pool.query(
      'UPDATE shared_lessons SET status=$1, state=$2 WHERE id=$3',
      ['ready', JSON.stringify(state), code]
    ).catch(err => {
      console.error(`[create-shared] Error finalizing code ${code}:`, err);
      pool.query('UPDATE shared_lessons SET status=$1 WHERE id=$2', ['error', code]).catch(() => {});
    });
    console.log(`[create-shared] Completed ${done}/${phrases.length} explanations for code ${code}`);
  })();
}));

// POST /api/wav-download — check & increment weekly WAV download quota for free users
app.post('/api/wav-download', requireAuth as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { type } = req.body; // 'text' | 'flashcards'
  if (type !== 'text' && type !== 'flashcards') return res.status(400).json({ error: 'Invalid type' });

  // Skip quota if Stripe not configured (dev mode)
  if (!stripe) return res.json({ ok: true });

  // Check if user is paid
  const { rows: userRows } = await pool.query('SELECT subscription_status, role FROM users WHERE id=$1', [req.userId]);
  const status = userRows[0]?.subscription_status || 'free';
  const wavCol = type === 'text' ? 'wav_text_count' : 'wav_flashcard_count';
  if (status === 'active' || status === 'trialing' || status === 'past_due') {
    // Still increment for tracking, but don't block
    await pool.query(
      `INSERT INTO daily_usage (user_id, usage_date, ${wavCol}) VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, usage_date) DO UPDATE SET ${wavCol} = daily_usage.${wavCol} + 1`,
      [req.userId]
    );
    return res.json({ ok: true });
  }

  // Check if limits are disabled for this tier or user is in trial
  const wavSettings = await getAppSettings();
  if (isExemptFromLimits(userRows[0]?.role || 'user', userRows[0]?.created_at || null, wavSettings)) {
    await pool.query(
      `INSERT INTO daily_usage (user_id, usage_date, ${wavCol}) VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, usage_date) DO UPDATE SET ${wavCol} = daily_usage.${wavCol} + 1`,
      [req.userId]
    );
    return res.json({ ok: true });
  }

  // Free/anon user — check weekly quota (week starts Monday)
  const col = type === 'text' ? 'wav_text_count' : 'wav_flashcard_count';
  const { rows: usageRows } = await pool.query(
    `SELECT COALESCE(SUM(${col}), 0) AS total FROM daily_usage
     WHERE user_id=$1 AND usage_date >= date_trunc('week', CURRENT_DATE)::date`,
    [req.userId]
  );
  const used = parseInt(usageRows[0]?.total || '0', 10);

  const settings = await getAppSettings();
  const limitKey = type === 'text' ? 'free_weekly_wav_text' : 'free_weekly_wav_flashcards';
  const limit = parseInt(settings[limitKey] || '1', 10);

  if (used >= limit) {
    return res.status(429).json({ error: 'quota_exceeded', limit, used });
  }

  // Increment
  await pool.query(
    `INSERT INTO daily_usage (user_id, usage_date, ${col}) VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, usage_date) DO UPDATE SET ${col} = daily_usage.${col} + 1`,
    [req.userId]
  );
  res.json({ ok: true });
}));

// Admin middleware: requires authenticated user with role='admin'
async function requireAdmin(req: express.Request & { userId?: string }, res: express.Response, next: express.NextFunction) {
  // Reuse requireAuth for session validation
  requireAuth(req, res, async () => {
    const { rows: userRows } = await pool.query('SELECT role FROM users WHERE id=$1', [req.userId]);
    if (!userRows.length || userRows[0].role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
  });
}

// GET /api/admin/users — list all users with workspace count
app.get('/api/admin/users', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const q = (req.query.q as string || '').trim();
  const period = req.query.period as string || '';

  const conditions: string[] = [];
  const params: any[] = [];

  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }

  if (period === 'day') {
    conditions.push(`u.created_at >= NOW() - INTERVAL '1 day'`);
  } else if (period === 'week') {
    conditions.push(`u.created_at >= NOW() - INTERVAL '7 days'`);
  } else if (period === 'month') {
    conditions.push(`u.created_at >= NOW() - INTERVAL '30 days'`);
  }

  // Require at least a search query or period filter
  if (!q && !period) {
    res.json({ users: [] });
    return;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.name, u.role, u.created_at, u.subscription_status,
           (SELECT COUNT(*)::int FROM workspaces w WHERE w.user_id = u.id) AS workspace_count,
           (SELECT COUNT(*)::int FROM activity_log a WHERE a.user_id = u.id AND a.action = 'explain') AS llm_calls,
           (SELECT COUNT(*)::int FROM activity_log a WHERE a.user_id = u.id AND a.action = 'tts_request') AS tts_calls
    FROM users u
    ${where}
    ORDER BY u.created_at DESC
    LIMIT 50
  `, params);
  res.json({ users: rows });
}));

// PATCH /api/admin/users/:id/subscription — grant or revoke free Pro
app.patch('/api/admin/users/:id/subscription', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { status } = req.body;
  if (!['free', 'active'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await pool.query('UPDATE users SET subscription_status=$1 WHERE id=$2', [status, req.params.id]);
  logActivity(req.userId, 'admin_subscription_change', { detail: `${req.params.id} → ${status}` });
  res.json({ ok: true });
}));

// DELETE /api/admin/users/:id — cascading delete of a user
app.delete('/api/admin/users/:id', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const targetId = req.params.id;
  if (targetId === req.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
  await pool.query('DELETE FROM sessions WHERE user_id=$1', [targetId]);
  await pool.query('DELETE FROM user_state WHERE user_id=$1', [targetId]);
  await pool.query(`DELETE FROM workspace_state WHERE workspace_id IN (SELECT id FROM workspaces WHERE user_id=$1)`, [targetId]);
  await pool.query('DELETE FROM workspaces WHERE user_id=$1', [targetId]);
  await pool.query('DELETE FROM users WHERE id=$1', [targetId]);
  res.json({ ok: true });
}));

// GET /api/admin/logs — download activity logs as CSV
app.get('/api/admin/logs', requireAdmin as express.RequestHandler, asyncHandler(async (_req: any, res) => {
  const { rows } = await pool.query(`
    SELECT u.email, a.action, a.detail, a.device, a.created_at
    FROM activity_log a
    JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
  `);

  const escCsv = (val: string | null) => {
    if (!val) return '';
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  };

  const header = 'email,action,detail,device,timestamp';
  const lines = rows.map(r =>
    [escCsv(r.email), escCsv(r.action), escCsv(r.detail), escCsv(r.device), r.created_at.toISOString()].join(',')
  );

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="activity_logs.csv"');
  res.send([header, ...lines].join('\n'));
}));

// GET /api/admin/costs — per-user API cost estimates
app.get('/api/admin/costs', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const range = req.query.range as string;
  let dateFilter = '';
  if (range === '7') dateFilter = "AND a.created_at >= NOW() - INTERVAL '7 days'";
  else if (range === '30') dateFilter = "AND a.created_at >= NOW() - INTERVAL '30 days'";
  // 'all' or anything else: no date filter

  const { rows } = await pool.query(`
    SELECT
      u.email,
      u.name,
      COUNT(*) FILTER (WHERE a.action = 'explain')::int AS llm_calls,
      COUNT(*) FILTER (WHERE a.action = 'tts_request')::int AS tts_calls,
      COALESCE(SUM(a.input_units) FILTER (WHERE a.action = 'explain'), 0)::bigint AS llm_input_tokens,
      COALESCE(SUM(a.output_units) FILTER (WHERE a.action = 'explain'), 0)::bigint AS llm_output_tokens,
      COALESCE(SUM(a.input_units) FILTER (WHERE a.action = 'tts_request'), 0)::bigint AS tts_chars
    FROM activity_log a
    JOIN users u ON u.id = a.user_id
    WHERE a.action IN ('explain', 'tts_request') ${dateFilter}
    GROUP BY u.email, u.name
    HAVING COUNT(*) > 0
    ORDER BY COUNT(*) DESC
  `);

  const costs = rows.map(r => {
    const llmCost = Number(r.llm_input_tokens) * PRICING.gemini_flash.inputPerToken
                  + Number(r.llm_output_tokens) * PRICING.gemini_flash.outputPerToken;
    const ttsCost = Number(r.tts_chars) * PRICING.tts.perChar;
    return {
      email: r.email,
      name: r.name,
      llmCalls: r.llm_calls,
      ttsCalls: r.tts_calls,
      llmCost,
      ttsCost,
      totalCost: llmCost + ttsCost,
    };
  });

  res.json({ costs });
}));

// GET /api/admin/feedback — recent user feedback
app.get('/api/admin/feedback', requireAdmin as express.RequestHandler, asyncHandler(async (_req: any, res) => {
  const { rows } = await pool.query(`
    SELECT a.id, u.email, u.name, a.detail, a.created_at
    FROM activity_log a
    JOIN users u ON u.id = a.user_id
    WHERE a.action = 'feedback'
    ORDER BY a.created_at DESC
    LIMIT 100
  `);
  res.json({ feedback: rows });
}));

// DELETE /api/admin/feedback/:id — delete a feedback entry
app.delete('/api/admin/feedback/:id', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  await pool.query(`DELETE FROM activity_log WHERE id = $1 AND action = 'feedback'`, [req.params.id]);
  res.json({ ok: true });
}));

// GET /api/admin/settings — read all app settings
app.get('/api/admin/settings', requireAdmin as express.RequestHandler, asyncHandler(async (_req: any, res) => {
  const settings = await getAppSettings();
  res.json({ settings });
}));

// PUT /api/admin/settings — upsert a single setting
app.put('/api/admin/settings', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { key, value } = req.body;
  if (!key || typeof key !== 'string' || typeof value !== 'string') {
    return res.status(400).json({ error: 'Missing key or value' });
  }
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
    [key, value]
  );
  invalidateSettingsCache();
  logActivity(req.userId, 'admin_setting_change', { detail: `${key}=${value}` });
  res.json({ ok: true });
}));

// POST /api/admin/test-tts — test a TTS voice name without saving
app.post('/api/admin/test-tts', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { languageCode, voiceName, text, provider } = req.body;
  if (!languageCode || !voiceName) return res.status(400).json({ error: 'Missing languageCode or voiceName' });

  const settings = await getAppSettings();
  const ttsProvider = provider || 'google';

  const { key: azureKey, region: azureRegion } = getAzureCredentials(settings);

  try {
    if (ttsProvider === 'azure') {
      if (!azureKey) {
        return res.status(400).json({ error: 'Azure TTS key not configured. Set it in Admin > TTS Settings or as AZURE_TTS_KEY env variable.' });
      }
      const base64Audio = await azureTts(text || 'Hello', voiceName, languageCode, azureKey, azureRegion);
      res.json({ audio: base64Audio });
    } else {
      if (!ttsClient) {
        return res.status(503).json({ error: 'Google TTS service not configured. Check GOOGLE_CLOUD_TTS_CREDENTIALS env variable.' });
      }

      const request = {
        input: { text: text || 'Hello' },
        voice: { languageCode, name: voiceName },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 },
      } as any;

      const result = await ttsClient.synthesizeSpeech(request);
      const response = Array.isArray(result) ? result[0] : result;
      let audioContent = response.audioContent as Buffer;
      if (audioContent.length > 44 && audioContent.toString('ascii', 0, 4) === 'RIFF') {
        audioContent = audioContent.slice(44);
      }
      res.json({ audio: audioContent.toString('base64') });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errorRegion = ttsProvider === 'azure' ? azureRegion : undefined;
    console.error(`[test-tts] provider=${ttsProvider} voice=${voiceName} lang=${languageCode}${errorRegion ? ` region=${errorRegion}` : ''} error:`, msg);
    res.status(500).json({
      error: msg,
      detail: { provider: ttsProvider, voice: voiceName, languageCode, ...(errorRegion && { region: errorRegion }) },
    });
  }
}));

// GET /api/admin/promo-sources — list all promo sources with user counts
app.get('/api/admin/promo-sources', requireAdmin as express.RequestHandler, asyncHandler(async (_req: any, res) => {
  const { rows } = await pool.query(`
    SELECT ps.*, COALESCE(uc.cnt, 0)::int AS user_count
    FROM promo_sources ps
    LEFT JOIN (SELECT source_code, COUNT(*)::int AS cnt FROM users WHERE source_code IS NOT NULL GROUP BY source_code) uc
      ON uc.source_code = ps.code
    ORDER BY ps.created_at DESC
  `);
  res.json({ sources: rows });
}));

// POST /api/admin/promo-sources — create a new promo source
app.post('/api/admin/promo-sources', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name is required' });
  const code = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const { rows } = await pool.query(
    `INSERT INTO promo_sources (code, name, description) VALUES ($1, $2, $3) RETURNING *`,
    [code, name, description || null]
  );
  logActivity(req.userId, 'admin_promo_create', { detail: `${code}: ${name}` });
  res.json({ source: rows[0] });
}));

// DELETE /api/admin/promo-sources/:id — delete a promo source
app.delete('/api/admin/promo-sources/:id', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  await pool.query('DELETE FROM promo_sources WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// GET /api/admin/users/:id/shares — list shared lessons by user
app.get('/api/admin/users/:id/shares', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { rows } = await pool.query(
    `SELECT id, workspace_name, text_language, share_source, created_at
     FROM shared_lessons WHERE creator_user_id=$1 ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json({ shares: rows });
}));

// GET /api/admin/shares — list all shared lessons with creator info
app.get('/api/admin/shares', requireAdmin as express.RequestHandler, asyncHandler(async (_req: any, res) => {
  const { rows } = await pool.query(`
    SELECT sl.id, sl.workspace_name, sl.text_language, sl.share_source, sl.created_at,
           u.name AS creator_name, u.email AS creator_email,
           u.preferences->>'explanationLanguage' AS explanation_language
    FROM shared_lessons sl
    LEFT JOIN users u ON u.id = sl.creator_user_id
    ORDER BY sl.created_at DESC
  `);
  res.json({ shares: rows });
}));

// DELETE /api/admin/shared/:id — delete a shared lesson
app.delete('/api/admin/shared/:id', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  await pool.query('DELETE FROM shared_lessons WHERE id=$1', [req.params.id]);
  logActivity(req.userId, 'admin_delete_share', { detail: req.params.id });
  res.json({ ok: true });
}));

// POST /api/admin/api-keys — create a new API key (returns the raw key once)
app.post('/api/admin/api-keys', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const { name } = req.body;
  const rawKey = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  await pool.query('INSERT INTO api_keys (key_hash, name) VALUES ($1, $2)', [keyHash, name || 'default']);
  logActivity(req.userId, 'admin_create_api_key', { detail: name || 'default' });
  res.json({ key: rawKey, name: name || 'default' });
}));

// GET /api/admin/api-keys — list API keys (without raw keys)
app.get('/api/admin/api-keys', requireAdmin as express.RequestHandler, asyncHandler(async (_req: any, res) => {
  const { rows } = await pool.query('SELECT id, name, created_at FROM api_keys ORDER BY created_at DESC');
  res.json(rows);
}));

// DELETE /api/admin/api-keys/:id — revoke an API key
app.delete('/api/admin/api-keys/:id', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  await pool.query('DELETE FROM api_keys WHERE id=$1', [req.params.id]);
  logActivity(req.userId, 'admin_delete_api_key', { detail: req.params.id });
  res.json({ ok: true });
}));

// GET /api/admin/cost-log?start=YYYY-MM-DD&end=YYYY-MM-DD — CSV export of
// every LLM/TTS activity row in the range, with a computed cost_usd column
// derived from PRICING_USD_PER_1M. Streams row-by-row to handle large ranges
// without buffering the whole result set in node memory.
app.get('/api/admin/cost-log', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const start = String(req.query.start || '').trim();
  const end = String(req.query.end || '').trim();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(start) || !dateRe.test(end)) {
    return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' });
  }
  if (start > end) {
    return res.status(400).json({ error: 'start must be <= end' });
  }
  // Guard against runaway exports
  const startMs = Date.parse(start + 'T00:00:00Z');
  const endMs = Date.parse(end + 'T00:00:00Z');
  if (endMs - startMs > 366 * 86400_000) {
    return res.status(400).json({ error: 'Range must be <= 366 days' });
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cost-log-${start}-to-${end}.csv"`);
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  res.write('id,created_at,user_id,action,provider,model,language,input_units,output_units,cost_usd,duration_ms,device,detail\n');

  // Build the end-of-range as UTC midnight of (end + 1 day) in JS, so the
  // query is a plain timestamp comparison — portable across pg and pg-mem.
  const startUtc = new Date(startMs).toISOString();
  const endExclusiveUtc = new Date(endMs + 86400_000).toISOString();
  const query = `
    SELECT id, created_at, user_id, action, provider, model, language,
           input_units, output_units, duration_ms, device, detail
    FROM activity_log
    WHERE created_at >= $1 AND created_at < $2
    ORDER BY created_at
  `;
  const { rows } = await pool.query(query, [startUtc, endExclusiveUtc]);
  for (const row of rows) {
    const cost = estimateCostUsd(row.provider, row.model, row.input_units, row.output_units);
    res.write([
      esc(row.id),
      esc((row.created_at as Date)?.toISOString?.() ?? row.created_at),
      esc(row.user_id),
      esc(row.action),
      esc(row.provider),
      esc(row.model),
      esc(row.language),
      esc(row.input_units),
      esc(row.output_units),
      cost > 0 ? cost.toFixed(8) : '0',
      esc(row.duration_ms),
      esc(row.device),
      esc(row.detail),
    ].join(',') + '\n');
  }
  res.end();
}));

// GET /api/admin/monitoring — dashboard KPIs, time series, breakdowns
app.get('/api/admin/monitoring', requireAdmin as express.RequestHandler, asyncHandler(async (req: any, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  const since = `NOW() - INTERVAL '${days} days'`;
  const source = req.query.source as string | undefined;

  // Optional source filter: restrict to users from a specific promo source
  const userFilter = source ? `AND u.source_code = '${source.replace(/'/g, "''").slice(0, 8)}'` : '';
  const userIds = source ? `(SELECT id FROM users u WHERE u.source_code = '${source.replace(/'/g, "''").slice(0, 8)}')` : null;
  const actFilter = userIds ? `AND a.user_id IN ${userIds}` : '';

  const [summary, subscriptions, daily, features, devices] = await Promise.all([
    // 1. Summary KPIs
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users u WHERE 1=1 ${userFilter}) AS total_users,
        (SELECT COUNT(DISTINCT a.user_id)::int FROM activity_log a WHERE a.created_at >= ${since} ${actFilter}) AS active_users,
        (SELECT COUNT(*)::int FROM users u WHERE u.created_at >= ${since} ${userFilter}) AS new_users,
        (SELECT COUNT(*)::int FROM activity_log a WHERE a.action='explain' AND a.created_at >= ${since} ${actFilter}) AS total_explains,
        (SELECT COUNT(*)::int FROM activity_log a WHERE a.action='tts_request' AND a.created_at >= ${since} ${actFilter}) AS total_tts,
        (SELECT COUNT(*)::int FROM activity_log a WHERE a.action='generate_text' AND a.created_at >= ${since} ${actFilter}) AS total_generates
    `),
    // 2. Subscription breakdown
    pool.query(`
      SELECT COALESCE(subscription_status, 'free') AS status, COUNT(*)::int AS count
      FROM users u WHERE 1=1 ${userFilter} GROUP BY subscription_status ORDER BY count DESC
    `),
    // 3. Daily time series (no gaps)
    pool.query(`
      WITH days AS (
        SELECT d::date AS day FROM generate_series(
          (NOW() - INTERVAL '${days} days')::date,
          CURRENT_DATE,
          '1 day'
        ) d
      )
      SELECT
        days.day,
        COALESCE(reg.cnt, 0)::int AS new_users,
        COALESCE(ex.cnt, 0)::int AS explains,
        COALESCE(tts.cnt, 0)::int AS tts,
        COALESCE(gen.cnt, 0)::int AS generates
      FROM days
      LEFT JOIN (SELECT u.created_at::date AS day, COUNT(*) AS cnt FROM users u WHERE u.created_at >= ${since} ${userFilter} GROUP BY 1) reg ON reg.day = days.day
      LEFT JOIN (SELECT a.created_at::date AS day, COUNT(*) AS cnt FROM activity_log a WHERE a.action='explain' AND a.created_at >= ${since} ${actFilter} GROUP BY 1) ex ON ex.day = days.day
      LEFT JOIN (SELECT a.created_at::date AS day, COUNT(*) AS cnt FROM activity_log a WHERE a.action='tts_request' AND a.created_at >= ${since} ${actFilter} GROUP BY 1) tts ON tts.day = days.day
      LEFT JOIN (SELECT a.created_at::date AS day, COUNT(*) AS cnt FROM activity_log a WHERE a.action='generate_text' AND a.created_at >= ${since} ${actFilter} GROUP BY 1) gen ON gen.day = days.day
      ORDER BY days.day
    `),
    // 4. Feature breakdown
    pool.query(`
      SELECT a.action, COUNT(*)::int AS count
      FROM activity_log a WHERE a.created_at >= ${since} ${actFilter}
      GROUP BY a.action ORDER BY count DESC
    `),
    // 5. Device breakdown
    pool.query(`
      SELECT COALESCE(a.device, 'unknown') AS device, COUNT(*)::int AS count
      FROM activity_log a WHERE a.created_at >= ${since} ${actFilter}
      GROUP BY a.device ORDER BY count DESC
    `)
  ]);

  res.json({
    summary: summary.rows[0],
    subscriptions: subscriptions.rows,
    daily: daily.rows,
    features: features.rows,
    devices: devices.rows,
  });
}));

// #9 — Global error middleware for unhandled async errors (must be after all routes)
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Share link redirect — works in both dev and production
app.get('/s/:code', (req, res) => {
  // Forward an incoming sso= so the SPA's bootstrap effect can adopt the
  // courses-issued identity before processing the share import. Token TTL
  // (120s) is well over the redirect → SPA-load window so this is safe.
  const sso = req.query.sso ? `&sso=${encodeURIComponent(String(req.query.sso))}` : '';
  // Forward the originating courses lesson path so the back-link can return
  // the user there (the SPA bootstrap stashes it; openInCourses sends it back).
  const from = req.query.from ? `&from=${encodeURIComponent(String(req.query.from))}` : '';
  // Forward courses' resolved colour scheme so the new tab paints in the
  // same theme without a flash. Bootstrap validates 'light' | 'dark' only.
  const theme = req.query.theme ? `&theme=${encodeURIComponent(String(req.query.theme))}` : '';
  res.redirect(302, `/app?import=${encodeURIComponent(req.params.code)}${sso}${from}${theme}`);
});

if (process.env.NODE_ENV === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(__dirname, 'dist')));
  // Serve guide.html for clean /guide URL
  app.get('/guide', (_req, res) =>
    res.sendFile(path.join(__dirname, 'dist', 'guide.html')));
  app.get('*', (_req, res) =>
    res.sendFile(path.join(__dirname, 'dist', 'index.html')));
}

// Export for testing
export { app, pool, initDb };

let server: ReturnType<typeof app.listen>;

// Cleanup expired anonymous users every 6 hours
async function cleanupAnonymousUsers() {
  try {
    // Delete expired anonymous sessions
    await pool.query(`
      DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='anonymous') AND expires_at <= NOW()
    `);
    // Collect orphaned anonymous user IDs (no active sessions left), then delete all related data
    const { rows: orphans } = await pool.query(
      `SELECT id FROM users WHERE role='anonymous' AND id NOT IN (SELECT user_id FROM sessions)`
    );
    if (orphans.length === 0) return;
    const orphanIds = orphans.map(r => r.id);
    await pool.query(`DELETE FROM workspace_state WHERE workspace_id IN (SELECT id FROM workspaces WHERE user_id = ANY($1))`, [orphanIds]);
    await Promise.all([
      pool.query(`DELETE FROM workspaces WHERE user_id = ANY($1)`, [orphanIds]),
      pool.query(`DELETE FROM daily_usage WHERE user_id = ANY($1)`, [orphanIds]),
      pool.query(`DELETE FROM activity_log WHERE user_id = ANY($1)`, [orphanIds]),
    ]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [orphanIds]);
  } catch (err) {
    console.error('Anonymous cleanup error:', err);
  }
}

if (!process.env.VITEST) {
  initDb().then(() => {
    const port = process.env.PORT || process.env.SERVER_PORT || 4000;
    server = app.listen(port, () => console.log(`Server running on :${port}`));
    // Run cleanup on start and every 6 hours
    cleanupAnonymousUsers();
    setInterval(cleanupAnonymousUsers, CLEANUP_INTERVAL_MS);
    // Verify TTS voice catalog in the background — non-blocking so the
    // server starts answering requests immediately. GET /api/tts/voices
    // returns [] until this finishes.
    verifyTtsVoiceCatalog().catch(err => console.error('[tts-voices] verification crashed:', err));
  }).catch(err => {
    console.error('Failed to init DB:', err);
    process.exit(1);
  });
}

// #16 — Graceful shutdown: close server + drain DB pool
function gracefulShutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully...`);
  if (server) {
    server.close(() => {
      pool.end().then(() => {
        console.log('DB pool closed');
        process.exit(0);
      }).catch(() => process.exit(1));
    });
    // Force exit after 10s if connections don't drain
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, SERVER_TIMEOUTS.GRACEFUL_SHUTDOWN);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
