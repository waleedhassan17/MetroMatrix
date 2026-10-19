import { createHash } from 'crypto';
import { INestApplicationContext } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';
import { newCode } from '../../../common/utils/codes';
import {
  FoodVendorService,
  VendorRef,
} from '../../../modules/food/vendor/food-vendor.service';
import { FoodJobsService } from '../../../modules/food/jobs/food-jobs.service';
import { IngredientsService } from '../../../modules/kitchen/stock/ingredients.service';
import { StockViewsService } from '../../../modules/kitchen/stock/stock-views.service';
import { RecipesService } from '../../../modules/kitchen/recipes/recipes.service';
import { PurchasesService } from '../../../modules/kitchen/purchases/purchases.service';
import { WasteService } from '../../../modules/kitchen/waste/waste.service';
import { PriceWatchService } from '../../../modules/kitchen/costing/price-watch.service';
import { KitchenJobsService } from '../../../modules/kitchen/jobs/kitchen-jobs.service';
import { SurplusService } from '../../../modules/kitchen/surplus/surplus.service';
import { DEMO_FOODIE_EMAIL, DEMO_VENDOR_EMAIL } from '../food/seed-food';
import {
  DEMO_SUPPLIERS,
  DemoIngredient,
  KITCHEN_INGREDIENTS,
  KITCHEN_VENDORS,
  RECIPE_TEMPLATES,
  SPI_CITY_FACTOR,
  SPI_SAMPLE,
} from './kitchen-data';

export interface SeedKitchenResult {
  vendors: Array<{ key: string; name: string; skipped: boolean }>;
  created: Record<
    | 'ingredients'
    | 'recipes'
    | 'orders'
    | 'purchases'
    | 'waste'
    | 'spiPrices'
    | 'forecasts'
    | 'boxes',
    number
  >;
}

const TZ = 'Asia/Karachi';
const DAYS = 60;

/** Stable numbers from a string, so reruns and machines agree. */
const h = (s: string, mod: number) =>
  parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16) % mod;

/** Fridays and Saturdays are busier; Mondays quieter. */
const WEEKDAY_FACTOR = [1.1, 0.8, 0.9, 0.95, 1.0, 1.35, 1.3];
/** Lunch and dinner. */
const HOURS = [12, 13, 13, 14, 15, 19, 20, 20, 21, 21, 22];

/**
 * seed:kitchen part 1 (Chunk 5A) — on top of seed:food: for three demo
 * vendors, ingredients, recipe cards for every dish, 60 days of orders (so
 * the forecast and smart ETA have history), 8 weeks of purchases with price
 * drift, waste, a stock take, the PBS SPI sample for Lahore and Karachi,
 * price-watch mappings, forecasts, cost snapshots, prep stats and tonight's
 * Bachat Box. Everything but the history orders goes through the API's own
 * services. Idempotent: a vendor with ingredients is skipped.
 */
export async function seedKitchen(
  app: INestApplicationContext,
  opts: { log?: (line: string) => void; now?: Date } = {},
): Promise<SeedKitchenResult> {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date();
  const ds = app.get(DataSource);
  const result: SeedKitchenResult = {
    vendors: [],
    created: {
      ingredients: 0,
      recipes: 0,
      orders: 0,
      purchases: 0,
      waste: 0,
      spiPrices: 0,
      forecasts: 0,
      boxes: 0,
    },
  };

  // The SPI sample first: price watch maps against it.
  const [{ n: spi }] = await ds.query(
    `SELECT count(*)::int AS n FROM reference_prices`,
  );
  if (!spi) {
    const imp = await app.get(PriceWatchService).import(spiCsv(now));
    result.created.spiPrices = imp.prices;
    log(
      `SPI sample: ${imp.items} items × ${imp.cities.join(' & ')} × ${imp.weeks.length} weeks`,
    );
  }

  const customers: Array<{ id: string }> = await ds.query(
    `SELECT id FROM users WHERE email = ANY($1::citext[]) ORDER BY email`,
    [[1, 2, 3, 4, 5, 6].map((i) => DEMO_FOODIE_EMAIL(`foodie${i}`))],
  );
  if (!customers.length)
    throw new Error('Run seed:food first: no demo customers.');

  for (const demo of KITCHEN_VENDORS) {
    const [b] = await ds.query(
      `SELECT b.id, fb.name FROM businesses b JOIN users u ON u.id = b.owner_user_id JOIN food_brands fb ON fb.business_id = b.id
        WHERE u.email = $1`,
      [DEMO_VENDOR_EMAIL(demo.key)],
    );
    if (!b) throw new Error(`Run seed:food first: no demo vendor ${demo.key}.`);
    const v = await app.get(FoodVendorService).ensureForBusinessId(b.id);
    const [{ n: has }] = await ds.query(
      `SELECT count(*)::int AS n FROM kitchen_ingredients WHERE branch_id = $1`,
      [v.branchId],
    );
    if (has) {
      result.vendors.push({ key: demo.key, name: b.name, skipped: true });
      log(`${b.name}: already has a kitchen — skipped`);
      continue;
    }
    await seedVendor(app, ds, v, demo, customers, now, result, log);
    result.vendors.push({ key: demo.key, name: b.name, skipped: false });
  }

  await app.get(FoodJobsService).recomputePrepStats(now);
  return result;
}

