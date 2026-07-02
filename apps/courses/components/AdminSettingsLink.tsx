'use client';

import Link from 'next/link';
import { useSession } from './SessionProvider';

// Renders nothing for non-admin users (or while the session is still
// settling). On the page it appears as a single linked card; the actual
// authorization decision is owned by /admin (AdminGate) and by any
// admin API routes — this is purely a discoverability affordance.
export function AdminSettingsLink() {
  const { user, ready } = useSession();
  if (!ready || !user || user.role !== 'admin') return null;
  return (
    <Link
      href="/admin"
      className="block rounded-md border border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 mt-6"
    >
      Admin →
    </Link>
  );
}
