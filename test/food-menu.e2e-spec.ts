import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, asset } from './utils/shopping';
import { Vendor, expectStatus, foodVendor, setUpVendor } from './utils/food';
import { MenuReadService } from '../src/modules/food/menu/menu-read.service';
import { priceChoice } from '../src/modules/food/menu/item-pricing';

const TZ = 'Asia/Karachi';
const pkt = (date: string, hhmm: string) =>
  new Date(`${date}T${hhmm}:00+05:00`);
const FRIDAY = '2026-10-16';
const SATURDAY = '2026-10-17';

describe('Food P2: menu, option groups, availability, portions, pre-order (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let read: MenuReadService;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    read = t.app.get(MenuReadService);
  });
  afterAll(() => t.close());

  /** A burger with Regular/Large, a required drink (1/1) and optional extras (max 3). */
  async function burgerMenu(v: Vendor) {
    const cat = await expectStatus(
      await v.api.post('/food/vendor/menu/categories', { name: 'Burgers' }),
      201,
    );
    const photo = asset(v.userId, 'menu_item');
    const item = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Zinger Burger',
        description: 'Crispy fillet, house sauce',
        photoUrl: photo.url,
        basePrice: 550,
        tags: ['spicy', 'bestseller'],
        variants: [
          { name: 'Regular', price: 550 },
          { name: 'Large', price: 750 },
        ],
      }),
      201,
    );
    const drink = await expectStatus(
      await v.api.post('/food/vendor/menu/option-groups', {
        name: 'Your drink',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'Cola', priceDelta: 0, isDefault: true },
          { name: 'Lassi', priceDelta: 80 },
        ],
      }),
      201,
    );
    const extras = await expectStatus(
      await v.api.post('/food/vendor/menu/option-groups', {
        name: 'Extras',
        minSelect: 0,
        maxSelect: 3,
        options: [
          { name: 'Cheese', priceDelta: 60 },
          { name: 'Jalapeño', priceDelta: 40 },
          { name: 'Egg', priceDelta: 50 },
          { name: 'Extra patty', priceDelta: 250 },
        ],
      }),
      201,
    );
    const linked = await expectStatus(
      await v.api.put(`/food/vendor/menu/items/${item.id}/option-groups`, [
        { groupId: drink.id },
        { groupId: extras.id },
      ]),
      200,
    );
    return { cat, item: linked, drink, extras };
  }

  it('variants + a required group (1/1) + an optional group (max 3); errors name the item and group', async () => {
    const v = await foodVendor(t, admin);
    const { item, drink, extras } = await burgerMenu(v);
    expect(item.variants.map((x: any) => [x.name, x.price])).toEqual([
      ['Regular', 550],
      ['Large', 750],
    ]);
    expect(item.optionGroups.map((g: any) => g.groupId)).toEqual([
      drink.id,
      extras.id,
    ]);
    expect(
      await expectStatus(
        await v.api.get(`/food/vendor/menu/option-groups/${drink.id}`),
        200,
      ),
    ).toMatchObject({
      required: true,
      minSelect: 1,
      maxSelect: 1,
      usedByItems: 1,
    });

    const sheet = (await read.itemSheet(item.id, v.branchId, TZ))!;
    expect(sheet).toMatchObject({
      name: 'Zinger Burger',
      fromPrice: 550,
      available: true,
    });
    expect(sheet.groups.map((g) => [g.name, g.required, g.maxSelect])).toEqual([
      ['Your drink', true, 1],
      ['Extras', false, 3],
    ]);
    const snap = (await read.snapshots(v.branchId, [item.id])).get(item.id)!;
    const large = item.variants[1].id;
    const lassi = drink.options[1].id;
    const [cheese, jalapeno, egg, patty] = extras.options.map((o: any) => o.id);
    expect(
      priceChoice(snap, { variantId: large, optionIds: [lassi, cheese, egg] })
        .unitPrice,
    ).toBe(750 + 80 + 60 + 50);
    expect(() =>
      priceChoice(snap, { variantId: large, optionIds: [cheese] }),
    ).toThrow(/drink/);
    try {
      priceChoice(snap, {
        variantId: large,
        optionIds: [lassi, cheese, jalapeno, egg, patty],
      });
    } catch (e: any) {
      expect([e.code, e.details.item, e.details.group]).toEqual([
        'OPTION_LIMIT',
        'Zinger Burger',
        'Extras',
      ]);
    }
    // A min above max, or a max above the options, is refused.
    expect(
      (
        await v.api.post('/food/vendor/menu/option-groups', {
          name: 'Bad',
          minSelect: 2,
          maxSelect: 1,
          options: [{ name: 'a', priceDelta: 0 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await v.api.post('/food/vendor/menu/option-groups', {
          name: 'Bad',
          minSelect: 0,
          maxSelect: 3,
          options: [{ name: 'a', priceDelta: 0 }],
        })
      ).status,
    ).toBe(400);
  });

  it('variant-scoped groups, reuse across items, duplicate, reorder', async () => {
    const v = await foodVendor(t, admin);
    const { cat, item, drink, extras } = await burgerMenu(v);
    const meal = await expectStatus(
      await v.api.post('/food/vendor/menu/option-groups', {
        name: 'Make it a meal',
        minSelect: 0,
        maxSelect: 1,
        options: [{ name: 'Fries + drink', priceDelta: 250 }],
      }),
      201,
    );
    const large = item.variants[1].id;
    await expectStatus(
      await v.api.put(`/food/vendor/menu/items/${item.id}/option-groups`, [
        { groupId: drink.id },
        { groupId: extras.id },
        { groupId: meal.id, variantId: large },
      ]),
      200,
    );
    const sheet = (await read.itemSheet(item.id, v.branchId, TZ))!;
    expect(sheet.variants.find((x) => x.id === large)!.groupIds).toContain(
      meal.id,
    );
    expect(sheet.variants.find((x) => x.id !== large)!.groupIds).not.toContain(
      meal.id,
    );

    const second = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Chicken Burger',
        basePrice: 450,
      }),
      201,
    );
    await expectStatus(
      await v.api.put(`/food/vendor/menu/items/${second.id}/option-groups`, [
        { groupId: drink.id },
      ]),
      200,
    );
    expect(
      (
        await expectStatus(
          await v.api.get(`/food/vendor/menu/option-groups/${drink.id}`),
          200,
        )
      ).usedByItems,
    ).toBe(2);

    const copy = await expectStatus(
      await v.api.post(`/food/vendor/menu/items/${item.id}/duplicate`),
      201,
    );
    expect(copy).toMatchObject({
      name: 'Zinger Burger (copy)',
      isActive: false,
    });
    expect(copy.variants.map((x: any) => x.name)).toEqual(['Regular', 'Large']);
    expect(
      copy.optionGroups.find((g: any) => g.groupId === meal.id).variantId,
    ).toBe(copy.variants[1].id);

    const reordered = await expectStatus(
      await v.api.put('/food/vendor/menu/items/reorder', {
        ids: [second.id, item.id, copy.id],
      }),
      200,
    );
    expect(reordered.map((i: any) => i.id)).toEqual([
      second.id,
      item.id,
      copy.id,
    ]);
    // A category with items can't be deleted.
    expect(
      (await v.api.delete(`/food/vendor/menu/categories/${cat.id}`)).status,
    ).toBe(409);
  });

  it('86 an item (now, or until a time) and an option: gone for customers', async () => {
    const v = await foodVendor(t, admin);
    const { item, drink } = await burgerMenu(v);
    const now = new Date();
    const names = async (at = new Date()) =>
      (
        await read.customerMenu(v.brandId, v.branchId, TZ, at)
      ).categories.flatMap((c: any) => c.items.map((i: any) => i.name));
    expect(await names()).toEqual(['Zinger Burger']);
    await expectStatus(
      await v.api.patch('/food/vendor/availability', {
        items: [{ itemId: item.id, isAvailable: false }],
      }),
      200,
    );
    expect(await names()).toEqual([]);
    const until = new Date(now.getTime() + 2 * 3600_000);
    const av = await expectStatus(
      await v.api.patch('/food/vendor/availability', {
        items: [
          {
            itemId: item.id,
            isAvailable: false,
            unavailableUntil: until.toISOString(),
          },
        ],
      }),
      200,
    );
    expect(av.items[0]).toMatchObject({ isAvailable: false });
    expect(await names()).toEqual([]);
    expect(await names(new Date(until.getTime() + 60_000))).toEqual([
      'Zinger Burger',
    ]);
    await expectStatus(
      await v.api.patch('/food/vendor/availability', {
        items: [{ itemId: item.id, isAvailable: true }],
        options: [{ optionId: drink.options[1].id, isAvailable: false }],
      }),
      200,
    );
    const sheet = (await read.itemSheet(item.id, v.branchId, TZ))!;
    expect(
      sheet.groups[0].options.find((o) => o.name === 'Lassi')!.available,
    ).toBe(false);
  });

  it('a Friday special is on the menu only on Fridays; breakfast only in its window', async () => {
    const v = await foodVendor(t, admin);
    const { cat } = await burgerMenu(v);
    const special = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Friday Mutton Biryani',
        basePrice: 900,
        days: [5],
      }),
      201,
    );
    expect(special.days).toEqual([5]);
    const names = async (at: Date) =>
      (
        await read.customerMenu(v.brandId, v.branchId, TZ, at)
      ).categories.flatMap((c: any) => c.items.map((i: any) => i.name));
    expect(await names(pkt(FRIDAY, '13:00'))).toContain(
      'Friday Mutton Biryani',
    );
    expect(await names(pkt(SATURDAY, '13:00'))).not.toContain(
      'Friday Mutton Biryani',
    );
    // Weekly menu moves it to Saturdays.
    await expectStatus(
      await v.api.put('/food/vendor/weekly-menu', [
        { itemId: special.id, days: [6] },
      ]),
      200,
    );
    expect(await names(pkt(SATURDAY, '13:00'))).toContain(
      'Friday Mutton Biryani',
    );

    const breakfast = await expectStatus(
      await v.api.post('/food/vendor/menu/categories', {
        name: 'Breakfast',
        availableFrom: '07:00',
        availableTo: '11:00',
      }),
      201,
    );
    await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: breakfast.id,
        name: 'Halwa Puri',
        basePrice: 450,
      }),
      201,
    );
    const morning = await read.customerMenu(
      v.brandId,
      v.branchId,
      TZ,
      pkt(FRIDAY, '08:00'),
    );
    const afternoon = await read.customerMenu(
      v.brandId,
      v.branchId,
      TZ,
      pkt(FRIDAY, '13:00'),
    );
    expect(
      morning.categories.find((c: any) => c.name === 'Breakfast'),
    ).toMatchObject({ availableNow: true, items: [{ available: true }] });
    expect(
      afternoon.categories.find((c: any) => c.name === 'Breakfast'),
    ).toMatchObject({
      availableNow: false,
      availableFrom: '07:00',
      items: [{ available: false, unavailableReason: 'outside_hours' }],
    });
    expect(
      (
        await v.api.post('/food/vendor/menu/categories', {
          name: 'Half',
          availableFrom: '07:00',
        })
      ).status,
    ).toBe(400);
  });

  it('home kitchen portions: "6 left today", decrements, sold out; pre-order slots', async () => {
    const v = await foodVendor(t, admin, 'home_kitchen');
    const cat = await expectStatus(
      await v.api.post('/food/vendor/menu/categories', { name: 'Today' }),
      201,
    );
    const daal = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Daal Chawal',
        basePrice: 350,
      }),
      201,
    );
    const today = await expectStatus(
      await v.api.patch('/food/vendor/today', {
        items: [{ itemId: daal.id, portions: 6 }],
      }),
      200,
    );
    expect(today.items[0]).toMatchObject({
      dailyLimit: 6,
      remainingToday: 6,
      sold: 0,
      cooking: true,
    });
    const card = async () =>
      (await read.customerMenu(v.brandId, v.branchId, TZ)).categories[0]
        ?.items[0];
    expect(await card()).toMatchObject({
      remainingToday: 6,
      remainingLabel: '6 left today',
      available: true,
    });
    // Checkout decrements atomically (P4); here the row moves like it would.
    await t.ds.query(
      `UPDATE branch_item_overrides SET remaining_today = remaining_today - 4 WHERE branch_id = $1`,
      [v.branchId],
    );
    expect(await card()).toMatchObject({ remainingLabel: '2 left today' });
    await t.ds.query(
      `UPDATE branch_item_overrides SET remaining_today = 0 WHERE branch_id = $1`,
      [v.branchId],
    );
    expect(await card()).toMatchObject({
      soldOut: true,
      available: false,
      remainingLabel: null,
    });
    const off = await expectStatus(
      await v.api.patch('/food/vendor/today', {
        items: [{ itemId: daal.id, cooking: false }],
      }),
      200,
    );
    expect(off.items[0].cooking).toBe(false);
    expect(await card()).toBeUndefined();

    const slots = await expectStatus(
      await v.api.put('/food/vendor/preorder-slots', [
        {
          weekday: 5,
          slotStart: '13:00',
          cutoffMinutesBefore: 180,
          maxOrders: 10,
        },
        {
          weekday: 0,
          slotStart: '19:30',
          cutoffMinutesBefore: 240,
          maxOrders: 6,
        },
      ]),
      200,
    );
    expect(slots.map((s: any) => [s.weekday, s.slotStart])).toEqual([
      [0, '19:30'],
      [5, '13:00'],
    ]);
    // Pre-order only kitchens need slots instead of portions.
    await expectStatus(
      await v.api.patch('/food/vendor/settings', { preorderOnly: true }),
      200,
    );
    const setup = await expectStatus(
      await v.api.get('/food/vendor/setup'),
      200,
    );
    expect(setup.items.find((i: any) => i.key === 'slots')).toMatchObject({
      required: true,
      done: true,
    });
    expect(setup.items.find((i: any) => i.key === 'portions')).toMatchObject({
      required: false,
    });
    const restaurant = await foodVendor(t, admin);
    expect(
      (
        await restaurant.api.put('/food/vendor/preorder-slots', [
          {
            weekday: 5,
            slotStart: '13:00',
            cutoffMinutesBefore: 60,
            maxOrders: 5,
          },
        ])
      ).status,
    ).toBe(400);
  });

  it('the menu is the vendor’s own; go-live needs a dish; items are plan-limited', async () => {
    const a = await foodVendor(t, admin);
    const b = await foodVendor(t, admin);
    const { item, drink } = await burgerMenu(a);
    expect((await b.api.get(`/food/vendor/menu/items/${item.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await b.api.patch(`/food/vendor/menu/items/${item.id}`, {
          name: 'Mine',
        })
      ).status,
    ).toBe(404);
    const bCat = await expectStatus(
      await b.api.post('/food/vendor/menu/categories', { name: 'X1' }),
      201,
    );
    const bItem = await expectStatus(
      await b.api.post('/food/vendor/menu/items', {
        categoryId: bCat.id,
        name: 'Theirs',
        basePrice: 100,
      }),
      201,
    );
    expect(
      (
        await b.api.put(`/food/vendor/menu/items/${bItem.id}/option-groups`, [
          { groupId: drink.id },
        ])
      ).status,
    ).toBe(404);
    expect(
      (
        await b.api.patch('/food/vendor/availability', {
          items: [{ itemId: item.id, isAvailable: false }],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await b.api.post('/food/vendor/menu/items', {
          categoryId: bCat.id,
          name: 'Photo',
          basePrice: 1,
          photoUrl: asset(a.userId, 'menu_item').url,
        })
      ).status,
    ).toBe(400);

    const noMenu = await foodVendor(t, admin);
    const res = await setUpVendor(t, noMenu, { menu: false });
    expect([res!.status, res!.body.error.details.missing]).toEqual([
      422,
      ['menu'],
    ]);

    await expectStatus(
      await admin.api.patch(`/admin/food/vendors/${b.brandId}/plan`, {
        overrides: { limits: { menu_items: 1 } },
      }),
      200,
    );
    const over = await b.api.post('/food/vendor/menu/items', {
      categoryId: bCat.id,
      name: 'Second',
      basePrice: 100,
    });
    expect([
      over.status,
      over.body.error.code,
      over.body.error.details.key,
    ]).toEqual([409, 'PLAN_LIMIT_REACHED', 'menu_items']);
    const plan = await expectStatus(await b.api.get('/food/vendor/plan'), 200);
    expect(plan.usage.menu_items).toBe(1);
  });
});
