import { TestApp } from './test-app';
import { Vendor, checkout, expectStatus, foodCustomer } from './food';

/** A kitchen ingredient (POST /food/vendor/kitchen/ingredients). */
export async function ingredient(
  v: Vendor,
  body: {
    name: string;
    baseUnit?: 'g' | 'ml' | 'piece';
    category?: string;
    openingStock?: {
      qty: number;
      unit: string;
      totalCost?: number;
      expiresOn?: string;
    };
    [k: string]: unknown;
  },
) {
  return expectStatus(
    await v.api.post('/food/vendor/kitchen/ingredients', {
      category: 'other',
      baseUnit: 'g',
      ...body,
    }),
    201,
  );
}

/** A dish in the vendor's first category. */
export async function dish(
  v: Vendor,
  name: string,
  basePrice = 500,
  extra: Record<string, unknown> = {},
) {
  const cats = await expectStatus(
    await v.api.get('/food/vendor/menu/categories'),
    200,
  );
  return expectStatus(
    await v.api.post('/food/vendor/menu/items', {
      categoryId: cats[0].id,
      name,
      basePrice,
      ...extra,
    }),
    201,
  );
}

export async function recipe(
  v: Vendor,
  itemId: string,
  lines: Array<{
    ingredientId: string;
    qty: number;
    unit: string;
    optionId?: string;
    isPackaging?: boolean;
  }>,
  opts: { yieldServings?: number; variantId?: string } = {},
) {
  const q = opts.variantId ? `?variantId=${opts.variantId}` : '';
  return expectStatus(
    await v.api.put(`/food/vendor/kitchen/items/${itemId}/recipe${q}`, {
      ...(opts.yieldServings ? { yieldServings: opts.yieldServings } : {}),
      lines,
    }),
    200,
  );
}

/** A customer orders (COD) and the vendor accepts. */
export async function acceptedOrder(
  t: TestApp,
  v: Vendor,
  line: {
    itemId: string;
    quantity?: number;
    optionIds?: string[];
    variantId?: string;
  },
  at: { lat: number; lng: number },
) {
  const c = await foodCustomer(t, at);
  await expectStatus(
    await c.api.post('/food/cart/items', {
      vendorId: v.brandId,
      quantity: 1,
      ...line,
    }),
    201,
  );
  const o = await expectStatus(await checkout(c), 201);
  await expectStatus(
    await v.api.post(`/food/vendor/orders/${o.id}/accept`, { etaMinutes: 30 }),
    200,
  );
  return { c, o };
}

/** On hand (base units) of an ingredient. */
export async function onHand(
  t: TestApp,
  ingredientId: string,
): Promise<number> {
  const [r] = await t.ds.query(
    `SELECT on_hand FROM kitchen_ingredients WHERE id = $1`,
    [ingredientId],
  );
  return Number(r.on_hand);
}

export async function override(t: TestApp, v: Vendor, itemId: string) {
  const [r] = await t.ds.query(
    `SELECT is_available, auto_reason FROM branch_item_overrides WHERE branch_id = $1 AND item_id = $2`,
    [v.branchId, itemId],
  );
  return r as { is_available: boolean; auto_reason: string | null } | undefined;
}
