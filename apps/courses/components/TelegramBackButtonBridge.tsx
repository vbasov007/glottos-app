'use client';

import { usePathname } from 'next/navigation';
import { useTelegramBackButton } from '../lib/use-telegram-back-button';

/**
 * Toggles Telegram's BackButton based on the current pathname. The locale
 * layout mounts this once; everywhere outside the course landing
 * (`/<target>/<native>`) the back arrow is visible and fires
 * `router.back()`.
 *
 * Inert outside Telegram — the underlying hook short-circuits when
 * isTma=false.
 */
export function TelegramBackButtonBridge({
  target,
  native,
}: {
  target: string;
  native: string;
}) {
  const pathname = usePathname();
  // Visible everywhere except the course landing. Root `/` is not handled
  // here because the locale layout only renders below `/<target>/<native>/…`.
  const landing = `/${target}/${native}`;
  const visible = !!pathname && pathname !== landing && pathname !== `${landing}/`;
  useTelegramBackButton({ visible });
  return null;
}
