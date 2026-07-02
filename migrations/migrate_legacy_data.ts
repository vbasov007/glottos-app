// =====================================================================
// migrate_legacy_data.ts — import users + product data from BOTH legacy
// databases into the unified schema, with identity deduplication.
//
//   Reads:  DATABASE_URL_COURSES_SRC  (legacy glottos-courses DB)
//           DATABASE_URL_TUTOR_SRC    (legacy text-tutor DB)
//   Writes: DATABASE_URL              (the unified DB; must already have the
//                                       001_unified_schema.sql applied)
//
//   Modes:  --dry-run   print exactly what WOULD be merged/imported, write nothing
//           (default)   perform the import (idempotent: ON CONFLICT DO NOTHING,
//                        so re-running never duplicates or overwrites)
//
// SAFETY: this script only ever READS from the two legacy sources and only ever
// WRITES to the unified target. It never drops, truncates, or updates the legacy
// databases. Existing rows in the target are never overwritten (DO NOTHING; the
// users upsert only fills gaps via COALESCE).
//
// The identity/dedup logic is the pure, unit-tested `resolveIdentities` from
// @glottos/shared (see packages/shared/test/dedup.test.ts).
//   Run:  npm run migrate:legacy -- --dry-run
//         npm run migrate:legacy
// =====================================================================

import { Pool } from 'pg';
import { resolveIdentities, type LegacyUserLike, type UnifiedUser } from '@glottos/shared';

const DRY_RUN = process.argv.includes('--dry-run');

function makePool(url: string | undefined, label: string): Pool {
  if (!url) {
    console.error(`Missing env for ${label}. Set it to the legacy ${label} connection string.`);
    process.exit(1);
  }
  const clean = url.replace(/[?&]sslmode=[^&]*/g, '');
  const ssl = /sslmode=(require|verify)/.test(url) ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString: clean, ssl, max: 5 });
}

interface TableCopy {
  table: string;
  target: string;
  userCols: string[];
  dropCols?: string[]; // e.g. SERIAL id — let the target sequence assign
  globalConflict?: string; // conflict target for global (non-user) tables
}

async function main() {
  console.log(`\n=== migrate_legacy_data ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE)'} ===\n`);
  const srcCourses = makePool(process.env.DATABASE_URL_COURSES_SRC, 'COURSES');
  const srcTutor = makePool(process.env.DATABASE_URL_TUTOR_SRC, 'TUTOR');
  const dst = makePool(process.env.DATABASE_URL, 'UNIFIED TARGET');

  // ---- Load legacy users ------------------------------------------------
  const coursesUsers = (await srcCourses.query('SELECT * FROM users')).rows as LegacyUserLike[];
  const tutorUsers = (await srcTutor.query('SELECT * FROM users')).rows as LegacyUserLike[];
  console.log(`Loaded ${coursesUsers.length} courses users, ${tutorUsers.length} tutor users.`);

  // ---- Deduplicate identities (pure, shared logic) ----------------------
  const { unifieds, coursesRemap, tutorRemap, mergedCount } = resolveIdentities(
    coursesUsers,
    tutorUsers,
  );
  console.log(
    `\nIdentity resolution:\n` +
      `  unified users:        ${unifieds.length}\n` +
      `  present in BOTH apps: ${mergedCount}  (deduplicated to one account each)\n` +
      `  courses-only:         ${unifieds.filter((u) => u.fromCourses && !u.fromTutor).length}\n` +
      `  tutor-only:           ${unifieds.filter((u) => u.fromTutor && !u.fromCourses).length}`,
  );

  // ---- Product-table import plan ----------------------------------------
  const coursesTables: TableCopy[] = [
    { table: 'sessions', target: 'sessions', userCols: ['user_id'] },
    { table: 'progress', target: 'courses_progress', userCols: ['user_id'] },
    { table: 'daily_activity', target: 'courses_daily_activity', userCols: ['user_id'] },
    { table: 'settings', target: 'courses_settings', userCols: [], globalConflict: 'key' },
  ];
  const tutorTables: TableCopy[] = [
    { table: 'sessions', target: 'sessions', userCols: ['user_id'] },
    { table: 'user_state', target: 'user_state', userCols: ['user_id'] },
    { table: 'workspaces', target: 'workspaces', userCols: ['user_id'] },
    { table: 'workspace_state', target: 'workspace_state', userCols: [] },
    { table: 'activity_log', target: 'activity_log', userCols: ['user_id'], dropCols: ['id'] },
    { table: 'daily_usage', target: 'daily_usage', userCols: ['user_id'] },
    { table: 'app_settings', target: 'app_settings', userCols: [], globalConflict: 'key' },
    { table: 'promo_sources', target: 'promo_sources', userCols: [], dropCols: ['id'], globalConflict: 'code' },
    { table: 'shared_lessons', target: 'shared_lessons', userCols: ['creator_user_id'] },
    { table: 'api_keys', target: 'api_keys', userCols: [], globalConflict: 'key_hash' },
    { table: 'flashcard_decks', target: 'flashcard_decks', userCols: ['user_id'] },
    { table: 'flashcard_deck_cards', target: 'flashcard_deck_cards', userCols: [] },
    { table: 'srs_card_state', target: 'srs_card_state', userCols: ['user_id'] },
    { table: 'srs_deck_sched', target: 'srs_deck_sched', userCols: ['user_id'] },
    { table: 'srs_card_sched', target: 'srs_card_sched', userCols: ['user_id'] },
  ];

  // ---- Users upsert -----------------------------------------------------
  if (DRY_RUN) {
    console.log(`\n[dry-run] would upsert ${unifieds.length} users into "users".`);
    unifieds
      .filter((u) => u.fromCourses && u.fromTutor)
      .slice(0, 10)
      .forEach((u) =>
        console.log(
          `   merge: ${u.row.email ?? '(no email)'} -> id=${u.id} ` +
            `(courses:${u.fromCourses} + tutor:${u.fromTutor})`,
        ),
      );
  } else {
    await upsertUsers(dst, unifieds);
    console.log(`\nUpserted ${unifieds.length} users.`);
  }

  // ---- Product data -----------------------------------------------------
  let totalRows = 0;
  for (const t of coursesTables) totalRows += await copyTable(srcCourses, dst, t, coursesRemap, 'courses');
  for (const t of tutorTables) totalRows += await copyTable(srcTutor, dst, t, tutorRemap, 'tutor');
  console.log(`\n${DRY_RUN ? '[dry-run] would import' : 'Imported'} ${totalRows} product rows total.`);

  await Promise.all([srcCourses.end(), srcTutor.end(), dst.end()]);
  console.log(`\n=== ${DRY_RUN ? 'DRY RUN complete — nothing written.' : 'Migration complete.'} ===\n`);
}

