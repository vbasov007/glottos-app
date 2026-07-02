import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  // Class-based dark mode. The single source of truth is `<html class="dark">`,
  // set/cleared by ThemeProvider per user preference (light / dark / system).
  // System mode resolves the OS preference into the same class — we never rely
  // on @media in Tailwind itself, which keeps the manual switch authoritative.
  //
  // Inside Telegram the bridge also sets/clears the same class, so a Telegram
  // user in dark mode gets dark Tailwind variants automatically.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        rank: {
          knappe: '#9ca3af',
          ritter: '#60a5fa',
          baron: '#a78bfa',
          graf: '#f472b6',
          koenig: '#fbbf24',
        },
      },
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
