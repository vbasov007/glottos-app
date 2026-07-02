import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

interface Health {
  ok: boolean;
  version: string;
  contentBuildId: string | null;
}

export function GET(): NextResponse<Health> {
  const manifestPath = path.join(process.cwd(), 'content', '.generated', 'manifest.json');
  let buildId: string | null = null;
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { buildId?: string };
      buildId = m.buildId ?? null;
    } catch {
      // ignore
    }
  }
  return NextResponse.json({
    ok: true,
    version: '0.1.0',
    contentBuildId: buildId,
  });
}
