import type { ExpoMessage } from '../src/modules/notifications/expo-push.client';
import { ExpoPushClient } from '../src/modules/notifications/expo-push.client';
import { BroadcastsService } from '../src/modules/broadcasts/broadcasts.service';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin, freshTotp, limitedAdmin } from './utils/admin';
import { signup } from './utils/factories';
import { approvedPartner } from './utils/shopping';

/** Stand-in for Expo: records batches; tokens containing "Dead" are unregistered. */
const fakeExpo = {
  enabled: true,
  batches: [] as ExpoMessage[][],
  send: jest.fn(async (messages: ExpoMessage[]) => {
    fakeExpo.batches.push(messages);
    return messages.map((m) =>
      m.to.includes('Dead')
        ? {
            status: 'error' as const,
            details: { error: 'DeviceNotRegistered' },
          }
        : { status: 'ok' as const, id: 'ticket' },
    );
  }),
};

let tokenSeq = 0;
const token = (dead = false) =>
  `ExponentPushToken[${dead ? 'Dead' : 'Live'}${Date.now().toString(36)}${(tokenSeq += 1)}]`;

/**
 * Super admin S8: broadcasts — step-up, PUSH_ENABLED, audiences, batches of
 * 100 through the Expo client, delivery counts, rate limit, history, audit.
 */
