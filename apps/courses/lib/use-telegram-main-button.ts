'use client';

import { useEffect, useRef } from 'react';
import { useTelegram, type TelegramWebApp } from '../components/TelegramProvider';

interface ClaimState {
  text: string;
  onClick: () => void;
  visible: boolean;
  enabled: boolean;
  showProgress: boolean;
}

interface Claim {
  id: number;
  state: ClaimState;
}

// Singleton claim stack. Multiple components may try to commandeer the
// MainButton simultaneously (e.g. AnswerInput's "Check" while LessonTabs
// publishes "Next"). Last claim to mount wins; on unmount we restore the
// claim below. Module-scoped because the Telegram MainButton itself is a
// process-wide singleton — owning the stack at module scope mirrors that.
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
      wa.MainButton.offClick(activeHandler);
    } catch {
      /* ignore — Telegram's offClick is lax */
    }
    activeHandler = null;
  }
  if (!top || !top.state.visible) {
    try {
      wa.MainButton.hide();
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    wa.MainButton.setText(top.state.text);
    if (top.state.enabled) wa.MainButton.enable();
    else wa.MainButton.disable();
    if (top.state.showProgress) wa.MainButton.showProgress(true);
    else wa.MainButton.hideProgress();
    activeHandler = () => top.state.onClick();
    wa.MainButton.onClick(activeHandler);
    wa.MainButton.show();
  } catch {
    /* ignore — older clients may lack some methods */
  }
}

interface Props {
  text: string;
  onClick: () => void;
  visible: boolean;
  enabled?: boolean;
  showProgress?: boolean;
}

/**
 * Bind a component to the Telegram MainButton — the prominent system button
 * that floats above the keyboard at the bottom of the WebView.
 *
 * Multiple hooks can be active simultaneously; the most recently mounted
 * wins. When the active claim unmounts, the previously-active hook's state
 * is restored. This is how AnswerInput's per-prompt "Check" coexists with
 * LessonTabs' tab-level "Next step".
 *
 * Inert outside Telegram (early-return on !isTma) so adding this hook
 * anywhere is safe regardless of context.
 */
export function useTelegramMainButton(props: Props): void {
  const { isTma, webApp } = useTelegram();
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
        text: props.text,
        onClick: () => propsRef.current.onClick(),
        visible: props.visible,
        enabled: props.enabled ?? true,
        showProgress: props.showProgress ?? false,
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
    // Mount/unmount lifecycle only; mutations are pushed via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTma, webApp]);

  useEffect(() => {
    const id = idRef.current;
    if (id == null) return;
    const c = claims.find((x) => x.id === id);
    if (!c) return;
    c.state = {
      text: props.text,
      onClick: () => propsRef.current.onClick(),
      visible: props.visible,
      enabled: props.enabled ?? true,
      showProgress: props.showProgress ?? false,
    };
    // Only re-apply if this claim is on top — bottom-of-stack updates would
    // overwrite the active claim's UI.
    if (topClaim()?.id === id) apply();
  }, [props.text, props.visible, props.enabled, props.showProgress]);
}
