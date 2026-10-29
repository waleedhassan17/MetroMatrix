import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The committed openapi.json (npm run openapi:export) is the web console's
 * contract. Every admin operation, and every auth operation the console
 * calls, documents its success body — so the generated types are real.
 */
describe('openapi.json', () => {
  const doc = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'openapi.json'), 'utf8'),
  ) as {
    paths: Record<
      string,
      Record<
        string,
        {
          operationId: string;
          responses: Record<string, { content?: unknown }>;
        }
      >
    >;
  };
  const ops = Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({ path, method, op })),
  );
  const CONSOLE_AUTH = [
    'post /api/v1/auth/signin',
    'post /api/v1/auth/admin/totp',
    'get /api/v1/auth/me',
    'post /api/v1/auth/change-password',
    'post /api/v1/auth/web/refresh',
    'post /api/v1/auth/web/logout',
    'post /api/v1/admin/me/totp/enrol',
    'post /api/v1/admin/me/totp/confirm',
    'get /api/v1/config',
  ];
  const documented = (o: (typeof ops)[number]) =>
    Object.entries(o.op.responses).some(
      ([status, r]) => status.startsWith('2') && !!r.content,
    );

  it('every admin operation has a 2xx response schema', () => {
    const admin = ops.filter((o) => o.path.startsWith('/api/v1/admin/'));
    expect(admin.length).toBeGreaterThan(110);
    expect(
      admin.filter((o) => !documented(o)).map((o) => `${o.method} ${o.path}`),
    ).toEqual([]);
  });

  it('so does every auth operation the console calls', () => {
    for (const key of CONSOLE_AUTH) {
      const [method, path] = key.split(' ');
      const o = ops.find((x) => x.method === method && x.path === path);
      expect(o && documented(o) ? key : `${key} (missing)`).toBe(key);
    }
  });

  it('operation ids are unique', () => {
    const ids = ops.map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
