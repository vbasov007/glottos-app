import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {execSync} from 'child_process';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return process.env.COMMIT_HASH || 'unknown';
  }
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const commitHash = getCommitHash();
  const buildTime = new Date().toISOString();
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GOOGLE_CLIENT_ID': JSON.stringify(env.GOOGLE_CLIENT_ID),
      'process.env.COMMIT_HASH': JSON.stringify(commitHash),
      'process.env.BUILD_TIME': JSON.stringify(buildTime),
      // Surface COURSES_URL (cross-app SSO target) as import.meta.env.VITE_COURSES_URL
      // for the openInCourses helper. Server-only SSO_SHARED_SECRET is NOT exposed.
      'import.meta.env.VITE_COURSES_URL': JSON.stringify(env.COURSES_URL || 'https://courses.glottos.com'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: `http://localhost:${env.SERVER_PORT || 4000}`,
          changeOrigin: true,
          timeout: 120000,
        },
      },
    },
  };
});
