/**
 * Idempotent schema applier. Runs SCHEMA_SQL from lib/db-schema.ts against
 * $DATABASE_URL. Safe to re-run: every statement is CREATE … IF NOT EXISTS.
 *
 *   DATABASE_URL=... npm run db:init
 *
 * Production runtime image doesn't include tsx or this scripts/ folder.
 * To apply the same schema in production, POST to /api/admin/db-init from
 * an admin session — it runs the identical SCHEMA_SQL against the live DB.
 */
import { Client } from 'pg';
import { SCHEMA_SQL } from '../lib/db-schema';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(SCHEMA_SQL);
    const { rows } = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    console.log('Tables in public schema:');
    for (const r of rows) console.log(`  - ${r.tablename}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
