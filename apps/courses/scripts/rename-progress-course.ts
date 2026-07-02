#!/usr/bin/env tsx
/**
 * Generic course-slug rename for the progress table.
 *
 * Renames every row whose course_key has the form `<from-course>.<target>.<native>`
 * to `<to-course>.<target>.<native>`. Handles UNIQUE (user_id, course_key)
 * conflicts via a configurable policy.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/rename-progress-course.ts \
 *     --from-course=classic50 \
 *     --to-course=classic50_v2 \
 *     [--target=de] [--native=ru] \
 *     [--user=<user-id>] \
 *     [--on-conflict=newer|src|dst|error]
 *
 *   DRY_RUN=1 prints what would change without writing.
 *
 * Conflict policy (default: newer):
 *   - newer: keep whichever row has the newer updated_at; delete the other.
 *   - src:   source row wins → delete dst, rename src.
 *   - dst:   destination row wins → delete src, no rename.
 *   - error: abort the entire transaction if any conflict exists.
 *
 * The script runs inside one transaction. On any error it rolls back, so the
 * DB ends up either fully migrated or untouched.
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

interface Args {
  fromCourse: string;
  toCourse: string;
  target?: string;
  native?: string;
  user?: string;
  onConflict: 'newer' | 'src' | 'dst' | 'error';
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : undefined;
  };
  const fromCourse = get('from-course');
  const toCourse = get('to-course');
  if (!fromCourse || !toCourse) {
    throw new Error('Missing --from-course=… and/or --to-course=…');
  }
  if (fromCourse === toCourse) {
    throw new Error('--from-course and --to-course must differ');
  }
  const SLUG_RE = /^[a-z0-9_-]{3,32}$/;
  if (!SLUG_RE.test(fromCourse) || !SLUG_RE.test(toCourse)) {
    throw new Error('Course slugs must match /^[a-z0-9_-]{3,32}$/');
  }
  const onConflict = (get('on-conflict') ?? 'newer') as Args['onConflict'];
  if (!['newer', 'src', 'dst', 'error'].includes(onConflict)) {
    throw new Error(`Invalid --on-conflict=${onConflict}`);
  }
  return {
    fromCourse,
    toCourse,
    target: get('target'),
    native: get('native'),
    user: get('user'),
    onConflict,
  };
}

interface ProgressRow {
  user_id: string;
  course_key: string;
  updated_at: Date;
}

async function main() {
  const args = parseArgs();
  const dryRun = process.env.DRY_RUN === '1';
  const pool = getPool();

  // Build the WHERE clause for the survey + the rename.
  // course_key matches `<from>.<target>.<native>` exactly; optional --target /
  // --native narrow it further. The `<from>` is escaped with a literal dot
  // in the LIKE pattern so course slugs containing regex chars stay safe.
  const fromPrefix = `${args.fromCourse}.`;
  const fromTargetPart = args.target ? `${args.target}.` : '%';
  const fromNativePart = args.native ?? '%';
  // We use 3 LIKE segments because LIKE doesn't support alternation; the
  // narrowing is built up by concatenation.
  const likePattern =
    args.target && args.native
      ? `${fromPrefix}${args.target}.${args.native}`
      : args.target
        ? `${fromPrefix}${args.target}.%`
        : args.native
          ? `${fromPrefix}%.${args.native}`
          : `${fromPrefix}%`;

  const userFilterSQL = args.user ? 'AND user_id = $2' : '';
  const userFilterParams = args.user ? [args.user] : [];

  console.log('Rename plan');
  console.log(`  --from-course=${args.fromCourse}`);
  console.log(`  --to-course=${args.toCourse}`);
  if (args.target) console.log(`  --target=${args.target}`);
  if (args.native) console.log(`  --native=${args.native}`);
  if (args.user) console.log(`  --user=${args.user}`);
  console.log(`  --on-conflict=${args.onConflict}`);
  console.log(`  LIKE pattern: ${likePattern}`);
  console.log(`  DRY_RUN=${dryRun ? '1' : '0'}`);
  console.log('');

  // 1. Survey rows that would be touched.
  const { rows: srcRows } = await pool.query<ProgressRow>(
    `SELECT user_id, course_key, updated_at
     FROM progress
     WHERE course_key LIKE $1 ${userFilterSQL}
     ORDER BY course_key, user_id`,
    [likePattern, ...userFilterParams],
  );
  if (srcRows.length === 0) {
    console.log('No matching source rows. Nothing to do.');
    await pool.end();
    return;
  }
  console.log(`Found ${srcRows.length} source rows to rename:`);
  const srcByKey = new Map<string, number>();
  for (const r of srcRows) srcByKey.set(r.course_key, (srcByKey.get(r.course_key) ?? 0) + 1);
  for (const [k, n] of [...srcByKey.entries()].sort()) {
    console.log(`  ${k.padEnd(40)} ${n} rows`);
  }
  console.log('');

  // 2. Detect conflicts: pairs of (user_id, dstKey) that already exist.
  const dstKeys = srcRows.map((r) => `${args.toCourse}.${r.course_key.slice(fromPrefix.length)}`);
  const conflictParams: unknown[] = [];
  const placeholders: string[] = [];
  for (let i = 0; i < srcRows.length; i++) {
    conflictParams.push(srcRows[i]!.user_id, dstKeys[i]!);
    placeholders.push(`($${conflictParams.length - 1}, $${conflictParams.length})`);
  }
  const { rows: conflicts } = await pool.query<ProgressRow>(
    `SELECT user_id, course_key, updated_at
     FROM progress
     WHERE (user_id, course_key) IN (${placeholders.join(', ')})`,
    conflictParams,
  );
  const conflictSet = new Map<string, ProgressRow>(); // key = `${user_id}|${course_key}`
  for (const c of conflicts) {
    conflictSet.set(`${c.user_id}|${c.course_key}`, c);
  }
  if (conflicts.length > 0) {
    console.log(`Conflicts (destination row already exists for ${conflicts.length} user(s)):`);
    for (const c of conflicts) {
      const srcRow = srcRows.find(
        (s) =>
          s.user_id === c.user_id &&
          `${args.toCourse}.${s.course_key.slice(fromPrefix.length)}` === c.course_key,
      )!;
      const srcNewer = srcRow.updated_at > c.updated_at;
      console.log(
        `  user=${c.user_id.slice(0, 8)}…  ${srcRow.course_key} → ${c.course_key}` +
          `  src=${srcRow.updated_at.toISOString()}` +
          `  dst=${c.updated_at.toISOString()}` +
          `  ${srcNewer ? '(src newer)' : '(dst newer)'}`,
      );
    }
    if (args.onConflict === 'error') {
      console.log('\nAborting per --on-conflict=error.');
      await pool.end();
      process.exit(1);
    }
    console.log(`Policy: ${args.onConflict}`);
    console.log('');
  } else {
    console.log('No conflicts.\n');
  }

  if (dryRun) {
    console.log('DRY_RUN=1 — no writes.');
    await pool.end();
    return;
  }

  // 3. Execute. One transaction so we either fully succeed or roll back.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let renamed = 0;
    let deletedSrc = 0;
    let deletedDst = 0;

    for (let i = 0; i < srcRows.length; i++) {
      const src = srcRows[i]!;
      const dstKey = dstKeys[i]!;
      const conflict = conflictSet.get(`${src.user_id}|${dstKey}`);

      if (!conflict) {
        // No conflict — straight rename.
        await client.query(
          `UPDATE progress SET course_key = $3
           WHERE user_id = $1 AND course_key = $2`,
          [src.user_id, src.course_key, dstKey],
        );
        renamed++;
        continue;
      }

      // Conflict resolution.
      let action: 'rename' | 'delete-src' | 'delete-dst';
      if (args.onConflict === 'newer') {
        action = src.updated_at > conflict.updated_at ? 'delete-dst' : 'delete-src';
      } else if (args.onConflict === 'src') {
        action = 'delete-dst';
      } else {
        action = 'delete-src';
      }

      if (action === 'delete-src') {
        await client.query(
          `DELETE FROM progress WHERE user_id = $1 AND course_key = $2`,
          [src.user_id, src.course_key],
        );
        deletedSrc++;
      } else {
        // delete-dst — then rename src into its place.
        await client.query(
          `DELETE FROM progress WHERE user_id = $1 AND course_key = $2`,
          [src.user_id, dstKey],
        );
        deletedDst++;
        await client.query(
          `UPDATE progress SET course_key = $3
           WHERE user_id = $1 AND course_key = $2`,
          [src.user_id, src.course_key, dstKey],
        );
        renamed++;
      }
    }

    await client.query('COMMIT');
    console.log(
      `Done. Renamed=${renamed}, deleted-src=${deletedSrc}, deleted-dst=${deletedDst}.`,
    );
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
