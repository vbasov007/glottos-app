// Minimal structured logger shared by both apps' server-side code. Both legacy
// apps just used console.* with ad-hoc prefixes; this keeps that behaviour but
// gives a single import so the shape is consistent across the monorepo.

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, msg: string, data?: unknown): void {
  const line = `[${scope}] ${msg}`;
  if (level === 'error') console.error(line, data ?? '');
  else if (level === 'warn') console.warn(line, data ?? '');
  else console.log(line, data ?? '');
}

export const log = {
  info: (scope: string, msg: string, data?: unknown) => emit('info', scope, msg, data),
  warn: (scope: string, msg: string, data?: unknown) => emit('warn', scope, msg, data),
  error: (scope: string, msg: string, data?: unknown) => emit('error', scope, msg, data),
};
