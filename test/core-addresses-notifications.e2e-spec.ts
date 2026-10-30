import { ExpoMessage } from '../src/modules/notifications/expo-push.client';
import { ExpoPushClient } from '../src/modules/notifications/expo-push.client';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { createTestApp, TestApp } from './utils/test-app';
import { signup, verifiedPartner } from './utils/factories';
import { lastVerifyTokenFor } from './utils/outbox';

/** Stand-in for Expo: records batches; tokens containing "dead" are unregistered. */
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

const ADDRESS = {
  label: 'home',
  fullName: 'Ayesha Khan',
  phone: '0312 4890176',
  city: 'Lahore',
  area: 'Gulberg III',
  line1: 'House 12, Street 4',
};

describe('Core: addresses + notifications (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) => b.overrideProvider(ExpoPushClient).useValue(fakeExpo),
    });
  });
  afterAll(() => t.close());

  async function verifiedCustomer() {
    const c = await signup(t);
    await c.api
      .post('/auth/verify-email', { token: lastVerifyTokenFor(c.email) })
      .expect(200);
    return c;
  }

  describe('addresses', () => {
    it('CRUD: the first address is the default; phone is normalised; another user gets 404', async () => {
      const c = await verifiedCustomer();
      const first = await c.api.post('/addresses', ADDRESS).expect(201);
      expect(first.body.data).toMatchObject({
        label: 'home',
        phone: '+923124890176',
        isDefault: true,
        landmark: null,
      });
      const id = first.body.data.id;

      const updated = await c.api
        .patch(`/addresses/${id}`, {
          landmark: 'Near Liberty Market',
          city: 'Karachi',
        })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        city: 'Karachi',
        landmark: 'Near Liberty Market',
      });

      const other = await verifiedCustomer();
      await other.api.get(`/addresses/${id}`).expect(404);
      await other.api.patch(`/addresses/${id}`, { city: 'Multan' }).expect(404);
      await other.api.delete(`/addresses/${id}`).expect(404);

      await c.api.delete(`/addresses/${id}`).expect(200);
      const list = await c.api.get('/addresses').expect(200);
      expect(list.body.data).toEqual([]);
    });

    it('exactly one default: setting another moves it; deleting the default promotes the newest', async () => {
      const c = await verifiedCustomer();
      const a = (await c.api.post('/addresses', ADDRESS).expect(201)).body.data;
      const b = (
        await c.api
          .post('/addresses', { ...ADDRESS, label: 'work' })
          .expect(201)
      ).body.data;
      const d = (
        await c.api
          .post('/addresses', { ...ADDRESS, label: 'other', isDefault: true })
          .expect(201)
      ).body.data;
      expect(b.isDefault).toBe(false);
      expect(d.isDefault).toBe(true);

      await c.api.post(`/addresses/${a.id}/default`).expect(200);
      let list = (await c.api.get('/addresses').expect(200)).body.data;
      expect(
        list.filter((x: any) => x.isDefault).map((x: any) => x.id),
      ).toEqual([a.id]);
      expect(list[0].id).toBe(a.id);

      await c.api.delete(`/addresses/${a.id}`).expect(200);
      list = (await c.api.get('/addresses').expect(200)).body.data;
      expect(
        list.filter((x: any) => x.isDefault).map((x: any) => x.id),
      ).toEqual([d.id]);
    });

    it('the database itself refuses a second default', async () => {
      const c = await verifiedCustomer();
      await c.api.post('/addresses', ADDRESS).expect(201);
      const second = (await c.api.post('/addresses', ADDRESS).expect(201)).body
        .data;
      await expect(
        t.ds.query(`UPDATE addresses SET is_default = true WHERE id = $1`, [
          second.id,
        ]),
      ).rejects.toThrow(/UQ_addresses_one_default_per_user/);
    });

    it('customers only, verified only', async () => {
      const partner = await verifiedPartner(t);
      await partner.api.get('/addresses').expect(403);
      const unverified = await signup(t);
      const res = await unverified.api.post('/addresses', ADDRESS).expect(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('a malformed phone is a validation error', async () => {
      const c = await verifiedCustomer();
      const res = await c.api
        .post('/addresses', { ...ADDRESS, phone: '12345' })
        .expect(400);
      expect(res.body.error.details.fields.phone).toBeDefined();
    });
  });

  describe('notifications', () => {
    it('notify() writes the row and pushes to every device; DeviceNotRegistered tokens are removed', async () => {
      const u = await signup(t);
      const live = `ExponentPushToken[liveToken${Date.now()}]`;
      const dead = `ExponentPushToken[DeadToken${Date.now()}]`;
      await u.api
        .put('/users/me/devices', { expoPushToken: live, platform: 'android' })
        .expect(200);
      await u.api
        .put('/users/me/devices', { expoPushToken: dead, platform: 'ios' })
        .expect(200);

      fakeExpo.send.mockClear();
      fakeExpo.batches = [];
      const row = await t.app.get(NotificationsService).notify(u.userId, {
        type: 'shop.order_placed',
        title: 'New order MM-ABC123',
        body: '2 items · Rs 3,450',
        data: { groupCode: 'MM-ABC123' },
      });

      expect(row.id).toEqual(expect.any(String));
      expect(fakeExpo.send).toHaveBeenCalledTimes(1);
      const sent = fakeExpo.batches[0];
      expect(sent.map((m) => m.to).sort()).toEqual([dead, live].sort());
      expect(sent[0]).toMatchObject({
        title: 'New order MM-ABC123',
        data: {
          groupCode: 'MM-ABC123',
          type: 'shop.order_placed',
          notificationId: row.id,
        },
      });

      const devices = await t.ds.query(
        `SELECT expo_push_token FROM user_devices WHERE user_id = $1`,
        [u.userId],
      );
      expect(devices.map((d: any) => d.expo_push_token)).toEqual([live]);
    });

    it('list, unread count, read one, read all — scoped to the owner', async () => {
      const u = await signup(t);
      const svc = t.app.get(NotificationsService);
      const a = await svc.notify(u.userId, {
        type: 't.a',
        title: 'A',
        body: 'a',
      });
      await svc.notify(u.userId, { type: 't.b', title: 'B', body: 'b' });

      expect(
        (await u.api.get('/notifications/unread-count').expect(200)).body.data,
      ).toEqual({ unread: 2 });
      const list = (await u.api.get('/notifications?pageSize=10').expect(200))
        .body.data;
      expect(Object.keys(list).sort()).toEqual([
        'items',
        'page',
        'pageSize',
        'total',
      ]);
      expect(list.items.map((n: any) => n.title)).toEqual(['B', 'A']);

      const stranger = await signup(t);
      await stranger.api.post(`/notifications/${a.id}/read`).expect(404);

      await u.api.post(`/notifications/${a.id}/read`).expect(200);
      expect(
        (await u.api.get('/notifications/unread-count').expect(200)).body.data,
      ).toEqual({ unread: 1 });
      const unreadOnly = (
        await u.api.get('/notifications?unread=true').expect(200)
      ).body.data;
      expect(unreadOnly.items.map((n: any) => n.title)).toEqual(['B']);

      expect(
        (await u.api.post('/notifications/read-all').expect(200)).body.data,
      ).toEqual({ updated: 1 });
      expect(
        (await u.api.get('/notifications/unread-count').expect(200)).body.data,
      ).toEqual({ unread: 0 });
    });

    it('a failing push never fails notify()', async () => {
      const u = await signup(t);
      await u.api
        .put('/users/me/devices', {
          expoPushToken: `ExponentPushToken[boom${Date.now()}]`,
          platform: 'android',
        })
        .expect(200);
      fakeExpo.send.mockRejectedValueOnce(new Error('network down'));
      const row = await t.app.get(NotificationsService).notify(u.userId, {
        type: 't.x',
        title: 'X',
        body: 'x',
      });
      expect(row.id).toEqual(expect.any(String));
    });
  });
});
