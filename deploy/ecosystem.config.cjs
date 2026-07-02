// pm2 process manager config for the merged app: two Node processes behind the
// single nginx in deploy/nginx.conf. Start with:  pm2 start deploy/ecosystem.config.cjs
//
// Both processes read the SAME environment (one DATABASE_URL, one
// GOOGLE_CLIENT_ID, one SSO_SHARED_SECRET, ...). See deploy/.env.example.
// pm2 does not auto-load .env; export the vars (e.g. `set -a; . .env; set +a`)
// or use `pm2 start ... --env` / a process manager that sources it.

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'glottos-courses',
      cwd: path.join(ROOT, 'apps/courses'),
      // Next.js standalone server produced by `npm run build -w @glottos/courses`.
      script: '.next/standalone/apps/courses/server.js',
      env: {
        PORT: 8080,
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
        // basePath is baked in at build time (next.config.mjs default /courses).
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'glottos-tutor',
      cwd: path.join(ROOT, 'apps/tutor'),
      // tsx runs the Express server directly (it serves dist/ in production).
      script: 'node_modules/.bin/tsx',
      args: 'server.ts',
      env: {
        PORT: 4000,
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
    },
  ],
};
