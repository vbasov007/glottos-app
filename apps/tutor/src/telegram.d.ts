// Minimal ambient types for the Telegram WebApp surface we touch.
// Full SDK at https://core.telegram.org/bots/webapps — types kept narrow on
// purpose; widen as we adopt more features (theme params, MainButton, etc.).
export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        platform: string;
        ready: () => void;
        expand: () => void;
        openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
      };
    };
  }
}