async function upsertUsers(dst: Pool, unifieds: UnifiedUser[]) {
  const cols = [
    'id', 'email', 'name', 'picture', 'role', 'preferences', 'created_at',
    'active_workspace_id', 'google_sub', 'telegram_id', 'source_code',
    'stripe_customer_id', 'subscription_status', 'subscription_id',
    'subscription_period_end', 'cancel_at_period_end',
  ];
  for (const u of unifieds) {
    const vals = cols.map((c) => u.row[c] ?? null);
    const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
    // Merge on conflict: fill gaps only, never blow away existing target data.
    const setClause = cols
      .filter((c) => c !== 'id')
      .map((c) => `${c} = COALESCE(users.${c}, EXCLUDED.${c})`)
      .join(', ');
    await dst.query(
      `INSERT INTO users (${cols.join(', ')}) VALUES (${ph})
       ON CONFLICT (id) DO UPDATE SET ${setClause}`,
      vals,
    );
  }
}

/** Copy one legacy table into the target, remapping user-id columns onto the
 *  unified ids and skipping rows whose user can't be resolved. Idempotent. */
async function copyTable(
  src: Pool,
  dst: Pool,
  spec: TableCopy,
  remap: Map<string, string>,
  label: string,
): Promise<number> {
  let rows: Record<string, any>[];
  try {
    rows = (await src.query(`SELECT * FROM ${spec.table}`)).rows;
  } catch (err: any) {
    console.warn(`  [${label}] skip ${spec.table}: ${err.message}`);
    return 0;
  }
  if (rows.length === 0) return 0;

  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const out: Record<string, any> = { ...row };
    for (const dc of spec.dropCols ?? []) delete out[dc];
    let resolvable = true;
    for (const uc of spec.userCols) {
      if (out[uc] == null) continue;
      const mapped = remap.get(String(out[uc]));
      if (!mapped) {
        resolvable = false;
        break;
      }
      out[uc] = mapped;
    }
    if (!resolvable) {
      skipped++;
      continue;
    }
    if (DRY_RUN) {
      imported++;
      continue;
    }
    const cols = Object.keys(out);
    const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
    const onConflict = spec.globalConflict
      ? `ON CONFLICT (${spec.globalConflict}) DO NOTHING`
      : `ON CONFLICT DO NOTHING`;
    try {
      const r = await dst.query(
        `INSERT INTO ${spec.target} (${cols.join(', ')}) VALUES (${ph}) ${onConflict}`,
        cols.map((c) => out[c]),
      );
      imported += r.rowCount ?? 0;
    } catch (err: any) {
      skipped++;
      if (skipped <= 3) console.warn(`  [${label}] ${spec.target} row error: ${err.message}`);
    }
  }
  const verb = DRY_RUN ? 'would import' : 'imported';
  console.log(
    `  [${label}] ${spec.table} -> ${spec.target}: ${verb} ${imported}` +
      (skipped ? `, skipped ${skipped}` : ''),
  );
  return imported;
}

main().catch((err) => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
