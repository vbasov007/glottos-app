import Script from 'next/script';

/**
 * Loads Telegram's WebApp SDK. Outside Telegram it's a no-op (the SDK detects
 * `window.parent !== window` and only wires up when embedded), so we can load
 * it unconditionally for every visitor — script is ~6KB gzipped and behind
 * the long-term browser cache served by telegram.org.
 *
 * `beforeInteractive` puts the tag in <head> before hydration so the provider
 * sees `window.Telegram.WebApp` on its first render — no second-pass detection
 * needed.
 */
export function TelegramScript() {
  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="beforeInteractive"
    />
  );
}
