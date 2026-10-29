import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin, limitedAdmin } from './utils/admin';
import { signup, signin } from './utils/factories';
import { approvedPartner } from './utils/shopping';

/**
 * Super admin S4 + S5: People (filters, detail, sign-out everywhere) and the
 * overview and analytics, checked against counts taken straight from SQL.
 */
describe('People, overview and analytics (e2e)', () => {
  let t: TestApp;
  let root: Awaited<ReturnType<typeof enrolledAdmin>>;

  beforeAll(async () => {
    t = await createTestApp();
    root = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  const count = async (sql: string, params: unknown[] = []) =>
    (await t.ds.query(sql, params))[0].n as number;

  describe('people', () => {
    it('filters by role, status, verified, service and created range; searches name, email, phone', async () => {
      const marker = `pp${Date.now().toString(36)}`;
      const c = await signup(t, {
        displayName: `Zara ${marker}`,
        phone: '03004561237',
      });
      const food = await approvedPartner(
        t,
        root,
        'restaurant',
        `Kitchen ${marker}`,
      );

      const byName = await root.api.get(`/admin/users?q=${marker}`).expect(200);
      expect(byName.body.data.items.map((u: { id: string }) => u.id)).toEqual([
        c.userId,
      ]);
      const byPhone = await root.api
        .get(`/admin/users?q=${encodeURIComponent('+923004561237')}`)
        .expect(200);
      expect(
        byPhone.body.data.items.some((u: { id: string }) => u.id === c.userId),
      ).toBe(true);

      const unverified = await root.api
        .get(`/admin/users?q=${encodeURIComponent(c.email)}&verified=false`)
        .expect(200);
      expect(unverified.body.data.total).toBe(1);
      const verified = await root.api
        .get(`/admin/users?q=${encodeURIComponent(c.email)}&verified=true`)
        .expect(200);
      expect(verified.body.data.total).toBe(0);

      const foodPartners = await root.api
        .get(
          `/admin/users?role=partner&service=food&pageSize=100&q=${encodeURIComponent(food.email)}`,
        )
        .expect(200);
      expect(foodPartners.body.data.items[0].id).toBe(food.userId);
      const shopPartners = await root.api
        .get(
          `/admin/users?service=shopping&q=${encodeURIComponent(food.email)}`,
        )
        .expect(200);
      expect(shopPartners.body.data.total).toBe(0);

      const future = new Date(Date.now() + 86_400_000).toISOString();
      const none = await root.api
        .get(`/admin/users?createdFrom=${future}`)
        .expect(200);
      expect(none.body.data.total).toBe(0);
      const all = await root.api
        .get(`/admin/users?createdTo=${future}&pageSize=1`)
        .expect(200);
      expect(all.body.data.total).toBe(
        await count(
          `SELECT count(*)::int AS n FROM users WHERE status <> 'deleted'`,
        ),
      );
      expect(all.body.data).toMatchObject({ page: 1, pageSize: 1 });
    });

    it('detail: profile, businesses, last sign-in and live sessions', async () => {
      const p = await approvedPartner(t, root, 'store');
      await signin(t, p.email, 'partner'); // a second device
      const res = await root.api.get(`/admin/users/${p.userId}`).expect(200);
      expect(res.body.data).toMatchObject({
        id: p.userId,
        role: 'partner',
        status: 'active',
        lastLoginAt: expect.any(String),
        sessionCount: 2,
      });
      expect(res.body.data.businesses).toHaveLength(1);
      expect(res.body.data.businesses[0]).toMatchObject({
        id: p.businessId,
        serviceType: 'shopping',
        status: 'approved',
      });
      expect(JSON.stringify(res.body)).not.toMatch(
        /password_hash|passwordHash|totpSecret/,
      );
    });

    it('sign-out everywhere revokes every session and access token', async () => {
      const c = await signup(t);
      const other = await signin(t, c.email, 'customer');
      await root.api
        .post(`/admin/users/${c.userId}/sign-out-everywhere`)
        .expect(200);
      expect((await c.api.get('/auth/me')).body.error.code).toBe(
        'TOKEN_REVOKED',
      );
      expect((await other.api.get('/auth/me')).status).toBe(401);
      await new ApiClient(t.http)
        .post('/auth/refresh-token', { refreshToken: c.refreshToken })
        .expect(401);
      const detail = await root.api.get(`/admin/users/${c.userId}`).expect(200);
      expect(detail.body.data.sessionCount).toBe(0);
      // Signing in again works: it is a sign-out, not a ban.
      expect((await signin(t, c.email, 'customer')).res.status).toBe(200);
    });

    it('disable bumps token_version: the old token answers TOKEN_REVOKED at once', async () => {
      const c = await signup(t);
      const [before] = await t.ds.query(
        `SELECT token_version FROM users WHERE id = $1`,
        [c.userId],
      );
      await root.api.post(`/admin/users/${c.userId}/disable`, {}).expect(200);
      const [after] = await t.ds.query(
        `SELECT token_version FROM users WHERE id = $1`,
        [c.userId],
      );
      expect(after.token_version).toBe(before.token_version + 1);
      expect((await c.api.get('/auth/me')).body.error.code).toBe(
        'TOKEN_REVOKED',
      );
    });
  });

  describe('overview', () => {
    it('counts come from the tables, and only viewAnalytics may read them', async () => {
      await signup(t);
      const res = await root.api.get('/admin/overview?period=7d').expect(200);
      const d = res.body.data;
      expect(d.period).toBe('7d');

      const roles: Array<{ key: string; n: number }> = await t.ds.query(
        `SELECT role::text AS key, count(*)::int AS n FROM users WHERE status <> 'deleted' GROUP BY role ORDER BY role`,
      );
      expect(d.usersByRole).toEqual(
        roles.map((r) => ({ key: r.key, count: r.n })),
      );
      expect(d.signups.last7d).toBe(
        await count(
          `SELECT count(*)::int AS n FROM users WHERE role IN ('customer','partner') AND created_at >= now() - interval '7 days'`,
        ),
      );
      expect(d.pendingApprovals).toBe(
        await count(
          `SELECT count(*)::int AS n FROM businesses WHERE status = 'pending_approval'`,
        ),
      );
      expect(d.activity.food.count).toBe(
        await count(
          `SELECT count(*)::int AS n FROM food_orders WHERE created_at >= now() - interval '7 days'`,
        ),
      );
      expect(d.activity.shopping.value).toBe(
        await count(
          `SELECT coalesce(sum(total), 0)::int AS n FROM store_orders WHERE status <> 'cancelled' AND created_at >= now() - interval '7 days'`,
        ),
      );
      expect(d.integrations).toEqual({
        mailConfigured: false,
        pushEnabled: false,
        aiEnabled: true,
      });

      const no = await limitedAdmin(t, root, ['manageUsers']);
      await no.api.get('/admin/overview').expect(403);
      const yes = await limitedAdmin(t, root, ['viewAnalytics']);
      await yes.api.get('/admin/overview').expect(200);
    });

    it('timeseries: every bucket, zeros included, matching the table', async () => {
      const from = new Date(Date.now() - 6 * 86_400_000);
      from.setUTCHours(0, 0, 0, 0);
      const to = new Date(Date.now() + 86_400_000);
      to.setUTCHours(0, 0, 0, 0);
      await signup(t);
      const res = await root.api
        .get(
          `/admin/analytics/timeseries?metric=signups&from=${from.toISOString()}&to=${to.toISOString()}&interval=day`,
        )
        .expect(200);
      const points: Array<{ bucket: string; value: number }> =
        res.body.data.points;
      expect(points).toHaveLength(7);
      expect(points[0].bucket).toBe(from.toISOString().replace('.000', ''));
      const total = points.reduce((n, p) => n + p.value, 0);
      expect(total).toBe(
        await count(
          `SELECT count(*)::int AS n FROM users WHERE role IN ('customer','partner') AND created_at >= $1 AND created_at < $2`,
          [from, to],
        ),
      );
      expect(points[points.length - 1].value).toBeGreaterThan(0);

      const week = await root.api
        .get(
          `/admin/analytics/timeseries?metric=food_value&from=${from.toISOString()}&to=${to.toISOString()}&interval=week`,
        )
        .expect(200);
      expect(week.body.data.points.length).toBeGreaterThanOrEqual(1);

      await root.api
        .get(
          `/admin/analytics/timeseries?metric=revenue_made_up&from=${from.toISOString()}&to=${to.toISOString()}`,
        )
        .expect(400);
      await root.api
        .get(
          `/admin/analytics/timeseries?metric=signups&from=2020-01-01T00:00:00Z&to=${to.toISOString()}&interval=day`,
        )
        .expect(400);
    });
  });
});
