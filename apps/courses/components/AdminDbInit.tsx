'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api-client';

interface Response {
  ok?: boolean;
  tables?: string[];
  error?: string;
  message?: string;
  code?: string;
}

// Admin-only "apply schema" button. Posts to /api/admin/db-init, which
// runs the SCHEMA_SQL from lib/db-schema.ts against the live DATABASE_URL.
// The schema is idempotent (every CREATE … IF NOT EXISTS) so re-runs are
// safe — clicking again after a future schema change is the standard flow.
export function AdminDbInit() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Response | null>(null);

  const run = async () => {
    setPending(true);
    setResult(null);
    try {
      const r = await apiFetch<Response>('/api/admin/db-init', { method: 'POST' });
      setResult(r.data ?? { error: `HTTP ${r.status}` });
    } catch (e) {
      setResult({ error: String((e as Error).message ?? e) });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold tracking-tight">Database schema</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Apply <code>SCHEMA_SQL</code> (the same statements as <code>npm run db:init</code>).
        Every statement is <code>CREATE … IF NOT EXISTS</code>, so re-running is safe.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className={
            'px-4 py-2 rounded-md text-sm font-medium transition-colors ' +
            (pending
              ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700')
          }
        >
          {pending ? 'Applying…' : 'Apply schema'}
        </button>
        {result?.ok && result.tables && (
          <span className="text-xs text-green-600 dark:text-green-400">
            ✓ Tables: {result.tables.join(', ')}
          </span>
        )}
        {result?.error && (
          <span className="text-xs text-red-600 dark:text-red-400">
            {result.error}
            {result.message && ` — ${result.message}`}
          </span>
        )}
      </div>
    </section>
  );
}
