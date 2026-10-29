import { Controller, HttpCode, Post } from '@nestjs/common';
import { DateTime } from 'luxon';
import request from 'supertest';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin, freshTotp, limitedAdmin } from './utils/admin';
import { asset } from './utils/shopping';
import { foodVendor } from './utils/food';
import { Roles } from '../src/common/decorators/roles.decorator';
import { RequirePermission } from '../src/common/decorators/require-permission.decorator';

/** Test-only: an admin write that forgets its audit row (the safety net). */
@Roles('admin', 'super_admin')
@RequirePermission('manageUsers')
@Controller('admin/test-unaudited')
class UnauditedController {
  @Post()
  @HttpCode(200)
  poke() {
    return { poked: true };
  }
}

/**
 * Super admin S6: the audit log. Every e2e suite checks, through its
 * ApiClients, that each admin write it makes leaves exactly one audit row of
 * its own with before/after (test/utils/test-app.ts); this suite covers the
 * writes no other suite makes, the read API, what a row records, and that
 * the table is append-only.
 */
describe('Audit log (e2e)', () => {
  let t: TestApp;
  let root: Awaited<ReturnType<typeof enrolledAdmin>>;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [UnauditedController] });
    root = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  /** The one audit row a request wrote. */
  const rowOf = async (res: request.Response) => {
    const rows = await t.ds.query(
      `SELECT * FROM operational_audit_events WHERE request_id = $1`,
      [res.headers['x-request-id']],
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  describe('writes no other suite makes', () => {
    it('PATCH /admin/shop/banners/:id records the changed fields only', async () => {
      const created = await root.api
        .post('/admin/shop/banners', {
          imageUrl: asset(root.userId, 'banner').url,
          title: 'Spring sale',
          targetType: 'none',
        })
        .expect(201);
      const res = await root.api
        .patch(`/admin/shop/banners/${created.body.data.id}`, {
          title: 'Summer sale',
          isActive: false,
        })
        .expect(200);
      const row = await rowOf(res);
      expect(row).toMatchObject({
        action: 'shop.banner.update',
        target_type: 'shop_banner',
        target_id: created.body.data.id,
        actor_user_id: root.userId,
        before: { title: 'Spring sale', isActive: true },
        after: { title: 'Summer sale', isActive: false },
      });
    });

    it('POST /admin/nutrition/foods/:id/activate', async () => {
      const food = await root.api
        .post('/admin/nutrition/foods', {
          name: `Audit spice ${Date.now().toString(36)}`,
          foodGroup: 'Spices and Herbs',
          kcal: 300,
          proteinG: 10,
          carbsG: 50,
          fatG: 8,
          fibreG: 20,
          sodiumMg: 4000,
        })
        .expect(201);
      await root.api
        .delete(`/admin/nutrition/foods/${food.body.data.id}`)
        .expect(200);
      const res = await root.api
        .post(`/admin/nutrition/foods/${food.body.data.id}/activate`)
        .expect(200);
      expect(await rowOf(res)).toMatchObject({
        action: 'nutrition.food.activate',
        before: { isActive: false },
        after: { isActive: true },
      });
    });

    it('POST /admin/food/hygiene/:brandId/revoke', async () => {
      const v = await foodVendor(t, root, 'home_kitchen');
      const photo = asset(v.userId, 'kitchen_story');
      await v.api
        .put('/food/vendor/story', {
          story: 'Since 2001.',
          cookName: 'Khala',
          photos: [photo.url],
          hygieneChecklist: {
            gloves: true,
            hairnet: true,
            cleanWater: true,
            separateBoards: true,
            fridgeTempLog: true,
            pestControlOn: DateTime.now()
              .setZone('Asia/Karachi')
              .minus({ days: 30 })
              .toISODate(),
          },
        })
        .expect(200);
      await root.api
        .post(`/admin/food/hygiene/${v.brandId}/verify`, { method: 'visit' })
        .expect(200);
      const res = await root.api
        .post(`/admin/food/hygiene/${v.brandId}/revoke`, {
          reason: 'Photos were from another kitchen',
        })
        .expect(200);
      expect(await rowOf(res)).toMatchObject({
        action: 'hygiene.revoke',
        target_id: v.brandId,
        before: { hygieneStatus: 'verified' },
        after: { hygieneStatus: 'self_declared' },
      });
    });

    it('POST /admin/me/recovery-codes: new codes once; the old ones stop working', async () => {
      const res = await root.api
        .post('/admin/me/recovery-codes', {
          totpCode: await freshTotp(t, root),
        })
        .expect(200);
      expect(res.body.data.recoveryCodes).toHaveLength(10);
      const row = await rowOf(res);
      expect(row.action).toBe('admin.recovery_codes_regenerated');
      expect(JSON.stringify(row)).not.toContain(res.body.data.recoveryCodes[0]);
      const old = await t.ds.query(
        `SELECT count(*)::int AS n FROM admin_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
        [root.userId],
      );
      expect(old[0].n).toBe(10);
      const stale = await new ApiClient(t.http)
        .post('/auth/signin', {
          email: root.email,
          password: 'Secret123',
          portal: 'admin',
        })
        .expect(200);
      await new ApiClient(t.http)
        .post('/auth/admin/totp', {
          challengeToken: stale.body.data.challengeToken,
          recoveryCode: root.recoveryCodes[0],
        })
        .expect(401);
    });
  });

  describe('what a row records', () => {
    it('actor, action, target, before/after, IP, user agent and request id', async () => {
      const api = new ApiClient(t.http);
      api.token = root.api.token;
      api.headers = { 'User-Agent': 'MetroMatrix-Admin/1.0 (audit test)' };
      const cat = await api
        .post('/admin/shop/categories', { name: `Audit shelf ${Date.now()}` })
        .expect(201);
      const row = await rowOf(cat);
      expect(row).toMatchObject({
        actor_user_id: root.userId,
        action: 'shop.category.create',
        target_type: 'shop_category',
        target_id: cat.body.data.id,
        before: null,
        ip: api.ip,
        user_agent: 'MetroMatrix-Admin/1.0 (audit test)',
        request_id: cat.headers['x-request-id'],
      });
      expect(row.after).toMatchObject({ name: cat.body.data.name });
      // Leave the public catalogue as it was (other suites count its roots).
      await api
        .delete(`/admin/shop/categories/${cat.body.data.id}`)
        .expect(200);
    });

    it('a write that forgets its row still gets one, from the safety net', async () => {
      const res = await request(t.http)
        .post('/api/v1/admin/test-unaudited')
        .set('Authorization', `Bearer ${root.api.token}`)
        .set('X-Request-Id', `net-${Date.now()}`)
        .expect(200);
      const row = await rowOf(res);
      expect(row.action).toBe('admin.UnauditedController.poke');
      expect(row.details).toMatchObject({ method: 'POST' });
    });

    it('the table is append-only: UPDATE, DELETE and TRUNCATE are refused', async () => {
      const [row] = await t.ds.query(
        `SELECT id FROM operational_audit_events ORDER BY created_at DESC LIMIT 1`,
      );
      await expect(
        t.ds.query(
          `UPDATE operational_audit_events SET action = 'tampered' WHERE id = $1`,
          [row.id],
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        t.ds.query(`DELETE FROM operational_audit_events WHERE id = $1`, [
          row.id,
        ]),
      ).rejects.toThrow(/append-only/);
      await expect(
        t.ds.query(`TRUNCATE operational_audit_events`),
      ).rejects.toThrow(/append-only/);
      const [still] = await t.ds.query(
        `SELECT action FROM operational_audit_events WHERE id = $1`,
        [row.id],
      );
      expect(still.action).not.toBe('tampered');
    });
  });

  describe('GET /admin/audit', () => {
    it('filters by actor, action prefix, target and dates; cursor pages without gaps', async () => {
      const staff = await limitedAdmin(t, root, [
        'viewAudit',
        'manageShopping',
      ]);
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const c = await staff.api
          .post('/admin/shop/categories', {
            name: `Paged shelf ${Date.now()} ${i}`,
          })
          .expect(201);
        ids.push(c.body.data.id);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: request.Response = await staff.api
          .get(
            `/admin/audit?actorUserId=${staff.userId}&action=shop.category.*&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
          )
          .expect(200);
        expect(page.body.data.items.length).toBeLessThanOrEqual(2);
        for (const item of page.body.data.items) {
          expect(item.actor).toMatchObject({
            id: staff.userId,
            email: staff.email,
          });
          seen.push(item.targetId);
        }
        cursor = page.body.data.nextCursor;
      } while (cursor);
      expect(seen).toEqual([...ids].reverse());

      const one = await staff.api
        .get(`/admin/audit?targetType=shop_category&targetId=${ids[0]}`)
        .expect(200);
      expect(one.body.data.items).toHaveLength(1);
      expect(one.body.data.items[0]).toMatchObject({
        action: 'shop.category.create',
        before: null,
        after: expect.objectContaining({ id: ids[0] }),
      });

      const future = new Date(Date.now() + 60_000).toISOString();
      const none = await staff.api
        .get(`/admin/audit?actorUserId=${staff.userId}&from=${future}`)
        .expect(200);
      expect(none.body.data).toEqual({ items: [], nextCursor: null });

      await staff.api.get('/admin/audit?cursor=not-a-cursor').expect(400);
      for (const id of ids) {
        await staff.api.delete(`/admin/shop/categories/${id}`).expect(200);
      }
    });

    it('needs viewAudit; there is no write route', async () => {
      const other = await limitedAdmin(t, root, ['manageUsers']);
      await other.api.get('/admin/audit').expect(403);
      await root.api.post('/admin/audit', {}).expect(404);
      await root.api.delete('/admin/audit', {}).expect(404);
    });
  });
});
