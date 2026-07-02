// Shared PostgreSQL connection pool for BOTH apps (courses + tutor).
//
// Extracted from the two legacy implementations (glottos-courses `web/lib/db.ts`
// and text-tutor `server.ts`), which were byte-for-byte the same idea: a lazily
// instantiated singleton `pg.Pool` with a workaround for DigitalOcean Managed
// Postgres' self-signed CA. `process.env.DATABASE_URL` is read on first use so a
// dev hot-reload picks up changes without a restart.
//
// The two apps now point at ONE database, so they share ONE pool per process.

import { Pool, type PoolConfig } from 'pg';

let _pool: Pool | null = null;

/** Default pool sizing — the tutor server's (larger) config wins; courses only
 *  ever used max:10 and is unaffected by a higher ceiling. */
const DEFAULTS = {
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

export function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  // pg-connection-string parses `sslmode=require` as `verify-full`, which
  // rejects DO Managed Postgres' self-signed CA (SELF_SIGNED_CERT_IN_CHAIN).
  // Strip sslmode from the URL and set ssl explicitly: TLS stays on, CA
  // validation off. (Identical workaround in both legacy apps.)
  const sslmodeMatch = url.match(/[?&]sslmode=(require|prefer|verify-ca|verify-full)/);
  const cleanUrl = sslmodeMatch
    ? url.replace(/[?&]sslmode=[^&]+/g, '').replace(/\?$/, '').replace(/\?&/, '?')
    : url;

  const config: PoolConfig = { connectionString: cleanUrl, ...DEFAULTS };
  if (sslmodeMatch) {
    config.ssl = { rejectUnauthorized: false };
  }

  _pool = new Pool(config);
  return _pool;
}

/** Close the shared pool (graceful shutdown). Safe to call when no pool exists. */
export async function closePool(): Promise<void> {
  if (_pool) {
    const p = _pool;
    _pool = null;
    await p.end();
  }
}
