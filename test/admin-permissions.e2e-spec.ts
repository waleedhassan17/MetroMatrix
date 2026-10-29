import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import {
  enrolledAdmin,
  limitedAdmin,
  plainRider,
  SignedInAdmin,
} from './utils/admin';
import { signup } from './utils/factories';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import {
  ADMIN_ANY_KEY,
  PERMISSIONS_KEY,
} from '../src/common/decorators/require-permission.decorator';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import {
  ADMIN_PERMISSION_KEYS,
  AdminPermission,
} from '../src/types/admin-permissions';

interface AdminRoute {
  method: string;
  path: string;
  roles: string[] | undefined;
  permissions: AdminPermission[] | undefined;
  adminAny: boolean;
  isPublic: boolean;
}

const UUID = '00000000-0000-4000-8000-000000000000';

/** Every route under /admin, read from the controllers Nest actually mounted. */
function adminRoutes(t: TestApp): AdminRoute[] {
  const routes: AdminRoute[] = [];
  const meta = <T>(key: string, ...targets: object[]): T | undefined => {
    for (const target of targets) {
      const v = Reflect.getMetadata(key, target);
      if (v !== undefined) return v as T;
    }
    return undefined;
  };
  for (const mod of t.app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (new (...a: never[]) => object) | null;
      if (!cls) continue;
      const bases = [Reflect.getMetadata(PATH_METADATA, cls)].flat();
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const handler = (cls.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler);
        if (sub === undefined) continue;
        const verb =
          RequestMethod[
            Reflect.getMetadata(METHOD_METADATA, handler) as number
          ];
        for (const base of bases) {
          for (const s of [sub].flat()) {
            const path = `/${[base, s].filter((p) => p && p !== '/').join('/')}`
              .replace(/\/+/g, '/')
              .replace(/\/$/, '');
            if (!path.startsWith('/admin/')) continue;
            routes.push({
              method: verb,
              path,
              roles: meta<string[]>(ROLES_KEY, handler, cls),
              permissions: meta<AdminPermission[]>(
                PERMISSIONS_KEY,
                handler,
                cls,
              ),
              adminAny: !!meta<boolean>(ADMIN_ANY_KEY, handler, cls),
              isPublic: !!meta<boolean>(IS_PUBLIC_KEY, handler, cls),
            });
          }
        }
      }
    }
  }
  return routes;
}

const concrete = (path: string) =>
  path.replace(/:(\w+)/g, (_, name: string) =>
    /code/i.test(name) ? 'ZZZZ9999' : UUID,
  );

function call(api: ApiClient, r: AdminRoute) {
  const path = concrete(r.path);
  switch (r.method) {
    case 'GET':
      return api.get(path);
    case 'POST':
      return api.post(path, {});
    case 'PATCH':
      return api.patch(path, {});
    case 'PUT':
      return api.put(path, {});
    case 'DELETE':
      return api.delete(path, {});
    default:
      throw new Error(`unhandled method ${r.method} ${r.path}`);
  }
}

const label = (r: AdminRoute) => `${r.method} ${r.path}`;

/**
 * Super admin S1: the permission matrix. Every admin route, discovered at
 * runtime, is refused (403 FORBIDDEN) to an admin without its permission and
 * passes the permission check with it; customers, partners and riders are
 * always refused.
 */
