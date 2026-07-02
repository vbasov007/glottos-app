import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminGate } from '../../components/AdminGate';
import { AdminTtsSettings } from '../../components/AdminTtsSettings';
import { AdminDbInit } from '../../components/AdminDbInit';

// Admin pages are intentionally outside the [target]/[native] tree — they're
// system-level, not per-course. No i18n: admin UI stays in English so we
// don't have to translate every internal toggle.

export const metadata: Metadata = {
  title: 'Admin · Glottos Matrix',
  // Don't let crawlers index the admin shell.
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between gap-2">
          <Link
            href="/"
            className="inline-flex items-center min-h-[36px] -my-1 font-semibold tracking-tight text-sm sm:text-base"
          >
            Glottos Matrix · Admin
          </Link>
          <Link
            href="/"
            className="inline-flex items-center min-h-[36px] -my-1 px-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Back
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">
        <AdminGate>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Admin</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            System-level settings.
          </p>
          <AdminTtsSettings />
          <AdminDbInit />
        </AdminGate>
      </main>
    </div>
  );
}
