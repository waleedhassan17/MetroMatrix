import { appendFileSync } from 'fs';
import type request from 'supertest';

/**
 * Off unless RESPONSE_PROBE_LOG is set: records a few real `data` payloads per
 * route (JSON lines) — by default the admin and auth routes, the samples the
 * admin response DTOs were checked against; RESPONSE_PROBE_PREFIXES (a comma
 * list, e.g. `/admin/,/food/vendor/kitchen/`) picks others. Never part of a
 * normal run.
 */
const seen = new Map<string, number>();
const PER_ROUTE = 4;
const prefixes = () =>
  (process.env.RESPONSE_PROBE_PREFIXES ?? '/admin/,/auth/')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

export function probeResponse(
  method: string,
  path: string,
  routeOf: (p: string) => string,
  r: request.Test,
): request.Test {
  const out = process.env.RESPONSE_PROBE_LOG;
  if (!out || !prefixes().some((p) => path.startsWith(p))) {
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
