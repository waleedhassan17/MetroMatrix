import { createTestApp, TestApp, ApiClient } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { SignedUp } from './utils/factories';
import { Admin, approvedPartner, asset, shopper } from './utils/shopping';
import { buildPkIban } from '../src/common/payments/payment-account.validation';

type Partner = SignedUp & { businessId: string };

describe('Shopping P2: products, inventory, catalogue (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  const cats = new Map<string, string>();

  const cat = (slug: string) => {
    const id = cats.get(slug);
    if (!id) throw new Error(`no category ${slug}`);
    return id;
  };
  const images = (p: Partner, n = 1) =>
    Array.from({ length: n }, () => asset(p.userId, 'product_image'));

  async function product(p: Partner, body: Record<string, unknown>) {
    const res = await p.api.post('/shop/partner/products', {
      description: 'A fixture product for the catalogue tests.',
      status: 'active',
      images: images(p),
      ...body,
    });
    if (res.status !== 201) {
      throw new Error(
        `create failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.data;
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    const rows = await t.ds.query(`SELECT id, slug FROM shop_categories`);
    rows.forEach((r: any) => cats.set(r.slug, r.id));
  });
  afterAll(() => t.close());

  describe('partner products', () => {
    let p: Partner;
    beforeAll(async () => {
      p = await approvedPartner(t, admin, 'store', 'Rules Boutique');
    });

    it('creates a product with 6 variants, each with an opening movement', async () => {
      const variants = ['S', 'M', 'L'].flatMap((size) =>
        ['Maroon', 'Teal'].map((colour) => ({
          option1: size,
          option2: colour,
          colorHex: colour === 'Maroon' ? '#7f1d1d' : '#0f766e',
          stock: 5,
          priceDelta: size === 'L' ? 200 : 0,
        })),
      );
      const created = await product(p, {
        name: 'Embroidered lawn kurta',
        categoryId: cat('women-kurtas-tunics'),
        basePrice: 4500,
        salePrice: 3900,
        tags: ['Lawn', 'eid', 'lawn'],
        images: images(p, 3),
        variants,
      });
      expect(created).toMatchObject({
        status: 'active',
        price: 3900,
        tags: ['lawn', 'eid'],
        totalStock: 30,
        slug: 'embroidered-lawn-kurta',
      });
      expect(created.publishedAt).toBeTruthy();
      expect(created.images).toHaveLength(3);
      expect(created.variants).toHaveLength(6);
      const large = created.variants.find(
        (v: any) => v.option1 === 'L' && v.option2 === 'Maroon',
      );
      expect(large).toMatchObject({
        label: 'L / Maroon',
        price: 4100,
        stock: 5,
        colorHex: '#7F1D1D',
      });

      const movements = await t.ds.query(
        `SELECT m.delta, m.reason, m.balance_after
           FROM inventory_movements m JOIN product_variants v ON v.id = m.variant_id
          WHERE v.product_id = $1`,
        [created.id],
      );
      expect(movements).toHaveLength(6);
      movements.forEach((m: any) =>
        expect(m).toEqual({ delta: 5, reason: 'manual', balance_after: 5 }),
      );

      // Same name again gets a distinct slug.
      const twin = await product(p, {
        name: 'Embroidered lawn kurta',
        categoryId: cat('women-kurtas-tunics'),
        basePrice: 4500,
      });
      expect(twin.slug).toMatch(/^embroidered-lawn-kurta-[0-9a-f]{4}$/);
      expect(twin.variants).toEqual([
        expect.objectContaining({
          option1: null,
          option2: null,
          label: 'Default',
          stock: 0,
        }),
      ]);
    });

    it('rejects a sale price at or above the regular price', async () => {
      for (const salePrice of [4500, 5000]) {
        const res = await p.api
          .post('/shop/partner/products', {
            name: 'Overpriced sale',
            description: 'x',
            categoryId: cat('women-kurtas-tunics'),
            basePrice: 4500,
            salePrice,
          })
          .expect(400);
        expect(res.body.error).toMatchObject({
          code: 'VALIDATION_FAILED',
          details: { fields: { salePrice: [expect.any(String)] } },
        });
      }
      const draft = await product(p, {
        name: 'Cotton kurta',
        categoryId: cat('women-kurtas-tunics'),
        basePrice: 3000,
        status: 'draft',
      });
      await p.api
        .patch(`/shop/partner/products/${draft.id}`, { salePrice: 3000 })
        .expect(400);
      await p.api
        .patch(`/shop/partner/products/${draft.id}`, {
          basePrice: 2000,
          salePrice: 2500,
        })
        .expect(400);
      // The DB backs the rule up even if the service didn't.
      await expect(
        t.ds.query(
          `UPDATE products SET sale_price = base_price WHERE id = $1`,
          [draft.id],
        ),
      ).rejects.toThrow(/CHK_products_prices/);
    });

    it('enforces publish, variant, image and category rules', async () => {
      const base = {
        name: 'Rule check',
        description: 'x',
        categoryId: cat('women-kurtas-tunics'),
        basePrice: 1000,
      };
      const noImage = await p.api
        .post('/shop/partner/products', { ...base, status: 'active' })
        .expect(400);
      expect(noImage.body.error.details.fields.images).toBeDefined();

      const allInactive = await p.api
        .post('/shop/partner/products', {
          ...base,
          status: 'active',
          images: images(p),
          variants: [{ option1: 'S', isActive: false }],
        })
        .expect(400);
      expect(allInactive.body.error.details.fields.variants).toBeDefined();

      const dupes = await p.api
        .post('/shop/partner/products', {
          ...base,
          variants: [{ option1: 'S' }, { option1: ' s ' }],
        })
        .expect(400);
      expect(dupes.body.error.message).toMatch(/same options/);

      await p.api
        .post('/shop/partner/products', {
          ...base,
          variants: [{ option1: 'S', priceDelta: -1000 }],
        })
        .expect(400);

      const someoneElse = await shopper(t);
      const foreignImage = await p.api
        .post('/shop/partner/products', {
          ...base,
          images: [asset(someoneElse.userId, 'product_image')],
        })
        .expect(400);
      expect(foreignImage.body.error.details.fields['images.0']).toBeDefined();
      await p.api
        .post('/shop/partner/products', {
          ...base,
          images: [asset(p.userId, 'store_branding')],
        })
        .expect(400);

      const badCategory = await p.api
        .post('/shop/partner/products', {
          ...base,
          categoryId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
      expect(badCategory.body.error.details.fields.categoryId).toBeDefined();
    });

    it('PATCH syncs variants: update by id, add new, deactivate missing; stock edits are movements', async () => {
      const created = await product(p, {
        name: 'Khaddar shawl',
        categoryId: cat('women-dupattas-shawls'),
        basePrice: 2200,
        variants: [
          { option1: 'Brown', stock: 4 },
          { option1: 'Grey', stock: 2 },
        ],
      });
      const [brown, grey] = created.variants;
      const res = await p.api
        .patch(`/shop/partner/products/${created.id}`, {
          name: 'Khaddar shawl (winter)',
          variants: [
            { id: brown.id, stock: 9 },
            { option1: 'Black', stock: 3 },
          ],
        })
        .expect(200);
      const byLabel = Object.fromEntries(
        res.body.data.variants.map((v: any) => [v.label, v]),
      );
      expect(byLabel.Brown).toMatchObject({
        id: brown.id,
        stock: 9,
        isActive: true,
      });
      expect(byLabel.Grey).toMatchObject({
        id: grey.id,
        stock: 2,
        isActive: false,
      });
      expect(byLabel.Black).toMatchObject({ stock: 3, isActive: true });
      expect(res.body.data.slug).toBe('khaddar-shawl-winter');
      expect(res.body.data.totalStock).toBe(12);

      const [m] = await t.ds.query(
        `SELECT delta, reason, balance_after FROM inventory_movements
          WHERE variant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [brown.id],
      );
      expect(m).toEqual({ delta: 5, reason: 'manual', balance_after: 9 });

      // Re-adding Grey by its options revives the same row.
      const revived = await p.api
        .patch(`/shop/partner/products/${created.id}`, {
          variants: [
            { id: brown.id },
            { option1: 'grey' },
            { option1: 'Black' },
          ],
        })
        .expect(200);
      const greyAgain = revived.body.data.variants.find(
        (v: any) => v.id === grey.id,
      );
      expect(greyAgain.isActive).toBe(true);
    });

    it('duplicates as a draft with zero stock; delete hard-deletes an unordered product', async () => {
      const created = await product(p, {
        name: 'Block-print scarf',
        categoryId: cat('women-dupattas-shawls'),
        basePrice: 1500,
        variants: [{ option1: 'Indigo', stock: 7 }],
      });
      const copy = await p.api
        .post(`/shop/partner/products/${created.id}/duplicate`)
        .expect(201);
      expect(copy.body.data).toMatchObject({
        name: 'Block-print scarf (copy)',
        status: 'draft',
        publishedAt: null,
        totalStock: 0,
      });
      expect(copy.body.data.images).toHaveLength(1);

      const del = await p.api
        .delete(`/shop/partner/products/${copy.body.data.id}`)
        .expect(200);
      expect(del.body.data).toEqual({ archived: false, deleted: true });
      await p.api
        .get(`/shop/partner/products/${copy.body.data.id}`)
        .expect(404);

      const list = await p.api
        .get('/shop/partner/products?status=active&q=scarf')
        .expect(200);
      expect(list.body.data.items.map((i: any) => i.id)).toEqual([created.id]);
    });
  });

  describe('inventory', () => {
    let p: Partner;
    let variantIds: string[];

    beforeAll(async () => {
      p = await approvedPartner(t, admin, 'store', 'Stock Room');
      const created = await product(p, {
        name: 'Lawn three-piece',
        categoryId: cat('women-shalwar-kameez'),
        basePrice: 5200,
        variants: ['S', 'M', 'L'].flatMap((s) =>
          ['Peach', 'Mint'].map((c) => ({ option1: s, option2: c, stock: 5 })),
        ),
      });
      variantIds = created.variants.map((v: any) => v.id);
    });

    const lastMovement = async (variantId: string) =>
      (
        await p.api
          .get(`/shop/partner/inventory/${variantId}/movements?pageSize=1`)
          .expect(200)
      ).body.data.items[0];

    it('manual adjustments write movements with the right balance_after', async () => {
      const v = variantIds[0];
      const minus = await p.api
        .patch(`/shop/partner/inventory/${v}`, { delta: -2 })
        .expect(200);
      expect(minus.body.data).toEqual({ variantId: v, stock: 3 });
      expect(await lastMovement(v)).toMatchObject({
        delta: -2,
        reason: 'manual',
        balanceAfter: 3,
        actorUserId: p.userId,
      });

      await p.api
        .patch(`/shop/partner/inventory/${v}`, { setTo: 10 })
        .expect(200);
      expect(await lastMovement(v)).toMatchObject({
        delta: 7,
        balanceAfter: 10,
      });

      const below = await p.api
        .patch(`/shop/partner/inventory/${v}`, { delta: -11 })
        .expect(400);
      expect(below.body.error.code).toBe('VALIDATION_FAILED');
      await p.api
        .patch(`/shop/partner/inventory/${v}`, { delta: 1, setTo: 2 })
        .expect(400);
      await p.api.patch(`/shop/partner/inventory/${v}`, {}).expect(400);

      const history = await p.api
        .get(`/shop/partner/inventory/${v}/movements`)
        .expect(200);
      expect(history.body.data.total).toBe(3); // opening + two adjustments
      expect(history.body.data.items.map((m: any) => m.balanceAfter)).toEqual([
        10, 3, 5,
      ]);
    });

    it('bulk sets every row in one go, each with a bulk movement', async () => {
      const [, v1, v2, v3] = variantIds;
      const res = await p.api
        .post('/shop/partner/inventory/bulk', [
          { variantId: v1, setTo: 0 },
          { variantId: v2, setTo: 8 },
          { variantId: v3, setTo: 5 }, // unchanged: no movement
        ])
        .expect(200);
      expect(res.body.data.updated).toBe(3);
      expect(res.body.data.items).toEqual(
        expect.arrayContaining([
          { variantId: v1, stock: 0 },
          { variantId: v2, stock: 8 },
          { variantId: v3, stock: 5 },
        ]),
      );
      expect(await lastMovement(v1)).toMatchObject({
        delta: -5,
        reason: 'bulk',
        balanceAfter: 0,
      });
      expect(await lastMovement(v2)).toMatchObject({
        delta: 3,
        reason: 'bulk',
        balanceAfter: 8,
      });
      expect(await lastMovement(v3)).toMatchObject({
        reason: 'manual',
        balanceAfter: 5,
      });

      const low = await p.api
        .get('/shop/partner/inventory?lowStock=true')
        .expect(200);
      expect(low.body.data.items.map((i: any) => i.variantId)).toEqual([v1]);

      await p.api.post('/shop/partner/inventory/bulk', []).expect(400);
      await p.api
        .post('/shop/partner/inventory/bulk', [{ variantId: v1, setTo: -1 }])
        .expect(400);
      await p.api
        .post('/shop/partner/inventory/bulk', [
          { variantId: v1, setTo: 1 },
          { variantId: v1, setTo: 2 },
        ])
        .expect(400);
      await p.api
        .post('/shop/partner/inventory/bulk', { variantId: v1, setTo: 1 })
        .expect(400);
    });
  });

  describe('store isolation', () => {
    it('partner B gets 404 for partner A on every product and inventory route', async () => {
      const a = await approvedPartner(t, admin, 'store', 'Alpha Apparel');
      const b = await approvedPartner(t, admin, 'store', 'Bravo Bazaar');
      const aCollection = (
        await a.api
          .post('/shop/partner/collections', { name: 'Alpha picks' })
          .expect(201)
      ).body.data;
      const aProduct = await product(a, {
        name: 'Alpha kurta',
        categoryId: cat('women-kurtas-tunics'),
        basePrice: 3000,
        variants: [{ option1: 'M', stock: 4 }],
      });
      const aVariant = aProduct.variants[0].id;
      const bProduct = await product(b, {
        name: 'Bravo kurta',
        categoryId: cat('women-kurtas-tunics'),
        basePrice: 3000,
        variants: [{ option1: 'M', stock: 6 }],
      });
      const bVariant = bProduct.variants[0].id;

      const attempts: Array<[string, () => ReturnType<ApiClient['get']>]> = [
        [
          'GET product',
          () => b.api.get(`/shop/partner/products/${aProduct.id}`),
        ],
        [
          'PATCH product',
          () =>
            b.api.patch(`/shop/partner/products/${aProduct.id}`, {
              name: 'Mine now',
            }),
        ],
        [
          'DELETE product',
          () => b.api.delete(`/shop/partner/products/${aProduct.id}`),
        ],
        [
          'duplicate',
          () => b.api.post(`/shop/partner/products/${aProduct.id}/duplicate`),
        ],
        [
          'adjust',
          () =>
            b.api.patch(`/shop/partner/inventory/${aVariant}`, { setTo: 0 }),
        ],
        [
          'movements',
          () => b.api.get(`/shop/partner/inventory/${aVariant}/movements`),
        ],
        [
          'bulk foreign',
          () =>
            b.api.post('/shop/partner/inventory/bulk', [
              { variantId: aVariant, setTo: 0 },
            ]),
        ],
        [
          'bulk mixed',
          () =>
            b.api.post('/shop/partner/inventory/bulk', [
              { variantId: bVariant, setTo: 99 },
              { variantId: aVariant, setTo: 0 },
            ]),
        ],
        [
          'own product, foreign variant id',
          () =>
            b.api.patch(`/shop/partner/products/${bProduct.id}`, {
              variants: [{ id: aVariant, stock: 0 }],
            }),
        ],
        [
          'own product, foreign collection',
          () =>
            b.api.patch(`/shop/partner/products/${bProduct.id}`, {
              collectionId: aCollection.id,
            }),
        ],
      ];
      for (const [label, call] of attempts) {
        const res = await call();
        expect({
          label,
          status: res.status,
          code: res.body.error?.code,
        }).toEqual({
          label,
          status: 404,
          code: 'NOT_FOUND',
        });
      }

      // Nothing moved on either side — the mixed bulk was all-or-nothing.
      const [{ stock: aStock }] = await t.ds.query(
        `SELECT stock FROM product_variants WHERE id = $1`,
        [aVariant],
      );
      const [{ stock: bStock }] = await t.ds.query(
        `SELECT stock FROM product_variants WHERE id = $1`,
        [bVariant],
      );
      expect([aStock, bStock]).toEqual([4, 6]);
      expect(
        (await a.api.get(`/shop/partner/products/${aProduct.id}`).expect(200))
          .body.data.name,
      ).toBe('Alpha kurta');

      const bList = await b.api.get('/shop/partner/products').expect(200);
      expect(bList.body.data.items.map((i: any) => i.id)).toEqual([
        bProduct.id,
      ]);
      const bInventory = await b.api.get('/shop/partner/inventory').expect(200);
      expect(bInventory.body.data.items.map((i: any) => i.variantId)).toEqual([
        bVariant,
      ]);

      const doctor = await approvedPartner(t, admin, 'doctor');
      expect(
        (await doctor.api.get('/shop/partner/products').expect(403)).body.error
          .code,
      ).toBe('WRONG_SERVICE');
    });
  });

  describe('public catalogue', () => {
    let a: Partner;
    let b: Partner;
    const ids: Record<string, string> = {};
    let collectionId: string;
    let anon: ApiClient;

    const names = async (query: string) => {
      const res = await anon.get(`/shop/products?${query}`).expect(200);
      return res.body.data.items.map((i: any) => i.name);
    };

    beforeAll(async () => {
      anon = new ApiClient(t.http);
      a = await approvedPartner(t, admin, 'store', 'Lahore Looms');
      b = await approvedPartner(t, admin, 'store', 'Karachi Kilns');
      collectionId = (
        await a.api
          .post('/shop/partner/collections', { name: 'Eid edit' })
          .expect(201)
      ).body.data.id;

      ids.kurta = (
        await product(a, {
          name: 'Embroidered lawn kurta',
          categoryId: cat('women-kurtas-tunics'),
          collectionId,
          basePrice: 4500,
          salePrice: 3900,
          tags: ['lawn', 'eid'],
          variants: [
            { option1: 'S', stock: 4 },
            { option1: 'M', stock: 2 },
            { option1: 'L', stock: 0 },
          ],
        })
      ).id;
      ids.dupatta = (
        await product(a, {
          name: 'Silk dupatta',
          categoryId: cat('women-dupattas-shawls'),
          basePrice: 2500,
          variants: [{ option1: 'Rose', stock: 5 }],
        })
      ).id;
      ids.khussa = (
        await product(a, {
          name: 'Leather khussa',
          categoryId: cat('women-footwear'),
          basePrice: 3200,
          salePrice: 2800,
          variants: [{ option1: '38', stock: 0 }],
        })
      ).id;
      ids.waistcoat = (
        await product(a, {
          name: 'Velvet waistcoat',
          categoryId: cat('men-waistcoats'),
          basePrice: 6000,
          variants: [{ option1: 'M', stock: 2 }],
        })
      ).id;
      ids.draft = (
        await product(a, {
          name: 'Draft scarf',
          categoryId: cat('women-dupattas-shawls'),
          basePrice: 1000,
          status: 'draft',
        })
      ).id;
      ids.mug = (
        await product(b, {
          name: 'Clay chai mug',
          categoryId: cat('handmade-pottery-ceramics'),
          basePrice: 900,
          variants: [{ option1: 'Blue', stock: 10 }],
        })
      ).id;

      // Ratings, sales and publish dates come from P4/P5 flows; set them directly here.
      const fixture: Array<[string, number, number, number]> = [
        // key, rating_avg, sold_count, days since published
        ['kurta', 4.5, 10, 4],
        ['dupatta', 3.0, 50, 3],
        ['khussa', 4.0, 5, 2],
        ['waistcoat', 0, 1, 1],
      ];
      for (const [key, rating, sold, days] of fixture) {
        await t.ds.query(
          `UPDATE products SET rating_avg = $2, sold_count = $3, published_at = now() - ($4 || ' days')::interval WHERE id = $1`,
          [ids[key], rating, sold, days],
        );
      }
    });

    it('lists only visible products; every filter changes the result', async () => {
      const store = `storeId=${(await a.api.get('/shop/partner/store')).body.data.id}`;
      const all = [
        'Silk dupatta',
        'Embroidered lawn kurta',
        'Leather khussa',
        'Velvet waistcoat',
      ];
      expect(await names(store)).toEqual(all); // draft never shows

      const cases: Array<[string, string[]]> = [
        [
          `categoryId=${cat('women')}`,
          ['Silk dupatta', 'Embroidered lawn kurta', 'Leather khussa'],
        ],
        [`categoryId=${cat('women-footwear')}`, ['Leather khussa']],
        [`collectionId=${collectionId}`, ['Embroidered lawn kurta']],
        ['minPrice=3000', ['Embroidered lawn kurta', 'Velvet waistcoat']], // khussa's sale price is 2800
        ['maxPrice=3000', ['Silk dupatta', 'Leather khussa']],
        [
          'minPrice=2600&maxPrice=4000',
          ['Embroidered lawn kurta', 'Leather khussa'],
        ],
        [
          'inStock=true',
          ['Silk dupatta', 'Embroidered lawn kurta', 'Velvet waistcoat'],
        ],
        ['minRating=4', ['Embroidered lawn kurta', 'Leather khussa']],
        ['onSale=true', ['Embroidered lawn kurta', 'Leather khussa']],
      ];
      for (const [filter, expected] of cases) {
        expect({ filter, names: await names(`${store}&${filter}`) }).toEqual({
          filter,
          names: expected,
        });
      }

      const other = (await b.api.get('/shop/partner/store')).body.data.id;
      expect(await names(`storeId=${other}`)).toEqual(['Clay chai mug']);

      const page = await anon
        .get(`/shop/products?${store}&pageSize=2&page=2`)
        .expect(200);
      expect(page.body.data).toMatchObject({ total: 4, page: 2, pageSize: 2 });
      expect(page.body.data.items.map((i: any) => i.name)).toEqual(
        all.slice(2),
      );

      await anon.get('/shop/products?sort=cheapest').expect(400);
      await anon.get('/shop/products?minRating=6').expect(400);
    });

    it('every sort orders the result differently', async () => {
      const store = `storeId=${(await a.api.get('/shop/partner/store')).body.data.id}`;
      const sorts: Array<[string, string[]]> = [
        [
          'popular',
          [
            'Silk dupatta',
            'Embroidered lawn kurta',
            'Leather khussa',
            'Velvet waistcoat',
          ],
        ],
        [
          'newest',
          [
            'Velvet waistcoat',
            'Leather khussa',
            'Silk dupatta',
            'Embroidered lawn kurta',
          ],
        ],
        [
          'price_asc',
          [
            'Silk dupatta',
            'Leather khussa',
            'Embroidered lawn kurta',
            'Velvet waistcoat',
          ],
        ],
        [
          'price_desc',
          [
            'Velvet waistcoat',
            'Embroidered lawn kurta',
            'Leather khussa',
            'Silk dupatta',
          ],
        ],
        [
          'rating',
          [
            'Embroidered lawn kurta',
            'Leather khussa',
            'Silk dupatta',
            'Velvet waistcoat',
          ],
        ],
      ];
      const seen = new Set<string>();
      for (const [sort, expected] of sorts) {
        const got = await names(`${store}&sort=${sort}`);
        expect({ sort, got }).toEqual({ sort, got: expected });
        seen.add(got.join('|'));
      }
      expect(seen.size).toBe(sorts.length);

      // relevance ranks the match: the name hit (weight A) beats the tag-only hit (weight B).
      await a.api
        .patch(`/shop/partner/products/${ids.dupatta}`, { tags: ['kurta-set'] })
        .expect(200);
      expect(await names(`${store}&q=kurta&sort=relevance`)).toEqual([
        'Embroidered lawn kurta',
        'Silk dupatta',
      ]);
      expect(await names(`${store}&q=kurta&sort=price_asc`)).toEqual([
        'Silk dupatta',
        'Embroidered lawn kurta',
      ]);
    });

    it('search tolerates typos and uses tags; suggest returns products and stores', async () => {
      const store = `storeId=${(await a.api.get('/shop/partner/store')).body.data.id}`;
      expect(await names(`${store}&q=kurtta`)).toEqual([
        'Embroidered lawn kurta',
      ]);
      expect(await names(`${store}&q=eid`)).toEqual(['Embroidered lawn kurta']);
      expect(await names(`${store}&q=velvet%20-silk`)).toEqual([
        'Velvet waistcoat',
      ]);
      expect(await names(`${store}&q=zzqx`)).toEqual([]);

      const suggest = await anon
        .get('/shop/products/suggest?q=khus')
        .expect(200);
      expect(suggest.body.data.products.map((p: any) => p.name)).toContain(
        'Leather khussa',
      );
      const stores = await anon
        .get('/shop/products/suggest?q=lahore')
        .expect(200);
      expect(stores.body.data.stores.map((s: any) => s.name)).toContain(
        'Lahore Looms',
      );
      await anon.get('/shop/products/suggest').expect(400);
    });

    it('product detail shows stock as flags only; drafts and paused stores are 404', async () => {
      const res = await anon.get(`/shop/products/${ids.kurta}`).expect(200);
      const d = res.body.data;
      expect(d).toMatchObject({
        name: 'Embroidered lawn kurta',
        price: 3900,
        onSale: true,
        inStock: true,
        isWishlisted: false,
        options: { option1: ['S', 'M', 'L'], option2: [] },
        store: { name: 'Lahore Looms', codEnabled: true, returnWindowDays: 7 },
        ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      });
      expect(
        d.variants.map((v: any) => [v.label, v.inStock, v.lowStock]),
      ).toEqual([
        ['S', true, false],
        ['M', true, true],
        ['L', false, false],
      ]);
      d.variants.forEach((v: any) => expect(v).not.toHaveProperty('stock'));

      await anon.get(`/shop/products/${ids.draft}`).expect(404);
      await anon.get('/shop/products/not-a-uuid').expect(400);

      const related = await anon
        .get(`/shop/products/${ids.kurta}/related`)
        .expect(200);
      expect(related.body.data.map((p: any) => p.id)).not.toContain(ids.kurta);

      await b.api
        .patch('/shop/partner/store/settings', { isPaused: true })
        .expect(200);
      await anon.get(`/shop/products/${ids.mug}`).expect(404);
      const other = (await b.api.get('/shop/partner/store')).body.data;
      expect(await names(`storeId=${other.id}`)).toEqual([]);
      await anon.get(`/shop/stores/${other.slug}`).expect(404);
      await b.api
        .patch('/shop/partner/store/settings', { isPaused: false })
        .expect(200);
      await anon.get(`/shop/products/${ids.mug}`).expect(200);
    });

    it('storefront shows policies and payment kinds, never account numbers', async () => {
      const iban = buildPkIban('MEZN', '0009876543210123');
      await a.api
        .post('/shop/partner/store/payment-accounts', {
          kind: 'bank',
          accountTitle: 'Lahore Looms',
          accountNumber: iban,
          bankName: 'Meezan Bank',
        })
        .expect(201);
      const slug = (await a.api.get('/shop/partner/store')).body.data.slug;
      const res = await anon.get(`/shop/stores/${slug}`).expect(200);
      expect(res.body.data).toMatchObject({
        name: 'Lahore Looms',
        productCount: 4,
        collections: [{ name: 'Eid edit', productCount: 1 }],
        policies: {
          paymentMethods: ['cod', 'transfer'],
          transferVia: ['bank'],
          codLimit: 10000,
          returnWindowDays: 7,
        },
      });
      expect(JSON.stringify(res.body)).not.toContain(iban.slice(4));

      const list = await anon.get('/shop/stores?q=looms').expect(200);
      expect(list.body.data.items.map((s: any) => s.name)).toEqual([
        'Lahore Looms',
      ]);
      const pottery = await anon
        .get(`/shop/stores?categoryId=${cat('handmade')}`)
        .expect(200);
      expect(pottery.body.data.items.map((s: any) => s.name)).toContain(
        'Karachi Kilns',
      );
      expect(pottery.body.data.items.map((s: any) => s.name)).not.toContain(
        'Lahore Looms',
      );

      await a.api
        .patch('/shop/partner/store/settings', { deliveryCities: ['Lahore'] })
        .expect(200);
      const karachi = await anon
        .get('/shop/stores?city=karachi&q=looms')
        .expect(200);
      expect(karachi.body.data.items).toEqual([]);
      const lahore = await anon
        .get('/shop/stores?city=%20LAHORE%20&q=looms')
        .expect(200);
      expect(lahore.body.data.items).toHaveLength(1);
    });

    it('home and categories; a signed-in caller is optional', async () => {
      const cats = await anon.get('/shop/categories').expect(200);
      expect(cats.body.data).toHaveLength(8);
      const women = cats.body.data.find((c: any) => c.slug === 'women');
      expect(women.children.map((c: any) => c.slug)).toContain(
        'women-footwear',
      );

      const home = await anon.get('/shop/home').expect(200);
      expect(Object.keys(home.body.data).sort()).toEqual(
        [
          'banners',
          'categories',
          'featuredStores',
          'newArrivals',
          'trending',
        ].sort(),
      );
      expect(home.body.data.newArrivals.map((p: any) => p.id)).not.toContain(
        ids.draft,
      );

      const customer = await shopper(t);
      const signedIn = await customer.api
        .get(`/shop/products/${ids.kurta}`)
        .expect(200);
      expect(signedIn.body.data.isWishlisted).toBe(false);

      // A bad token on an optional route is just anonymous, not 401.
      const stale = new ApiClient(t.http);
      stale.token = 'not.a.jwt';
      await stale.get('/shop/home').expect(200);
    });
  });
});
