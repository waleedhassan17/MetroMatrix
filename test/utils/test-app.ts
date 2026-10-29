import { randomUUID } from 'crypto';
import { appendFileSync } from 'fs';
import { INestApplication, Type } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MailService } from '../../src/modules/mail/mail.service';
import { CapturingMailService } from './outbox';
import { probeResponse } from './response-probe';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<INestApplication['getHttpServer']>;
  ds: DataSource;
  /** With `listen: true`: the base URL (sockets connect to `${url}/food`). */
  url?: string;
  close(): Promise<void>;
}

/**
 * The real AppModule, configured by the same configureApp() as main.ts.
 *
 * `controllers` registers test-only controllers (never shipped — there are no
 * debug routes in any environment). `override` swaps providers, e.g. the mail
 * outbox or the Google verifier.
 */
export async function createTestApp(
  opts: {
    controllers?: Type<unknown>[];
    override?: (b: TestingModuleBuilder) => TestingModuleBuilder;
    /** Listen on a random local port (Socket.IO tests need a real server). */
    listen?: boolean;
  } = {},
): Promise<TestApp> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: opts.controllers ?? [],
  })
    // Emails land in the in-memory outbox (test/utils/outbox.ts).
    .overrideProvider(MailService)
    .useClass(CapturingMailService);
  if (opts.override) builder = opts.override(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  let url: string | undefined;
  if (opts.listen) {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    url = `http://127.0.0.1:${address.port}`;
  } else await app.init();
  const http = app.getHttpServer();
  const ds = app.get(DataSource);
  return {
    app,
    http,
    ds,
    url,
    close: async () => {
      try {
        await verifyAdminAudits(http, ds);
      } finally {
        await app.close();
      }
    },
  };
}

// ── The audit probe ─────────────────────────────────────────────────────────
//
// "Every admin write writes exactly one audit row" is checked in every suite:
// each admin write an ApiClient sends carries its own X-Request-Id, and when
// the suite closes its app, every one that succeeded must have exactly one
// audit row with that id — written by the service itself, not by the
// AdminAuditInterceptor's fallback — carrying the changed fields before and
// after. (/admin/me/totp/* are the admin's own sign-in steps, audited as
// auth.* events.)

interface AdminWrite {
  id: string;
  method: string;
  path: string;
  status?: number;
}

const adminWrites = new WeakMap<object, AdminWrite[]>();

function probeAdminWrite(
  http: object,
  method: string,
  path: string,
  r: request.Test,
): request.Test {
  if (method === 'GET' || !path.startsWith('/admin/')) return r;
  if (path.startsWith('/admin/me/totp/')) return r;
  const write: AdminWrite = { id: `audit-${randomUUID()}`, method, path };
  const list = adminWrites.get(http) ?? [];
  adminWrites.set(http, list);
  list.push(write);
  r.on('response', (res: { status: number }) => {
    write.status = res.status;
  });
  return r.set('X-Request-Id', write.id);
}

/** `/admin/shop/products/<uuid>/remove` → `/admin/shop/products/:id/remove`. */
const routeOf = (path: string) =>
  path
    .split('?')[0]
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      ':id',
    )
    .replace(/\/[A-Z]{2}-[A-Z0-9]{5,}(?=\/|$)/g, '/:code');

async function verifyAdminAudits(http: object, ds: DataSource) {
  const writes = (adminWrites.get(http) ?? []).filter(
    (w) => w.status !== undefined && w.status >= 200 && w.status < 300,
  );
  adminWrites.delete(http);
  if (!writes.length) return;
  const rows: Array<{
    request_id: string;
    action: string;
    n: number;
    changes: boolean;
  }> = await ds.query(
    `SELECT request_id, min(action) AS action, count(*)::int AS n,
              bool_and(before IS NOT NULL OR after IS NOT NULL) AS changes
         FROM operational_audit_events WHERE request_id = ANY($1)
        GROUP BY request_id`,
    [writes.map((w) => w.id)],
  );
  const byId = new Map(rows.map((r) => [r.request_id, r]));
  const problems: string[] = [];
  for (const w of writes) {
    const row = byId.get(w.id);
    const route = `${w.method} ${routeOf(w.path)}`;
    if (!row) problems.push(`${route}: no audit row`);
    else if (row.n !== 1) problems.push(`${route}: ${row.n} audit rows`);
    else if (/^admin\.[A-Z]/.test(row.action)) {
      problems.push(`${route}: only the interceptor's fallback row`);
    } else if (!row.changes) {
      problems.push(`${route}: no before/after (${row.action})`);
    }
    if (process.env.AUDIT_PROBE_LOG) {
      appendFileSync(
        process.env.AUDIT_PROBE_LOG,
        `${JSON.stringify({ route, action: row?.action ?? null, n: row?.n ?? 0 })}\n`,
      );
    }
  }
  if (problems.length) {
    throw new Error(
      `Admin writes must write exactly one audit row of their own:\n  ${[...new Set(problems)].join('\n  ')}`,
    );
  }
}

let ipCounter = 0;
/**
 * A fresh client address. The throttler keys on req.ip (trust proxy 1 →
 * X-Forwarded-For), so each simulated client gets its own rate-limit bucket.
 */
export function nextIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/** A simulated client: its own IP, optionally a bearer token. */
export class ApiClient {
  readonly ip = nextIp();
  token?: string;
  /** Sent with every request (X-Request-Id, Origin, X-Client, …). */
  headers: Record<string, string> = {};

  constructor(private readonly http: TestApp['http']) {}

  private with(r: request.Test, method: string, path: string): request.Test {
    r = probeAdminWrite(this.http, method, path, r);
    r = probeResponse(method, path, routeOf, r);
    r = r.set('X-Forwarded-For', this.ip);
    for (const [k, v] of Object.entries(this.headers)) r = r.set(k, v);
    return this.token ? r.set('Authorization', `Bearer ${this.token}`) : r;
  }

  get(path: string) {
    return this.with(request(this.http).get(`/api/v1${path}`), 'GET', path);
  }
  post(path: string, body?: object) {
    return this.with(
      request(this.http).post(`/api/v1${path}`),
      'POST',
      path,
    ).send(body ?? {});
  }
  patch(path: string, body?: object) {
    return this.with(
      request(this.http).patch(`/api/v1${path}`),
      'PATCH',
      path,
    ).send(body ?? {});
  }
  put(path: string, body?: object) {
    return this.with(
      request(this.http).put(`/api/v1${path}`),
      'PUT',
      path,
    ).send(body ?? {});
  }
  delete(path: string, body?: object) {
    return this.with(
      request(this.http).delete(`/api/v1${path}`),
      'DELETE',
      path,
    ).send(body ?? {});
  }
}
