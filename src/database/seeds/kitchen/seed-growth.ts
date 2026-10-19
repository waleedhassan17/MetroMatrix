import { createHash } from 'crypto';
import { INestApplicationContext } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { encodeGeohash } from '../../../common/geo/geohash';
import { returned } from '../../../common/db/parallel';
import {
  FoodVendorService,
  VendorRef,
} from '../../../modules/food/vendor/food-vendor.service';
import { TiffinService } from '../../../modules/food-growth/tiffin/tiffin.service';
import { CateringService } from '../../../modules/food-growth/catering/catering.service';
import { RamadanService } from '../../../modules/food-growth/ramadan/ramadan.service';
import { StoryService } from '../../../modules/food-growth/story/story.service';
import { DemandService } from '../../../modules/food-growth/demand/demand.service';
import { RecipesService } from '../../../modules/kitchen/recipes/recipes.service';
import { EngineeringService } from '../../../modules/kitchen/engineering/engineering.service';
import { DEMO_FOODIE_EMAIL, DEMO_VENDOR_EMAIL } from '../food/seed-food';
import { DEMO_CALENDAR, DEMO_SEARCHES, DEMO_STORIES } from './kitchen-data';

const TZ = 'Asia/Karachi';
/** Stable numbers from a string, so reruns and machines agree. */
const h = (s: string, mod: number) =>
  parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16) % mod;

export interface SeedGrowthResult {
  created: Record<
    | 'calendarEvents'
    | 'tiffinPlans'
    | 'tiffinSubscribers'
    | 'cateringRequests'
    | 'stories'
    | 'signatures'
    | 'attributedOrders'
    | 'searchEvents'
    | 'demandCells'
    | 'experiments',
    number
  >;
}

/**
 * seed:kitchen part 2 (Chunk 5B), after part 1. Through the API's own
 * services: the Ramadan and Eid calendar with Zafran's sehri/iftar windows,
 * a weekday tiffin plan at Khala Rukhsana's with two subscribers, a dawat
 * request at Qandeel with two quote versions, kitchen stories with
 * self-declared hygiene (staff verify them), a signature karahi, storefront
 * and QR attribution on part of the order history, three weeks of synthetic
 * anonymous searches (so the demand map has cells over the k = 5 threshold)
 * and a running menu experiment. Idempotent; nothing is uploaded.
 */
