/**
 * Mobile UI audit. Spins up a Playwright Chromium against the local dev
 * server, mints a demo session via direct DB insert (sidestepping the GSI
 * silent sign-in we can't drive headless), and visits every page.tsx at
 * four mobile-relevant viewport widths.
 *
 * Per route + width, captures a full-page PNG and runs two mechanical
 * checks:
 *
 *   1. Horizontal scroll: documentElement.scrollWidth > window.innerWidth.
 *      This is the "no horizontal scroll" requirement from the audit
 *      brief — any failure means SOMETHING is wider than the viewport.
 *
 *   2. Small tap targets: every visible interactive element (button, a,
 *      input, …) whose width OR height is below 32px. iOS's HIG calls
 *      for 44pt; 32px is a looser bar that catches "obviously too small"
 *      without spurious failures on inline icons.
 *
 * Outputs:
 *   web/.mobile-audit/<width>/<slug>.png
 *   web/.mobile-audit/report.json
 *
 * Usage:
 *   DATABASE_URL=postgres://… npm run audit:mobile
 *
 * Pre-requirements:
 *   - dev server running at http://localhost:3000 (npm run dev)
 *   - chromium installed: npm run audit:mobile:install
 *   - postgres reachable via DATABASE_URL with the schema applied
 *     (npm run db:init)
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../lib/db';
import { SESSION_TTL_DAYS } from '../lib/auth';

// ---- Configuration --------------------------------------------------------

const BASE_URL = process.env.AUDIT_BASE_URL ?? 'http://localhost:3000';
const WIDTHS = [320, 375, 414, 768] as const;
const HEIGHT = 800;

// 11-route surface from the Phase 1 plan. /<target>/<native> hardcoded to
// de/en so we exercise the locale layout without exploding the matrix
// across every (target, native) pair.
const ROUTES: { slug: string; path: string; needsAuth: boolean }[] = [
  { slug: 'landing', path: '/', needsAuth: false },
  { slug: 'target-de', path: '/de', needsAuth: false },
  { slug: 'course-list', path: '/de/en', needsAuth: false },
  { slug: 'course-intro', path: '/de/en/classic50/intro', needsAuth: false },
  { slug: 'dashboard', path: '/de/en/dashboard/classic50', needsAuth: true },
  { slug: 'dictionary', path: '/de/en/dictionary', needsAuth: false },
  { slug: 'settings', path: '/de/en/settings', needsAuth: true },
  { slug: 'lesson', path: '/de/en/lesson/classic50/1', needsAuth: false },
  { slug: 'lesson-vocab', path: '/de/en/lesson/classic50/1#vocabulary', needsAuth: true },
  { slug: 'text', path: '/de/en/text/classic50/1', needsAuth: false },
  { slug: 'test', path: '/de/en/test/classic50/1', needsAuth: true },
  { slug: 'admin', path: '/admin', needsAuth: true },
];

// Selector matching every "interactive" element worth measuring. Excludes
// elements explicitly opted out of focus (tabindex=-1) and skip-links.
const INTERACTIVE_SELECTOR =
  'button, a[href], input:not([type="hidden"]), select, textarea, ' +
  '[role="button"], [role="link"], [role="tab"], [tabindex]:not([tabindex="-1"])';

const MIN_TAP_PX = 32;

// ---- Types ----------------------------------------------------------------

interface SmallTarget {
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

interface RouteFinding {
  slug: string;
  path: string;
  width: number;
  status: number;
  loadMs: number;
  documentScrollWidth: number;
  viewportWidth: number;
  horizontalScroll: boolean;
  viewportMeta: string | null;
  smallTargets: SmallTarget[];
  errors: string[];
}

interface Report {
  generatedAt: string;
  baseUrl: string;
  routes: RouteFinding[];
  summary: {
    totalChecks: number;
    horizontalScrollFails: number;
    smallTargetFails: number;
    httpFails: number;
    consoleErrors: number;
  };
}

// ---- Demo session helper --------------------------------------------------

async function mintDemoSession(email: string): Promise<{ sessionId: string; userId: string }> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set — needed to mint a demo session');
  }
  const pool = getPool();
  // Stable user id keyed on email — re-running the audit reuses the same
  // demo account so progress / settings accumulate naturally.
  const userId = 'demo-' + email.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const name = 'Audit Demo';
  await pool.query(
    `INSERT INTO users (id, email, name, picture, role)
     VALUES ($1, $2, $3, NULL, 'user')
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           name  = EXCLUDED.name`,
    [userId, email, name],
  );
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await pool.query(
    'INSERT INTO sessions (session_id, user_id, expires_at) VALUES ($1, $2, $3)',
    [sessionId, userId, expiresAt],
  );
  return { sessionId, userId };
}

// ---- Per-page checks ------------------------------------------------------

async function probeRoute(
  page: Page,
  route: { slug: string; path: string },
  width: number,
  baseUrl: string,
): Promise<RouteFinding> {
  const errors: string[] = [];
  const errorListener = (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 240));
  };
  page.on('console', errorListener);

  const t0 = Date.now();
  let status = 0;
  try {
    const resp = await page.goto(baseUrl + route.path, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    // resp can be null when navigation is a same-document hash change
    // (e.g. /lesson/.../1#vocabulary after we just visited /lesson/.../1).
    // Treat as a successful "navigation" — there's no HTTP request to grade.
    status = resp?.status() ?? (route.path.includes('#') ? 200 : 0);
  } catch (e) {
    errors.push(`navigation: ${(e as Error).message}`);
  }
  // Extra slack for SessionProvider's /api/me hydration + LessonTabs hash
  // routing (the `#vocabulary` path needs a `hashchange` to settle).
  await page.waitForTimeout(700);
  const loadMs = Date.now() - t0;

  const probe = await page.evaluate((minTap) => {
    const scrollWidth = document.documentElement.scrollWidth;
    const viewportWidth = window.innerWidth;
    const viewportMeta =
      document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null;

    const sel =
      'button, a[href], input:not([type="hidden"]), select, textarea, ' +
      '[role="button"], [role="link"], [role="tab"], [tabindex]:not([tabindex="-1"])';
    const smalls: { tag: string; text: string; rect: { x: number; y: number; width: number; height: number } }[] = [];
    const seenRects = new Set<string>();
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const he = el as HTMLElement;
      // Skip if hidden (display:none / visibility:hidden / no layout box).
      if (!he.offsetParent && he.tagName.toLowerCase() !== 'body') continue;
      const r = he.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width >= minTap && r.height >= minTap) continue;
      // Dedupe by position+size so we don't double-flag wrapping anchors.
      const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`;
      if (seenRects.has(key)) continue;
      seenRects.add(key);
      smalls.push({
        tag: he.tagName.toLowerCase() + (he.getAttribute('role') ? `[role=${he.getAttribute('role')}]` : ''),
        text: (he.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
      if (smalls.length >= 50) break; // cap per page
    }
    return { scrollWidth, viewportWidth, viewportMeta, smalls };
  }, MIN_TAP_PX);

  page.off('console', errorListener);

  return {
    slug: route.slug,
    path: route.path,
    width,
    status,
    loadMs,
    documentScrollWidth: probe.scrollWidth,
    viewportWidth: probe.viewportWidth,
    horizontalScroll: probe.scrollWidth - probe.viewportWidth > 1, // 1px tolerance
    viewportMeta: probe.viewportMeta,
    smallTargets: probe.smalls,
    errors,
  };
}

// ---- Main -----------------------------------------------------------------

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(here, '..', '.mobile-audit');
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  console.log(`[audit] base=${BASE_URL}`);
  console.log('[audit] minting demo session…');
  const { sessionId, userId } = await mintDemoSession('audit-demo@glottos.local');
  console.log(`[audit] session_id=${sessionId.slice(0, 8)}…  user_id=${userId}`);

  const browser: Browser = await chromium.launch();
  const findings: RouteFinding[] = [];

  for (const width of WIDTHS) {
    await fs.mkdir(path.join(outDir, String(width)), { recursive: true });
    const ctx = await browser.newContext({
      viewport: { width, height: HEIGHT },
      // The dev server's CSP / TMA detection both look at Sec-Fetch-Site
      // etc.; default Playwright headers are fine.
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();

    // Inject the session_id BEFORE the first real navigation so the very
    // first /api/me call already carries the right header (avoiding a
    // momentary "signed-out" flash that would pollute the screenshot).
    await page.goto(BASE_URL + '/_not_a_real_route_just_setting_storage', {
      waitUntil: 'domcontentloaded',
    }).catch(() => {});
    await page.evaluate(
      (sid) => window.localStorage.setItem('session_id', sid),
      sessionId,
    );

    for (const route of ROUTES) {
      process.stdout.write(`  [${width}px] ${route.slug} (${route.path})…`);
      const finding = await probeRoute(page, route, width, BASE_URL);
      findings.push(finding);
      try {
        await page.screenshot({
          path: path.join(outDir, String(width), `${route.slug}.png`),
          fullPage: true,
        });
      } catch (e) {
        finding.errors.push(`screenshot: ${(e as Error).message}`);
      }
      const flags = [
        finding.horizontalScroll ? `H-SCROLL(${finding.documentScrollWidth}>${finding.viewportWidth})` : '',
        finding.smallTargets.length > 0 ? `${finding.smallTargets.length}-small` : '',
        finding.status !== 200 ? `HTTP ${finding.status}` : '',
        finding.errors.length > 0 ? `${finding.errors.length}-err` : '',
      ].filter(Boolean).join(' ');
      process.stdout.write(` ${flags || 'ok'}\n`);
    }

    await ctx.close();
  }

  await browser.close();

  // ---- Report ------------------------------------------------------------
  const report: Report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    routes: findings,
    summary: {
      totalChecks: findings.length,
      horizontalScrollFails: findings.filter((r) => r.horizontalScroll).length,
      smallTargetFails: findings.filter((r) => r.smallTargets.length > 0).length,
      httpFails: findings.filter((r) => r.status !== 200).length,
      consoleErrors: findings.reduce((n, r) => n + r.errors.length, 0),
    },
  };
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  console.log('');
  console.log(`[audit] wrote ${findings.length} screenshots + report.json → ${outDir}`);
  console.log(`[audit] horizontal-scroll fails: ${report.summary.horizontalScrollFails}`);
  console.log(`[audit] small-target fails:      ${report.summary.smallTargetFails}`);
  console.log(`[audit] http fails:              ${report.summary.httpFails}`);
  console.log(`[audit] console errors:          ${report.summary.consoleErrors}`);

  // Print the per-route offender summary so reviewer doesn't have to open
  // report.json for the basics.
  const offenders = findings.filter(
    (r) => r.horizontalScroll || r.smallTargets.length > 0 || r.status !== 200,
  );
  if (offenders.length > 0) {
    console.log('');
    console.log('[audit] offenders:');
    for (const o of offenders) {
      const flags = [
        o.horizontalScroll ? `h-scroll +${o.documentScrollWidth - o.viewportWidth}px` : '',
        o.smallTargets.length > 0 ? `${o.smallTargets.length} small targets` : '',
        o.status !== 200 ? `HTTP ${o.status}` : '',
      ].filter(Boolean).join(', ');
      console.log(`  ${String(o.width).padStart(3)}px ${o.slug.padEnd(16)} ${flags}`);
    }
  }

  // Close the pg pool so the process exits cleanly.
  await (await import('../lib/db')).getPool().end();
}

main().catch((err) => {
  console.error('[audit] failed:', err);
  process.exit(1);
});
