#!/usr/bin/env tsx
/**
 * One-shot migration: rename progress.course_key rows from the legacy 2-part
 * format (`target.native`, e.g. "de.ru") to the post-refactor 3-part format
 * (`course.target.native`, e.g. "classic50.de.ru"). All pre-refactor rows
 * belong to the classic50 course, so the prefix is unconditional.
 *
 * Safety:
 *   - Counts old / new rows up front and prints them.
 *   - DRY_RUN=1 prints what would change without writing.
 *   - Handles UNIQUE (user_id, course_key) conflicts: if a row already exists
 *     for `classic50.de.ru` (e.g. user opened the app after the refactor
 *     pushed but before this migration), the legacy row is deleted rather
 *     than renamed — the new row was written by the migrated client and is
 *     the authoritative one.
 */
import { Pool } from 'pg';

function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sslmodeMatch = url.match(/[?&]sslmode=/);
  const cleanUrl = sslmodeMatch
    ? url.replace(/[?&]sslmode=[^&]+/g, '').replace(/\?$/, '').replace(/\?&/, '?')
    : url;
  return new Pool({
    connectionString: cleanUrl,
    max: 4,
    ssl: sslmodeMatch ? { rejectUnauthorized: false } : undefined,
  });
}

const LEGACY_PATTERN = /^[a-z]{2,8}\.[a-z]{2,8}$/;

async function main() {
  const pool = getPool();
  const dryRun = process.env.DRY_RUN === '1';

  // 1. Survey.
  const { rows: all } = await pool.query<{ course_key: string; n: string }>(
    `SELECT course_key, COUNT(*)::text AS n
     FROM progress
     GROUP BY course_key
     ORDER BY course_key`,
  );
  console.log('Current course_key distribution:');
  for (const r of all) console.log(`  ${r.course_key.padEnd(28)} ${r.n}`);

  const legacyKeys = all.filter((r) => LEGACY_PATTERN.test(r.course_key));
  if (legacyKeys.length === 0) {
    console.log('\nNo legacy 2-part keys found. Nothing to migrate.');
    await pool.end();
    return;
  }
  console.log(`\nLegacy keys to migrate (${legacyKeys.length}):`);
  for (const r of legacyKeys) console.log(`  ${r.course_key} → classic50.${r.course_key}  (${r.n} rows)`);

  if (dryRun) {
    console.log('\nDRY_RUN=1 — no writes.');
    await pool.end();
    return;
  }

  // 2. Transaction: per legacy key, find conflicting rows and delete them,
  //    then rename the rest.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let renamed = 0;
    let deletedConflicts = 0;
    for (const r of legacyKeys) {
      const oldKey = r.course_key;
      const newKey = `classic50.${oldKey}`;
      // Delete legacy rows whose user already has a row at the new key — the
      // migrated client overwrote/wrote fresh state there and that wins.
      const { rowCount: conflictCount } = await client.query(
        `DELETE FROM progress
         WHERE course_key = $1
           AND user_id IN (SELECT user_id FROM progress WHERE course_key = $2)`,
        [oldKey, newKey],
      );
      deletedConflicts += conflictCount ?? 0;
      // Rename the rest.
      const { rowCount: renameCount } = await client.query(
        `UPDATE progress SET course_key = $2 WHERE course_key = $1`,
        [oldKey, newKey],
      );
      renamed += renameCount ?? 0;
      console.log(
        `  ${oldKey.padEnd(10)} → ${newKey.padEnd(22)}` +
          `  renamed=${renameCount ?? 0}, deleted-conflicts=${conflictCount ?? 0}`,
      );
    }
    await client.query('COMMIT');
    console.log(`\nDone. Renamed ${renamed} rows, deleted ${deletedConflicts} conflicts.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
