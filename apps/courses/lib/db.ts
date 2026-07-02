// The Postgres pool now lives in `@glottos/shared` (one pool, one database,
// shared by both apps). This file re-exports it so the many `import { getPool }
// from '@/lib/db'` call sites across this app keep working unchanged.
export { getPool, closePool } from '@glottos/shared';
