'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { useSession } from './SessionProvider';
import { Spinner } from './Spinner';

interface Props {
  children: ReactNode;
}

// Client-side admin gate. Sessions live in localStorage, not cookies, so
// server components can't validate the user — this component handles the
// gating at render time. Sensitive admin actions still go through API
// routes that re-check the role server-side from the X-Session-Id header.
export function AdminGate({ children }: Props) {
  const { user, ready } = useSession();

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500">
        <Spinner size={20} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="py-12 text-sm text-zinc-600 dark:text-zinc-400">
        <p>You must be signed in to access this page.</p>
        <p className="mt-2">
          <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline">
            Go to sign-in →
          </Link>
        </p>
      </div>
    );
  }

  if (user.role !== 'admin') {
    return (
      <div className="py-12 text-sm text-zinc-600 dark:text-zinc-400">
        <p>This area is for administrators only.</p>
        <p className="mt-2">
          <Link
            href="/"
            className="inline-flex items-center min-h-[32px] -my-1 text-blue-600 dark:text-blue-400 hover:underline"
          >
            Back to home →
          </Link>
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