describe('Broadcasts (e2e)', () => {
  let t: TestApp;
  let root: Awaited<ReturnType<typeof enrolledAdmin>>;

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) => b.overrideProvider(ExpoPushClient).useValue(fakeExpo),
    });
    root = await enrolledAdmin(t);
  });
  beforeEach(() => {
    fakeExpo.enabled = true;
    fakeExpo.batches = [];
  });
  afterAll(async () => {
    await t.app.get(BroadcastsService).settle();
    await t.close();
  });

  async function send(
    body: Record<string, unknown>,
    admin: { api: ApiClient; userId: string; secret: string } = root,
  ) {
    // A fresh client per call: the route throttle is per address.
    const c = new ApiClient(t.http);
    c.token = admin.api.token;
    return c.post('/admin/broadcasts', {
      ...body,
      totpCode: await freshTotp(t, admin),
    });
  }

  /** The audience's devices right now, as delivery will see them. */
  async function expected(where: string, params: unknown[] = []) {
    const rows: Array<{ token: string }> = await t.ds.query(
      `SELECT d.expo_push_token AS token FROM user_devices d
         JOIN users u ON u.id = d.user_id WHERE ${where}`,
      params,
    );
    return {
      devices: rows.length,
      dead: rows.filter((r) => r.token.includes('Dead')).length,
    };
  }

  it('PUSH_ENABLED off → 503 PUSH_DISABLED; step-up required; input validated', async () => {
    fakeExpo.enabled = false;
    const off = await send({ audience: 'all', title: 'Hi', body: 'There' });
    expect(off.status).toBe(503);
    expect(off.body.error.code).toBe('PUSH_DISABLED');
    fakeExpo.enabled = true;

    const noCode = await root.api
      .post('/admin/broadcasts', { audience: 'all', title: 'Hi', body: 'Yo' })
      .expect(403);
    expect(noCode.body.error.code).toBe('STEP_UP_REQUIRED');

    const badLink = await send({
      audience: 'customers',
      title: 'Hi',
      body: 'There',
      deepLink: 'javascript:alert(1)',
    });
    expect(badLink.status).toBe(400);
    const badService = await send({
      audience: 'customers',
      service: 'food',
      title: 'Hi',
      body: 'There',
    });
    expect(badService.status).toBe(400);
  });

  it('customers: every customer device, dead tokens counted and pruned, one audit row', async () => {
    const a = await signup(t);
    const b = await signup(t);
    await a.api
      .put('/users/me/devices', { expoPushToken: token(), platform: 'android' })
      .expect(200);
    await b.api
      .put('/users/me/devices', { expoPushToken: token(true), platform: 'ios' })
      .expect(200);
    const want = await expected(`u.status = 'active' AND u.role = 'customer'`);

    const res = await send({
      audience: 'customers',
      title: 'Eid Mubarak!',
      body: 'Kitchens are open all through Eid.',
      deepLink: 'metromatrix://food',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('queued');
    await t.app.get(BroadcastsService).settle();

    const history = await root.api.get('/admin/broadcasts').expect(200);
    const sent = history.body.data.items.find(
      (x: { id: string }) => x.id === res.body.data.id,
    );
    expect(sent).toMatchObject({
      status: 'sent',
      audience: 'customers',
      devices: want.devices,
      delivered: want.devices - want.dead,
      failed: want.dead,
      createdBy: { id: root.userId, email: root.email },
    });
    const messages = fakeExpo.batches.flat();
    expect(messages).toHaveLength(want.devices);
    expect(messages[0]).toMatchObject({
      title: 'Eid Mubarak!',
      data: {
        type: 'broadcast',
        broadcastId: res.body.data.id,
        deepLink: 'metromatrix://food',
      },
    });
    const dead = await t.ds.query(
      `SELECT count(*)::int AS n FROM user_devices WHERE user_id = $1`,
      [b.userId],
    );
    expect(dead[0].n).toBe(0);

    const audit = await t.ds.query(
      `SELECT after FROM operational_audit_events WHERE request_id = $1`,
      [res.headers['x-request-id']],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toMatchObject({
      audience: 'customers',
      title: 'Eid Mubarak!',
    });
  });

  it('partners of one service only, and in batches of at most 100', async () => {
    const food = await approvedPartner(t, root, 'restaurant');
    const shop = await approvedPartner(t, root, 'store');
    await food.api
      .put('/users/me/devices', { expoPushToken: token(), platform: 'android' })
      .expect(200);
    await shop.api
      .put('/users/me/devices', { expoPushToken: token(), platform: 'android' })
      .expect(200);
    // Plenty of food-partner devices: one partner, 230 tablets.
    await t.ds.query(
      `INSERT INTO user_devices (user_id, expo_push_token, platform, last_seen_at)
       SELECT $1, 'ExponentPushToken[Bulk' || g || $2 || ']', 'android', now()
         FROM generate_series(1, 230) g`,
      [food.userId, Date.now().toString(36)],
    );
    const want = await expected(
      `u.status = 'active' AND u.role = 'partner' AND EXISTS (
         SELECT 1 FROM businesses b WHERE b.owner_user_id = u.id
            AND b.status = 'approved' AND b.service_type = 'food')`,
    );

    const res = await send({
      audience: 'partners',
      service: 'food',
      title: 'New: catering requests',
      body: 'Turn on catering in your kitchen settings.',
    });
    expect(res.status).toBe(201);
    await t.app.get(BroadcastsService).settle();

    const sizes = fakeExpo.batches.map((b) => b.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(want.devices);
    const tokens = fakeExpo.batches.flat().map((m) => m.to);
    const [shopDevice] = await t.ds.query(
      `SELECT expo_push_token FROM user_devices WHERE user_id = $1`,
      [shop.userId],
    );
    expect(tokens).not.toContain(shopDevice.expo_push_token);

    const [row] = await t.ds.query(
      `SELECT status, devices, delivered FROM admin_broadcasts WHERE id = $1`,
      [res.body.data.id],
    );
    expect(row).toMatchObject({
      status: 'sent',
      devices: want.devices,
      delivered: want.devices - want.dead,
    });
  });

  it('at most 5 broadcasts an hour per admin → 429 RATE_LIMITED', async () => {
    const sender = await limitedAdmin(t, root, ['broadcast']);
    for (let i = 0; i < 5; i += 1) {
      const ok = await send(
        { audience: 'riders', title: `Note ${i}`, body: 'Ride safe.' },
        sender,
      );
      expect(ok.status).toBe(201);
    }
    const sixth = await send(
      { audience: 'riders', title: 'One more', body: 'Ride safe.' },
      sender,
    );
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
    await t.app.get(BroadcastsService).settle();
  });

  it('needs the broadcast permission', async () => {
    const other = await limitedAdmin(t, root, ['viewAudit']);
    await other.api.get('/admin/broadcasts').expect(403);
  });
});
