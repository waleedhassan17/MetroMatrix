import { appendFileSync } from 'fs';
import type request from 'supertest';

/**
 * Off unless RESPONSE_PROBE_LOG is set: records a few real `data` payloads per
 * admin route (JSON lines), the samples the admin response DTOs were checked
 * against. Never part of a normal run.
 */
const seen = new Map<string, number>();
const PER_ROUTE = 4;

export function probeResponse(
  method: string,
  path: string,
  routeOf: (p: string) => string,
  r: request.Test,
): request.Test {
  const out = process.env.RESPONSE_PROBE_LOG;
  if (!out || !(path.startsWith('/admin/') || path.startsWith('/auth/'))) {
    return r;
  }
  const route = `${method} ${routeOf(path)}`;
  r.on('response', (res: { status: number; body?: { data?: unknown } }) => {
    if (res.status < 200 || res.status >= 300) return;
    const n = seen.get(route) ?? 0;
    if (n >= PER_ROUTE) return;
    seen.set(route, n + 1);
    appendFileSync(
      out,
      `${JSON.stringify({ route, status: res.status, data: res.body?.data ?? null })}\n`,
    );
  });
  return r;
}
