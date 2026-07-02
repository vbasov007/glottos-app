'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram, type TelegramWebApp } from '../components/TelegramProvider';

interface ClaimState {
  visible: boolean;
  onClick: () => void;
}

interface Claim {
  id: number;
  state: ClaimState;
}

const claims: Claim[] = [];
let nextId = 1;
let activeWebApp: TelegramWebApp | null = null;
let activeHandler: (() => void) | null = null;

function topClaim(): Claim | null {
  return claims.length > 0 ? claims[claims.length - 1]! : null;
}

function apply(): void {
  const wa = activeWebApp;
  if (!wa) return;
  const top = topClaim();
  if (activeHandler) {
    try {
      wa.BackButton.offClick(activeHandler);
    } catch {
      /* ignore */
    }
    activeHandler = null;
  }
  if (!top || !top.state.visible) {
    try {
      wa.BackButton.hide();
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    activeHandler = () => top.state.onClick();
    wa.BackButton.onClick(activeHandler);
    wa.BackButton.show();
  } catch {
    /* ignore */
  }
}

interface Props {
  visible: boolean;
  /** Defaults to router.back(). Override only when you need a custom action
   *  (e.g. closing a sub-panel without unwinding the route). */
  onClick?: () => void;
}

/**
 * Show / hide Telegram's BackButton and wire it to a callback. Without an
 * explicit onClick, falls back to Next.js router.back(). Inert outside
 * Telegram.
 *
 * The locale layout mounts this once and toggles `visible` based on
 * pathname — visible on every page except the course landing.
 */
export function useTelegramBackButton(props: Props): void {
  const { isTma, webApp } = useTelegram();
  const router = useRouter();
  const idRef = useRef<number | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!isTma || !webApp) return;
    activeWebApp = webApp;
    const id = nextId++;
    idRef.current = id;
    claims.push({
      id,
      state: {
        visible: props.visible,
        onClick: () => {
          const cb = propsRef.current.onClick;
          if (cb) cb();
          else router.back();
        },
      },
    });
    apply();
    return () => {
      const idx = claims.findIndex((c) => c.id === id);
      if (idx >= 0) claims.splice(idx, 1);
      idRef.current = null;
      apply();
      if (claims.length === 0) activeWebApp = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTma, webApp]);

  useEffect(() => {
    const id = idRef.current;
    if (id == null) return;
    const c = claims.find((x) => x.id === id);
    if (!c) return;
    c.state = {
      visible: props.visible,
      onClick: () => {
        const cb = propsRef.current.onClick;
        if (cb) cb();
        else router.back();
      },
    };
    if (topClaim()?.id === id) apply();
  }, [props.visible, router]);
}
