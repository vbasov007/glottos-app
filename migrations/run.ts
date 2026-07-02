// Tiny migration runner: applies every migrations/*.sql (sorted) against the
// unified database in DATABASE_URL. Idempotent — the SQL is all CREATE ... IF
// NOT EXISTS, so re-running is safe. Usage: npm run db:init
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '@glottos/shared';

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Point it at the unified database.');
    process.exit(1);
  }
  const files = readdirSync(here)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    console.error('No .sql migrations found in', here);
    process.exit(1);
  }
  const pool = getPool();
  for (const f of files) {
    const sql = readFileSync(join(here, f), 'utf8');
    process.stdout.write(`Applying ${f} ... `);
    await pool.query(sql);
    console.log('ok');
  }
  await closePool();
  console.log(`Applied ${files.length} migration file(s).`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
