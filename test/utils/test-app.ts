import { INestApplication, Type } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MailService } from '../../src/modules/mail/mail.service';
import { CapturingMailService } from './outbox';

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
  return {
    app,
    http: app.getHttpServer(),
    ds: app.get(DataSource),
    url,
    close: () => app.close(),
  };
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

  constructor(private readonly http: TestApp['http']) {}

  private with(r: request.Test): request.Test {
    r = r.set('X-Forwarded-For', this.ip);
    return this.token ? r.set('Authorization', `Bearer ${this.token}`) : r;
  }

  get(path: string) {
    return this.with(request(this.http).get(`/api/v1${path}`));
  }
  post(path: string, body?: object) {
    return this.with(request(this.http).post(`/api/v1${path}`)).send(
      body ?? {},
    );
  }
  patch(path: string, body?: object) {
    return this.with(request(this.http).patch(`/api/v1${path}`)).send(
      body ?? {},
    );
  }
  put(path: string, body?: object) {
    return this.with(request(this.http).put(`/api/v1${path}`)).send(body ?? {});
  }
  delete(path: string, body?: object) {
    return this.with(request(this.http).delete(`/api/v1${path}`)).send(
      body ?? {},
    );
  }
}
