/** Frontend magic numbers extracted from App.tsx — behaviour-preserving refactor. */

export const TIMEOUTS = {
  /** Toast notification auto-dismiss */
  TOAST: 5000,
  /** Debounce delay before auto-saving workspace state */
  AUTO_SAVE_DEBOUNCE: 800,
  /** Abort TTS fetch if server doesn't respond */
  TTS_FETCH: 12_000,
  /** Debounce after a read-all speed change before re-fetching at the new speed,
   *  so rapid clicks can settle on the chosen speed before any TTS is requested */
  SPEED_SWITCH_DEBOUNCE: 700,
  /** Delay before closing hover menus (workspace / user) */
  MENU_HOVER_CLOSE: 200,
  /** Polling interval for shared-lesson import progress */
  POLLING_INTERVAL: 3000,
  /** iOS audio context fix — wait for pending onended */
  IOS_AUDIO_FIX: 300,
  /** Delay before retrying workspace state prefetch */
  STATE_PREFETCH_DELAY: 2000,
  /** Delay before showing the "unsaved" indicator */
  UNSAVED_WARNING: 1500,
  /** Subscription status polling interval after Stripe redirect */
  SUBSCRIPTION_POLL: 2000,
  /** Hover dwell before showing the explained-word/phrase translation tooltip (desktop only) */
  HOVER_TOOLTIP_DELAY: 1000,
  /** Window during which a card deletion can be undone before the network DELETE flushes */
  CARD_DELETE_UNDO: 5000,
};

/** Page size for the Review Decks card list. Small enough that each page
 *  comfortably fits a phone screen without scrolling past the deck panel. */
export const CARDS_PER_PAGE = 10;