async function seedVendor(
  app: INestApplicationContext,
  ds: DataSource,
  v: VendorRef,
  demo: (typeof KITCHEN_VENDORS)[number],
  customers: Array<{ id: string }>,
  now: Date,
  result: SeedKitchenResult,
  log: (line: string) => void,
) {
  const ingredients = app.get(IngredientsService);
  const purchases = app.get(PurchasesService);
  const items: Array<{ id: string; name: string; base_price: number }> =
    await ds.query(
      `SELECT id, name, base_price FROM menu_items WHERE brand_id = $1 AND is_active ORDER BY sort, name`,
      [v.brandId],
    );

  // Which ingredients this menu uses.
  const recipes = items.map((i) => ({
    item: i,
    lines: (
      RECIPE_TEMPLATES.find((t) => t.match.test(i.name)) ?? RECIPE_TEMPLATES[1]
    ).lines(i.name),
  }));
  const used = new Set(recipes.flatMap((r) => r.lines.map((l) => l[0])));
  const ids = new Map<string, string>();
  for (const ing of KITCHEN_INGREDIENTS.filter((x) => used.has(x.key))) {
    const created = await ingredients.create(v, {
      name: ing.name,
      nameUr: ing.nameUr,
      category: ing.category,
      baseUnit: ing.baseUnit,
      ...(ing.customUnits ? { customUnits: ing.customUnits } : {}),
      ...(ing.par
        ? {
            parLevel: {
              qty: ing.par,
              unit: ing.buy.unit === 'tray' ? 'tray' : ing.buy.unit,
            },
          }
        : {}),
    });
    ids.set(ing.key, created.id);
    result.created.ingredients++;
  }
  for (const r of recipes) {
    await app.get(RecipesService).put(v, r.item.id, undefined, {
      lines: r.lines.map(([key, qty, unit, packaging]) => ({
        ingredientId: ids.get(key)!,
        qty,
        unit,
        ...(packaging ? { isPackaging: true } : {}),
      })),
    });
    result.created.recipes++;
  }

  // 60 days of collected orders (history: already counted, never deducted).
  const today = DateTime.fromJSDate(now, { zone: TZ }).startOf('day');
  await ds.query(
    `UPDATE branches SET went_live_at = LEAST(coalesce(went_live_at, now()), $2) WHERE id = $1`,
    [v.branchId, today.minus({ days: DAYS + 1 }).toJSDate()],
  );
  const sold = new Map<string, number>();
  for (let d = DAYS; d >= 1; d--) {
    const day = today.minus({ days: d });
    const trend = 0.85 + (0.3 * (DAYS - d)) / DAYS;
    const n = Math.max(
      1,
      Math.round(
        demo.ordersPerDay *
          WEEKDAY_FACTOR[day.weekday % 7] *
          trend *
          (0.85 + h(`${demo.key}:${d}`, 30) / 100),
      ),
    );
    for (let k = 0; k < n; k++) {
      const seed = `${demo.key}:${d}:${k}`;
      const placed = day.set({
        hour: HOURS[h(`${seed}:h`, HOURS.length)],
        minute: h(`${seed}:m`, 60),
      });
      const lines = new Map<
        string,
        { item: (typeof items)[number]; qty: number }
      >();
      for (let l = 0; l < 1 + h(`${seed}:n`, 3); l++) {
        // Popular dishes first: a skewed pick.
        const idx = Math.min(
          items.length - 1,
          Math.floor((h(`${seed}:i${l}`, 1000) / 1000) ** 1.8 * items.length),
        );
        const it = items[idx];
        const cur = lines.get(it.id) ?? { item: it, qty: 0 };
        cur.qty += 1 + h(`${seed}:q${l}`, 2);
        lines.set(it.id, cur);
      }
      const subtotal = [...lines.values()].reduce(
        (s, l) => s + l.item.base_price * l.qty,
        0,
      );
      const prep = demo.prepMinutes + h(`${seed}:p`, 16) - 5;
      const at = (min: number) => placed.plus({ minutes: min }).toJSDate();
      const [o] = await ds.query(
        `INSERT INTO food_orders (code, user_id, brand_id, branch_id, fulfilment, status, payment_method, payment_status,
                paid_at, subtotal, discount, delivery_fee, total, eta_minutes, promised_at, accept_by, accepted_at,
                preparing_at, ready_at, picked_up_at, stock_deducted_at, customer_note, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'pickup', 'picked_up', 'pay_at_pickup', 'paid', $5, $6, 0, 0, $6, $7, $8, $9, $10,
                 $11, $12, $5, $13, NULL, $13, $5)
         RETURNING id`,
        [
          newCode('FC'),
          customers[h(`${seed}:c`, customers.length)].id,
          v.brandId,
          v.branchId,
          at(prep + 10),
          subtotal,
          demo.prepMinutes,
          at(demo.prepMinutes + 3),
          at(5),
          at(2),
          at(3),
          at(prep + 2),
          placed.toJSDate(),
        ],
      );
      let no = 1;
      for (const l of lines.values()) {
        await ds.query(
          `INSERT INTO food_order_items (order_id, line_no, item_id, item_name, unit_price, quantity, line_total, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            o.id,
            no++,
            l.item.id,
            l.item.name,
            l.item.base_price,
            l.qty,
            l.item.base_price * l.qty,
            placed.toJSDate(),
          ],
        );
        sold.set(l.item.id, (sold.get(l.item.id) ?? 0) + l.qty);
      }
      result.created.orders++;
    }
  }

  // What 60 days of those sales used, per ingredient (base units a day).
  const perDay = new Map<string, number>();
  for (const r of recipes)
    for (const [key, qty] of r.lines)
      perDay.set(
        key,
        (perDay.get(key) ?? 0) + (qty * (sold.get(r.item.id) ?? 0)) / DAYS,
      );

  // Suppliers and 8 weeks of purchases, twice a week, prices drifting.
  const sup: Array<{ id: string }> = [];
  for (const s of DEMO_SUPPLIERS)
    sup.push(
      await purchases.createSupplier(v, {
        name: s.name,
        ...(s.phone ? { phone: s.phone } : {}),
        notes: s.notes,
      }),
    );
  const supplierFor = (ing: DemoIngredient) =>
    ['vegetable', 'dairy'].includes(ing.category)
      ? sup[0]
      : ing.category === 'meat'
        ? sup[1]
        : sup[2];
  for (let d = 56; d >= 0; d -= d > 3 ? 4 : 3) {
    const day = today.minus({ days: d }).set({ hour: 8 });
    const bySupplier = new Map<
      string,
      Array<{
        ingredientId: string;
        qty: number;
        unit: string;
        totalPrice: number;
        expiresOn?: string;
      }>
    >();
    for (const ing of KITCHEN_INGREDIENTS.filter((x) => ids.has(x.key))) {
      const use = perDay.get(ing.key) ?? 0;
      const perUnit =
        ing.buy.unit === 'kg' || ing.buy.unit === 'l'
          ? 1000
          : ing.buy.unit === 'tray'
            ? 30
            : 1;
      const qty = Math.max(1, Math.ceil((use * 4.2) / perUnit));
      const progress = (56 - d) / 56;
      const price =
        ing.buy.price *
        (1 + (ing.buy.drift / 100) * progress) *
        (0.97 + h(`${demo.key}:${ing.key}:${d}`, 7) / 100);
      const line = {
        ingredientId: ids.get(ing.key)!,
        qty,
        unit: ing.buy.unit,
        totalPrice: Math.round(price * qty),
        ...(ing.life
          ? { expiresOn: day.plus({ days: ing.life }).toISODate()! }
          : {}),
      };
      const s = supplierFor(ing);
      bySupplier.set(s.id, [...(bySupplier.get(s.id) ?? []), line]);
    }
    for (const [supplierId, lines] of bySupplier) {
      await purchases.create(v, {
        supplierId,
        purchasedAt: day.toISO()!,
        lines,
        note: 'Demo purchase',
      });
      result.created.purchases++;
    }
  }

  // Waste over the last month, then a stock take that leaves a realistic shelf.
  const waste = app.get(WasteService);
  const wasteIds: string[] = [];
  for (let i = 0; i < 9; i++) {
    const pick = [
      'tomato',
      'yogurt',
      'chicken',
      'milk',
      'mint',
      'onion',
    ].filter((k) => ids.has(k));
    if (!pick.length) break;
    const key = pick[h(`${demo.key}:w${i}`, pick.length)];
    const ing = KITCHEN_INGREDIENTS.find((x) => x.key === key)!;
    const w = await waste.log(v, {
      ingredientId: ids.get(key)!,
      qty:
        ing.baseUnit === 'piece' ? 6 : 0.5 + h(`${demo.key}:wq${i}`, 15) / 10,
      unit:
        ing.baseUnit === 'piece' ? 'piece' : ing.baseUnit === 'ml' ? 'l' : 'kg',
      reason: (['spoiled', 'expired', 'leftover', 'overcooked'] as const)[
        h(`${demo.key}:wr${i}`, 4)
      ],
      note: 'Demo entry',
    });
    wasteIds.push(w.id);
    result.created.waste++;
  }
  for (const [i, id] of wasteIds.entries())
    await ds.query(
      `UPDATE waste_entries SET created_at = now() - make_interval(days => $2) WHERE id = $1`,
      [id, 2 + i * 3],
    );

  const count = KITCHEN_INGREDIENTS.filter((x) => ids.has(x.key)).map((ing) => {
    const days = ing.life && ing.life <= 6 ? 1.2 : 5;
    // Tomatoes run short tonight: the forecast-gap card and the shopping list have something to say.
    const factor = ing.key === 'tomato' ? 0.3 : 1;
    const qty = Math.round((perDay.get(ing.key) ?? 0) * days * factor);
    return {
      ingredientId: ids.get(ing.key)!,
      qty: Math.max(0, qty),
      unit: ing.baseUnit,
    };
  });
  await app
    .get(StockViewsService)
    .count(v, { lines: count, note: 'Demo stock take' });

  // Price watch: map every ingredient the SPI covers.
  const pw = app.get(PriceWatchService);
  for (const s of await pw.suggestions(v))
    await pw.map(v, s.ingredientId, s.reference.id);

  // Forecasts, accuracy and the week's cost baseline.
  const jobs = app.get(KitchenJobsService);
  const f = await jobs.forecastBranch(v.branchId, now);
  result.created.forecasts += typeof f.rows === 'number' ? f.rows : 0;
  await jobs.costSnapshots(now);

  // Tonight's Bachat Box, while there is time to collect it.
  const local = DateTime.fromJSDate(now, { zone: TZ });
  if (demo.key === 'zafran' && local.hour < 22) {
    await app.get(SurplusService).create(v, {
      title: 'Bachat Box — tonight’s biryani',
      contentsHint: 'Usually biryani, raita and a sweet',
      originalValue: 1100,
      price: 450,
      quantity: 4,
      pickupFrom: local.toISO()!,
      pickupTo: local.endOf('day').minus({ minutes: 1 }).toISO()!,
      tags: ['biryani'],
    });
    result.created.boxes++;
  }
  log(
    `${demo.key}: ${ids.size} ingredients, ${recipes.length} recipe cards, ${result.created.orders} orders so far`,
  );
}

/** The SPI template for 8 weeks × Lahore and Karachi (week ending each Thursday). */
export function spiCsv(now: Date): string {
  const rows = ['week_ending,city,item,unit,price'];
  const lastThursday = DateTime.fromJSDate(now, { zone: TZ })
    .startOf('day')
    .minus({ days: (DateTime.fromJSDate(now, { zone: TZ }).weekday + 3) % 7 });
  for (let w = 7; w >= 0; w--) {
    const week = lastThursday.minus({ weeks: w }).toISODate()!;
    for (const [item, unit, price, drift] of SPI_SAMPLE)
      for (const [city, factor] of Object.entries(SPI_CITY_FACTOR)) {
        // Tomatoes jump 12% in the last week: price watch's "rising" flag.
        const jump = item === 'Tomatoes' && w === 0 ? 1.12 : 1;
        const p = price * factor * (1 + drift / 100) ** (7 - w) * jump;
        rows.push(
          [
            week,
            city,
            item.includes(',') ? `"${item}"` : item,
            unit,
            Math.round(p),
          ].join(','),
        );
      }
  }
  return rows.join('\n');
}