export async function seedGrowth(
  app: INestApplicationContext,
  opts: { log?: (line: string) => void; now?: Date } = {},
): Promise<SeedGrowthResult> {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date();
  const ds = app.get(DataSource);
  const today = DateTime.fromJSDate(now, { zone: TZ }).toISODate()!;
  const created: SeedGrowthResult['created'] = {
    calendarEvents: 0,
    tiffinPlans: 0,
    tiffinSubscribers: 0,
    cateringRequests: 0,
    stories: 0,
    signatures: 0,
    attributedOrders: 0,
    searchEvents: 0,
    demandCells: 0,
    experiments: 0,
  };

  const vendor = async (key: string): Promise<VendorRef> => {
    const [b] = await ds.query(
      `SELECT b.id FROM businesses b JOIN users u ON u.id = b.owner_user_id WHERE u.email = $1`,
      [DEMO_VENDOR_EMAIL(key)],
    );
    if (!b) throw new Error(`Run seed:food first: no demo vendor ${key}.`);
    return app.get(FoodVendorService).ensureForBusinessId(b.id);
  };
  const customer = async (key: string) => {
    const [u] = await ds.query(
      `SELECT u.id, u.email, a.id AS address_id FROM users u
         LEFT JOIN addresses a ON a.user_id = u.id AND a.is_default
        WHERE u.email = $1`,
      [DEMO_FOODIE_EMAIL(key)],
    );
    if (!u) throw new Error(`Run seed:food first: no demo customer ${key}.`);
    return {
      user: { id: u.id, email: u.email, role: 'customer' } as AuthenticatedUser,
      addressId: u.address_id as string | null,
    };
  };
  const dishes = async (v: VendorRef, n: number): Promise<string[]> =>
    (
      await ds.query(
        `SELECT id FROM menu_items WHERE brand_id = $1 AND is_active ORDER BY sold_30d DESC, name LIMIT $2`,
        [v.brandId, n],
      )
    ).map((r: { id: string }) => r.id);

  const zafran = await vendor('zafran');
  const qandeel = await vendor('qandeel');
  const rukhsana = await vendor('rukhsana');

  // ── The calendar, and Zafran's Ramadan windows ──
  const ramadan = app.get(RamadanService);
  for (const e of DEMO_CALENDAR) {
    const [has] = await ds.query(
      `SELECT 1 FROM calendar_events WHERE name = $1`,
      [e.name],
    );
    if (has) continue;
    await ramadan.createEvent({ ...e, city: null });
    created.calendarEvents++;
  }
  await ramadan.put(zafran, {
    enabled: true,
    sehriFrom: '02:30',
    sehriTo: '04:45',
    iftarFrom: '17:30',
    iftarTo: '21:30',
    iftarPreorderOnly: true,
    notes: 'Iftar boxes on pre-order only; sehri parathas from 2:30 AM.',
  });

  // ── Tiffin at Khala Rukhsana's ──
  const tiffin = app.get(TiffinService);
  const [plan] = await ds.query(
    `SELECT id FROM tiffin_plans WHERE brand_id = $1 AND name = $2`,
    [rukhsana.brandId, 'Office lunch — weekdays'],
  );
  let planId: string = plan?.id;
  if (!planId) {
    const [a, b] = await dishes(rukhsana, 2);
    const weekdays = [1, 2, 3, 4, 5];
    const p = await tiffin.createPlan(rukhsana, {
      name: 'Office lunch — weekdays',
      description:
        'Home-style lunch Monday to Friday: salan, roti or rice, salad. Demo plan (fictional kitchen).',
      meal: 'lunch',
      days: weekdays,
      period: 'weekly',
      pricePerPeriod: 2250,
      deliveryMode: 'both',
      deliveryWindowFrom: '12:30',
      deliveryWindowTo: '13:30',
      capacity: 12,
      rotation: weekdays.map((weekday) => ({
        weekday,
        menuItemIds: [weekday % 2 ? a : (b ?? a)],
        ...(weekday === 5 ? { note: 'Friday: biryani day' } : {}),
      })),
    });
    planId = p.id;
    created.tiffinPlans++;
    for (const [i, key] of ['foodie4', 'foodie5'].entries()) {
      const c = await customer(key);
      const s = await tiffin.subscribe(c.user, {
        planId,
        startsOn: DateTime.fromISO(today).plus({ days: 1 }).toISODate()!,
        paymentMethod: i === 0 ? 'cash_weekly' : 'transfer_per_period',
        fulfilment: c.addressId ? 'delivery' : 'pickup',
        ...(c.addressId ? { addressId: c.addressId } : {}),
      });
      await tiffin.approve(rukhsana, s.id, now);
      if (i === 0) await tiffin.confirmPayment(rukhsana, s.id);
      created.tiffinSubscribers++;
    }
    log('Tiffin: "Office lunch — weekdays" at Khala Rukhsana’s, 2 subscribers');
  }

  // ── A dawat request at Qandeel, quoted twice ──
  const catering = app.get(CateringService);
  const foodie1 = await customer('foodie1');
  const [req] = await ds.query(
    `SELECT id FROM catering_requests WHERE brand_id = $1 AND user_id = $2`,
    [qandeel.brandId, foodie1.user.id],
  );
  if (!req) {
    const [karahi, second] = await dishes(qandeel, 2);
    const r = await catering.request(
      foodie1.user,
      {
        vendorId: qandeel.brandId,
        eventDate: DateTime.fromISO(today).plus({ days: 12 }).toISODate()!,
        eventTime: '20:00',
        guests: 60,
        eventType: 'dawat',
        requestedItems: [
          { menuItemId: karahi, name: 'Chicken karahi', qty: 15 },
          { menuItemId: second, name: 'Second dish', qty: 10 },
          { name: 'Kheer for dessert' },
        ],
        budget: 70000,
        fulfilment: foodie1.addressId ? 'delivery' : 'pickup',
        ...(foodie1.addressId ? { addressId: foodie1.addressId } : {}),
        notes: 'Engagement dinner — demo request.',
      },
      now,
    );
    const lines = [
      {
        menuItemId: karahi,
        name: 'Chicken karahi (full)',
        qty: 15,
        unitPrice: 2600,
      },
      {
        menuItemId: second,
        name: 'Second dish (tray)',
        qty: 10,
        unitPrice: 1800,
      },
      { name: 'Kheer (bowl)', qty: 60, unitPrice: 150 },
    ];
    await catering.quote(
      qandeel,
      r.id,
      { lines, deliveryFee: 800, advancePct: 30 },
      now,
    );
    await catering.quote(
      qandeel,
      r.id,
      {
        lines,
        deliveryFee: 0,
        advancePct: 30,
        notes: 'Free delivery for a dawat this size.',
      },
      now,
    );
    created.cateringRequests++;
    log(
      `Catering: ${r.code} at Qandeel, quoted twice (v2 is the one to accept)`,
    );
  }

  // ── Kitchen stories (self-declared hygiene; staff verify) and a signature dish ──
  const stories = app.get(StoryService);
  for (const s of DEMO_STORIES) {
    const v = await vendor(s.key);
    const [has] = await ds.query(
      `SELECT 1 FROM kitchen_stories WHERE brand_id = $1`,
      [v.brandId],
    );
    if (has) continue;
    await stories.put(
      v,
      {
        story: s.story,
        cookName: s.cookName,
        photos: [],
        hygieneChecklist: {
          gloves: true,
          hairnet: true,
          cleanWater: true,
          separateBoards: true,
          fridgeTempLog: true,
          pestControlOn: DateTime.fromISO(today)
            .minus({ days: s.pestControlDaysAgo })
            .toISODate()!,
        },
      },
      now,
    );
    created.stories++;
  }
  const [qKarahi] = await dishes(qandeel, 1);
  const [sig] = await ds.query(
    `SELECT 1 FROM recipe_cards WHERE menu_item_id = $1 AND is_signature`,
    [qKarahi],
  );
  if (!sig) {
    await app.get(RecipesService).signature(qandeel, qKarahi, undefined, {
      isSignature: true,
      by: 'Ustad Qandeel (fictional)',
      since: '2014-03-01',
    });
    created.signatures++;
  }

  // ── Storefront and QR on part of the history (deterministic, so reruns change nothing) ──
  for (const v of [zafran, qandeel]) {
    const qr = await ds.query(
      `UPDATE food_orders SET source = 'qr', campaign = 'counter-card'
        WHERE brand_id = $1 AND source = 'app' AND ('x' || substr(md5(id::text), 1, 4))::bit(16)::int % 100 < 7
        RETURNING id`,
      [v.brandId],
    );
    const sf = await ds.query(
      `UPDATE food_orders SET source = 'storefront', campaign = CASE WHEN ('x' || substr(md5(id::text), 5, 2))::bit(8)::int % 2 = 0 THEN 'instagram' END
        WHERE brand_id = $1 AND source = 'app' AND ('x' || substr(md5(id::text), 1, 4))::bit(16)::int % 100 BETWEEN 7 AND 11
        RETURNING id`,
      [v.brandId],
    );
    created.attributedOrders += returned(qr).length + returned(sf).length;
  }

  // ── Anonymous searches for the demand map: three weeks around the demo cities ──
  const [{ n: recent }] = await ds.query(
    `SELECT count(*)::int AS n FROM search_events WHERE at > $1::timestamptz - interval '21 days'`,
    [now],
  );
  if (recent < 100) {
    const rows: unknown[][] = [];
    for (const s of DEMO_SEARCHES)
      for (let i = 0; i < s.count; i++) {
        const seed = `${s.city}:${s.query ?? '-'}:${s.lat}:${i}`;
        let local = DateTime.fromJSDate(now, { zone: TZ })
          .minus({ days: h(seed, 21) })
          .set({
            hour: s.hours[h(`${seed}:h`, s.hours.length)],
            minute: h(`${seed}:m`, 60),
          });
        if (local.toJSDate() > now) local = local.minus({ days: 1 });
        const lat = s.lat + (h(`${seed}:y`, 5) - 2) * 0.001;
        const lng = s.lng + (h(`${seed}:x`, 5) - 2) * 0.001;
        const results =
          s.zeroShare && h(`${seed}:z`, 100) < s.zeroShare * 100 ? 0 : 3;
        rows.push([
          s.query ? 'search' : 'home',
          encodeGeohash(lat, lng, 6),
          s.city,
          s.query,
          results,
          results && h(`${seed}:o`, 100) < 70 ? results : 0,
          local.hour,
          local.weekday % 7,
          local.toJSDate(),
        ]);
      }
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await ds.query(
        `INSERT INTO search_events (kind, geohash6, city, query_norm, results_count, open_results_count, hour, weekday, at)
         SELECT * FROM unnest($1::search_kind[], $2::varchar[], $3::citext[], $4::varchar[], $5::smallint[],
                              $6::smallint[], $7::smallint[], $8::smallint[], $9::timestamptz[])`,
        chunk[0].map((_, col) => chunk.map((r) => r[col])),
      );
    }
    created.searchEvents = rows.length;
  }
  const rebuilt = await ds.transaction((m) =>
    app.get(DemandService).rebuild(m, now),
  );
  // Last week and the one before, too, so the map has more than one week.
  const before = await ds.transaction((m) =>
    app
      .get(DemandService)
      .rebuildWeek(
        m,
        DateTime.fromJSDate(now, { zone: TZ })
          .startOf('week')
          .minus({ weeks: 2 })
          .toISODate()!,
      ),
  );
  created.demandCells = rebuilt.cells + before;
  log(
    `Demand map: ${created.searchEvents} search events → ${created.demandCells} cells`,
  );

  // ── A running experiment at Zafran ──
  const [exp] = await ds.query(
    `SELECT 1 FROM menu_experiments WHERE branch_id = $1`,
    [zafran.branchId],
  );
  if (!exp) {
    const ids = await dishes(zafran, 4);
    await app.get(EngineeringService).create(
      zafran,
      {
        itemId: ids[ids.length - 1],
        days: 14,
        startsOn: DateTime.fromISO(today).minus({ days: 6 }).toISODate()!,
        notes: 'New photo and a lower price — demo experiment.',
      },
      now,
    );
    created.experiments++;
  }
  return { created };
}
