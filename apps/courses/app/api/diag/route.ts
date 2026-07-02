import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getPool } from '../../../lib/db';

export const runtime = 'nodejs';

function maskUrl(url: string): string {
  // Show enough to identify the value without leaking the password.
  // Format: protocol + user@host + ports + db-tail. Replace password chars with "***".
  try {
    const u = new URL(url);
    const safeAuth = u.username ? `${u.username}:***@` : '';
    const tail = u.pathname + (u.search || '');
    return `${u.protocol}//${safeAuth}${u.host}${tail}`;
  } catch {
    // Not a valid URL — show first 12 chars + last 8, asterisk the middle.
    if (url.length <= 25) return url;
    return `${url.slice(0, 12)}…[${url.length - 20} hidden]…${url.slice(-8)}`;
  }
}

// Surface what the server *actually* sees for DATABASE_URL and whether it can
// reach Postgres. Safe to call publicly — credentials are never returned.

function parseHost(url: string | undefined): {
  host: string | null;
  port: string | null;
  database: string | null;
  username: string | null;
  parseError?: string;
} {
  if (!url) return { host: null, port: null, database: null, username: null };
  try {
    const u = new URL(url);
    return {
      host: u.hostname || null,
      port: u.port || null,
      database: u.pathname.replace(/^\//, '') || null,
      username: u.username || null,
    };
  } catch (err) {
    return {
      host: null,
      port: null,
      database: null,
      username: null,
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(): Promise<NextResponse> {
  const dbUrl = process.env.DATABASE_URL;
  const parsed = parseHost(dbUrl);

  // Tell the caller whether the env var exists, what length it is, and whether
  // it parses to a sane host. Length helps spot whitespace/truncation issues.
  // Every env var that might influence the pg client. Helps spot duplicate
  // DATABASE_URL definitions, leftover PG* overrides, or weird namespacing.
  const dbEnvKeys = Object.keys(process.env)
    .filter((k) => /^(DATABASE|DB_|PG|POSTGRES|SQL)/.test(k))
    .sort();

  // Build ID lets us confirm WHICH deploy answered this request — if it's stale
  // the env var change hasn't propagated yet.
  let buildId: string | null = null;
  try {
    const manifestPath = path.join(process.cwd(), 'content', '.generated', 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { buildId?: string };
      buildId = m.buildId ?? null;
    }
  } catch {
    /* ignore */
  }

  const envInfo = {
    contentBuildId: buildId,
    DATABASE_URL_set: !!dbUrl,
    DATABASE_URL_length: dbUrl?.length ?? 0,
    DATABASE_URL_preview: dbUrl ? maskUrl(dbUrl) : null,
    parsedHost: parsed.host,
    parsedPort: parsed.port,
    parsedDatabase: parsed.database,
    parsedUsername: parsed.username,
    parseError: parsed.parseError ?? null,
    GOOGLE_CLIENT_ID_set: !!process.env.GOOGLE_CLIENT_ID,
    NODE_ENV: process.env.NODE_ENV,
    // Anything that might be misinterpreted by pg / gaxios as a proxy/fallback.
    HTTP_PROXY: process.env.HTTP_PROXY ?? null,
    HTTPS_PROXY: process.env.HTTPS_PROXY ?? null,
    NO_PROXY: process.env.NO_PROXY ?? null,
    PGHOST: process.env.PGHOST ?? null,
    PGPORT: process.env.PGPORT ?? null,
    PGUSER: process.env.PGUSER ?? null,
    dbRelatedEnvKeys: dbEnvKeys,
  };

  // Actual DB connection probe.
  let dbProbe: {
    ok: boolean;
    elapsedMs: number;
    error?: { name: string; message: string; code?: string; address?: string; port?: string };
    rowCount?: number;
  };
  const start = Date.now();
  try {
    const pool = getPool();
    const { rowCount } = await pool.query('SELECT 1 AS ok');
    dbProbe = { ok: true, elapsedMs: Date.now() - start, rowCount: rowCount ?? 0 };
  } catch (err) {
    const e = err as Error & { code?: string; address?: string; port?: string };
    dbProbe = {
      ok: false,
      elapsedMs: Date.now() - start,
      error: {
        name: e.name,
        message: e.message,
        code: e.code,
        address: e.address,
        port: e.port,
      },
    };
  }

  return NextResponse.json({ env: envInfo, dbProbe });
}
