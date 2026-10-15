import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import {
  Admin,
  Partner,
  approvedPartner,
  asset,
  customer,
  deliverOrder,
  orderFrom,
  shopper,
  simpleProduct,
  storeOf,
} from './utils/shopping';

describe('Shopping P6: admin (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let p: Partner;
  let store: { id: string; slug: string };

  const sql = (s: string, params: unknown[] = []) => t.ds.query(s, params);
  const audited = async (action: string, targetId: string) =>
    (
      await sql(
        `SELECT count(*)::int AS n FROM operational_audit_events WHERE action = $1 AND target_id = $2`,
        [action, targetId],
      )
    )[0].n;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    p = await approvedPartner(t, admin, 'store', 'Admin Arcade');
    store = await storeOf(p);
  });
  afterAll(() => t.close());

  it('only admins reach /admin/shop', async () => {
    const c = await shopper(t);
    expect(
      (await c.api.get('/admin/shop/categories').expect(403)).body.error.code,
    ).toBe('FORBIDDEN');
    await p.api.get('/admin/shop/orders').expect(403);
  });

  it('categories: two levels, unique slugs, in-use ones deactivate rather than delete', async () => {
    const tree = (await admin.api.get('/admin/shop/categories').expect(200))
      .body.data;
    expect(tree.length).toBeGreaterThanOrEqual(8);
    const women = tree.find((c: any) => c.slug === 'women');

    const made = await admin.api
      .post('/admin/shop/categories', {
        name: 'Bridal wear',
        parentId: women.id,
        icon: 'sparkles',
      })
      .expect(201);
    expect(made.body.data).toMatchObject({
      slug: 'bridal-wear',
      parentId: women.id,
      isActive: true,
    });
    expect(await audited('shop.category.create', made.body.data.id)).toBe(1);
    expect(
      (
        await admin.api
          .post('/admin/shop/categories', { name: 'Bridal Wear' })
          .expect(409)
      ).body.error.code,
    ).toBe('CONFLICT');
    await admin.api
      .post('/admin/shop/categories', {
        name: 'Too deep',
        parentId: made.body.data.id,
      })
      .expect(400);

    // In use → refuse delete; deactivate hides it from the public tree.
    const product = await simpleProduct(t, p, 'Bridal lehenga', 90000, 1);
    await sql(`UPDATE products SET category_id = $2 WHERE id = $1`, [
      product.id,
      made.body.data.id,
    ]);
    const inUse = await admin.api
      .delete(`/admin/shop/categories/${made.body.data.id}`)
      .expect(409);
    expect(inUse.body.error.details).toEqual({ children: 0, products: 1 });
    await admin.api
      .patch(`/admin/shop/categories/${made.body.data.id}`, { isActive: false })
      .expect(200);
    const pub = (
      await new ApiClient(t.http).get('/shop/categories').expect(200)
    ).body.data;
    expect(
      pub.find((c: any) => c.slug === 'women').children.map((c: any) => c.slug),
    ).not.toContain('bridal-wear');

    const unused = await admin.api
      .post('/admin/shop/categories', { name: 'Temporary shelf' })
      .expect(201);
    await admin.api
      .delete(`/admin/shop/categories/${unused.body.data.id}`)
      .expect(200);
    expect(await audited('shop.category.delete', unused.body.data.id)).toBe(1);
  });

  it('banners and featured stores drive the home screen; dead targets are dropped', async () => {
    const image = asset(admin.userId, 'banner').url;
    await admin.api
      .post('/admin/shop/banners', {
        imageUrl: asset(p.userId, 'banner').url,
        title: 'Not mine',
        targetType: 'none',
      })
      .expect(400);
    await admin.api
      .post('/admin/shop/banners', {
        imageUrl: image,
        title: 'No target',
        targetType: 'store',
      })
      .expect(400);
    const live = await admin.api
      .post('/admin/shop/banners', {
        imageUrl: image,
        title: 'Admin Arcade sale',
        targetType: 'store',
        targetId: store.id,
      })
      .expect(201);
    const expired = await admin.api
      .post('/admin/shop/banners', {
        imageUrl: image,
        title: 'Last season',
        targetType: 'none',
        startsAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        endsAt: new Date(Date.now() - 86_400_000).toISOString(),
      })
      .expect(201);

    await admin.api.post(`/admin/shop/stores/${store.id}/feature`).expect(200);
    const anon = new ApiClient(t.http);
    const home = (await anon.get('/shop/home').expect(200)).body.data;
    expect(home.banners.map((b: any) => b.id)).toContain(live.body.data.id);
    expect(home.banners.map((b: any) => b.id)).not.toContain(
      expired.body.data.id,
    );
    expect(home.featuredStores.map((s: any) => s.id)).toContain(store.id);
    const featured = (await anon.get('/shop/stores?featured=true').expect(200))
      .body.data.items;
    expect(featured.map((s: any) => s.id)).toContain(store.id);

    await p.api
      .patch('/shop/partner/store/settings', { isPaused: true })
      .expect(200);
    const paused = (await anon.get('/shop/home').expect(200)).body.data;
    expect(paused.banners.map((b: any) => b.id)).not.toContain(
      live.body.data.id,
    );
    expect(paused.featuredStores.map((s: any) => s.id)).not.toContain(store.id);
    await p.api
      .patch('/shop/partner/store/settings', { isPaused: false })
      .expect(200);

    await admin.api
      .post(`/admin/shop/stores/${store.id}/unfeature`)
      .expect(200);
    await admin.api
      .delete(`/admin/shop/banners/${expired.body.data.id}`)
      .expect(200);
    await admin.api
      .delete(`/admin/shop/banners/${expired.body.data.id}`)
      .expect(404);
    expect(await audited('shop.store.feature', store.id)).toBe(1);
    expect(await audited('shop.banner.create', live.body.data.id)).toBe(1);
  });

  it('remove hides a product everywhere, actions its reports, tells the store, keeps orders; restore brings it back', async () => {
    const watch = await simpleProduct(t, p, 'Replica watch', 7000, 5);
    const c = await customer(t);
    const order = await orderFrom(c, store.id, [[watch.variantId, 1]]);
    await c.api
      .post(`/shop/products/${watch.id}/report`, { reason: 'counterfeit' })
      .expect(201);
    const other = await customer(t);
    const dismissMe = await other.api
      .post(`/shop/products/${watch.id}/report`, { reason: 'other' })
      .expect(201);

    const open = (await admin.api.get('/admin/shop/reports').expect(200)).body
      .data.items;
    const mine = open.filter((r: any) => r.product.id === watch.id);
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({
      openReportsOnProduct: 2,
      store: { id: store.id },
    });

    await admin.api
      .post(`/admin/shop/reports/${dismissMe.body.data.id}/dismiss`, {
        note: 'Not a real issue',
      })
      .expect(200);
    await admin.api
      .post(`/admin/shop/reports/${dismissMe.body.data.id}/dismiss`, {})
      .expect(409);

    await admin.api
      .post(`/admin/shop/products/${watch.id}/remove`, {})
      .expect(400); // reason required
    const removed = await admin.api
      .post(`/admin/shop/products/${watch.id}/remove`, {
        reason: 'Counterfeit branded goods',
      })
      .expect(200);
    expect(removed.body.data).toEqual({
      id: watch.id,
      status: 'removed',
      removedReason: 'Counterfeit branded goods',
    });
    expect(await audited('shop.product.remove', watch.id)).toBe(1);

    const anon = new ApiClient(t.http);
    await anon.get(`/shop/products/${watch.id}`).expect(404);
    expect(
      (
        await anon.get(`/shop/products?storeId=${store.id}`).expect(200)
      ).body.data.items.map((x: any) => x.id),
    ).not.toContain(watch.id);
    expect(
      (
        await anon.get('/shop/products?q=replica').expect(200)
      ).body.data.items.map((x: any) => x.id),
    ).not.toContain(watch.id);
    expect(
      (await anon.get('/shop/products/suggest?q=replica').expect(200)).body.data
        .products,
    ).toEqual([]);
    const actioned = (
      await admin.api.get('/admin/shop/reports?status=actioned').expect(200)
    ).body.data.items;
    expect(actioned.map((r: any) => r.product.id)).toContain(watch.id);
    const n = await sql(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'shop.product.removed'`,
      [p.userId],
    );
    expect(n).toHaveLength(1);
    // The partner sees it removed and cannot republish it.
    const partnerView = (
      await p.api.get(`/shop/partner/products/${watch.id}`).expect(200)
    ).body.data;
    expect(partnerView).toMatchObject({
      status: 'removed',
      removedReason: 'Counterfeit branded goods',
    });
    expect(
      (
        await p.api
          .patch(`/shop/partner/products/${watch.id}`, { status: 'active' })
          .expect(409)
      ).body.error.code,
    ).toBe('INVALID_TRANSITION');
    // The existing order is untouched and still workable.
    const view = (await c.api.get(`/shop/store-orders/${order.id}`).expect(200))
      .body.data;
    expect(view.items[0]).toMatchObject({
      productName: 'Replica watch',
      unitPrice: 7000,
    });
    await p.api.post(`/shop/partner/orders/${order.id}/confirm`).expect(200);

    const restored = await admin.api
      .post(`/admin/shop/products/${watch.id}/restore`)
      .expect(200);
    expect(restored.body.data).toEqual({ id: watch.id, status: 'active' });
    await anon.get(`/shop/products/${watch.id}`).expect(200);
    await admin.api
      .post(`/admin/shop/products/${watch.id}/restore`)
      .expect(409);
  });

  it('read-only order lookup and review moderation', async () => {
    const tray = await simpleProduct(t, p, 'Brass tray', 2400, 5);
    const c = await customer(t);
    const order = await orderFrom(c, store.id, [[tray.variantId, 1]]);
    const byCode = await admin.api
      .get(`/admin/shop/orders?code=${order.code.toLowerCase()}`)
      .expect(200);
    expect(byCode.body.data.items.map((o: any) => o.id)).toEqual([order.id]);
    const byStore = await admin.api
      .get(`/admin/shop/orders?storeId=${store.id}&status=placed&pageSize=100`)
      .expect(200);
    expect(byStore.body.data.items.map((o: any) => o.id)).toContain(order.id);
    const detail = (
      await admin.api.get(`/admin/shop/orders/${order.id}`).expect(200)
    ).body.data;
    expect(detail).toMatchObject({
      code: order.code,
      items: [{ productName: 'Brass tray' }],
      events: [{ to: 'placed' }],
    });

    await deliverOrder(p, order.id);
    const review = (
      await c.api
        .post(`/shop/order-items/${order.items[0].id}/review`, {
          rating: 1,
          text: 'Rude words',
        })
        .expect(201)
    ).body.data;
    const rating = async () =>
      (
        await sql(`SELECT rating_count AS n FROM products WHERE id = $1`, [
          tray.id,
        ])
      )[0].n;
    expect(await rating()).toBe(1);
    await admin.api
      .post(`/admin/shop/reviews/${review.id}/hide`, {})
      .expect(400);
    await admin.api
      .post(`/admin/shop/reviews/${review.id}/hide`, {
        reason: 'Abusive language',
      })
      .expect(200);
    expect(await rating()).toBe(0);
    expect(await audited('shop.review.hide', review.id)).toBe(1);
    await admin.api.post(`/admin/shop/reviews/${review.id}/unhide`).expect(200);
    expect(await rating()).toBe(1);
  });
});