describe('Admin permissions matrix (e2e)', () => {
  let t: TestApp;
  let routes: AdminRoute[];
  let root: Awaited<ReturnType<typeof enrolledAdmin>>;
  let none: SignedInAdmin;
  let everything: SignedInAdmin;
  const holders = new Map<AdminPermission, SignedInAdmin>();

  beforeAll(async () => {
    t = await createTestApp();
    routes = adminRoutes(t);
    root = await enrolledAdmin(t);
    none = await limitedAdmin(t, root, []);
    everything = await limitedAdmin(t, root, [...ADMIN_PERMISSION_KEYS]);
    for (const key of ADMIN_PERMISSION_KEYS) {
      holders.set(key, await limitedAdmin(t, root, [key]));
    }
  }, 120_000);
  afterAll(() => t.close());

  it('discovers the admin surface', () => {
    expect(routes.length).toBeGreaterThan(110);
    // Spot checks that discovery sees every controller kind.
    const paths = routes.map(label);
    expect(paths).toEqual(
      expect.arrayContaining([
        'GET /admin/businesses',
        'POST /admin/users/:id/disable',
        'POST /admin/admins',
        'GET /admin/shop/banners',
        'POST /admin/food/hygiene/:brandId/verify',
        'GET /admin/nutrition/foods',
        'POST /admin/me/totp/enrol',
      ]),
    );
  });

  it('every admin route declares who may call it (no unmapped routes)', () => {
    const unmapped = routes.filter((r) => {
      if (r.isPublic) return !r.adminAny; // self-authenticating (TOTP enrol)
      if (r.roles?.length === 1 && r.roles[0] === 'super_admin') return false;
      if (!r.roles?.includes('admin')) return true;
      return !r.permissions?.length && !r.adminAny;
    });
    expect(unmapped.map(label)).toEqual([]);
    // Only the 11 grantable keys, never anything else.
    for (const r of routes) {
      for (const p of r.permissions ?? []) {
        expect(ADMIN_PERMISSION_KEYS).toContain(p);
      }
    }
  });

  it('an admin without the permission gets 403 FORBIDDEN on every route', async () => {
    const leaks: string[] = [];
    for (const r of routes) {
      if (r.adminAny) continue;
      const res = await call(none.api, r);
      if (res.status !== 403 || res.body.error?.code !== 'FORBIDDEN') {
        leaks.push(`${label(r)} → ${res.status} ${res.body.error?.code}`);
      }
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('an admin holding only that permission passes it on every route', async () => {
    const refused: string[] = [];
    for (const r of routes) {
      const superOnly = r.roles?.length === 1 && r.roles[0] === 'super_admin';
      if (superOnly) continue;
      const api =
        r.adminAny || !r.permissions?.length
          ? none.api
          : r.permissions.length === 1
            ? holders.get(r.permissions[0])!.api
            : everything.api;
      const res = await call(api, r);
      if (res.body.error?.code === 'FORBIDDEN') {
        refused.push(`${label(r)} → ${res.status}`);
      }
    }
    expect(refused).toEqual([]);
  }, 120_000);

  it('a permission opens its own routes only', async () => {
    for (const key of ADMIN_PERMISSION_KEYS) {
      const api = holders.get(key)!.api;
      for (const r of routes) {
        if (r.adminAny || !r.permissions?.length) continue;
        if (r.permissions.includes(key)) continue;
        const res = await call(api, r);
        expect(`${key}: ${label(r)} → ${res.body.error?.code}`).toBe(
          `${key}: ${label(r)} → FORBIDDEN`,
        );
      }
    }
  }, 300_000);

  it('super-admin-only routes refuse an admin with every permission, admit the super admin', async () => {
    const superOnly = routes.filter(
      (r) => r.roles?.length === 1 && r.roles[0] === 'super_admin',
    );
    expect(superOnly.length).toBeGreaterThanOrEqual(8);
    for (const r of superOnly) {
      const denied = await call(everything.api, r);
      expect(`${label(r)} → ${denied.body.error?.code}`).toBe(
        `${label(r)} → FORBIDDEN`,
      );
      const ok = await call(root.api, r);
      expect(`${label(r)} → ${ok.body.error?.code}`).not.toBe(
        `${label(r)} → FORBIDDEN`,
      );
    }
  });

  it('customers, partners and riders get 403 on every admin route', async () => {
    const customer = await signup(t);
    const partner = await signup(t, { role: 'partner' });
    const rider = await plainRider(t);
    const leaks: string[] = [];
    for (const [who, api] of [
      ['customer', customer.api],
      ['partner', partner.api],
      ['rider', rider.api],
    ] as const) {
      for (const r of routes) {
        const res = await call(api, r);
        if (res.status !== 403) {
          leaks.push(`${who}: ${label(r)} → ${res.status}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('GET /auth/me carries the effective permissions', async () => {
    const reviewer = holders.get('approvePartners')!;
    const me = await reviewer.api.get('/auth/me').expect(200);
    expect(me.body.data.admin).toEqual({
      isSuperAdmin: false,
      permissions: ['approvePartners'],
      mustChangePassword: false,
      totpEnabled: true,
      recoveryCodesRemaining: 10,
    });
    const rootMe = await root.api.get('/auth/me').expect(200);
    expect(rootMe.body.data.admin.isSuperAdmin).toBe(true);
    expect(rootMe.body.data.admin.permissions).toEqual([
      ...ADMIN_PERMISSION_KEYS,
    ]);
    const customer = await signup(t);
    const cMe = await customer.api.get('/auth/me').expect(200);
    expect(cMe.body.data.admin).toBeUndefined();
  });

  it('GET /admin/meta serves the catalogue to any admin', async () => {
    const res = await none.api.get('/admin/meta').expect(200);
    expect(
      res.body.data.permissions.map((p: { key: string }) => p.key),
    ).toEqual([
      'approvePartners',
      'manageUsers',
      'manageShopping',
      'manageHealthcare',
      'manageFood',
      'manageKitchen',
      'manageContent',
      'viewAnalytics',
      'viewAudit',
      'broadcast',
      'manageSettings',
    ]);
    expect(res.body.data.permissionGroups).toHaveLength(4);
  });
});
