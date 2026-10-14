import { ApiClient, createTestApp, TestApp } from './utils/test-app';

describe('Health + envelope (e2e)', () => {
  let t: TestApp;
  let api: ApiClient;

  beforeAll(async () => {
    t = await createTestApp();
    api = new ApiClient(t.http);
  });
  afterAll(() => t.close());

  it('GET /health → enveloped { status: ok, db: up, version }', async () => {
    const res = await api.get('/health').expect(200);
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ok', db: 'up', version: expect.any(String) },
    });
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('unknown route → 404 NOT_FOUND error envelope', async () => {
    const res = await api.get('/nope').expect(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });

  it('echoes a well-formed X-Request-Id and replaces a malformed one', async () => {
    const ok = await api.get('/health').set('X-Request-Id', 'abc-123');
    expect(ok.headers['x-request-id']).toBe('abc-123');
    const bad = await api.get('/health').set('X-Request-Id', 'x'.repeat(300));
    expect(bad.headers['x-request-id']).not.toBe('x'.repeat(300));
  });
});
