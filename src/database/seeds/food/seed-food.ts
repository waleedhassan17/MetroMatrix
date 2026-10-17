import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { DataSource, EntityManager, Not } from 'typeorm';
import { User } from '../../../modules/users/entities/user.entity';
import { Business } from '../../../modules/businesses/entities/business.entity';
import { slugify } from '../../../modules/businesses/businesses.service';
import { MenuCategory } from '../../../modules/food/menu/entities/menu-category.entity';
import { MenuItem } from '../../../modules/food/menu/entities/menu-item.entity';
import { ItemVariant } from '../../../modules/food/menu/entities/item-variant.entity';
import { OptionGroup } from '../../../modules/food/menu/entities/option-group.entity';
import { MenuOption } from '../../../modules/food/menu/entities/menu-option.entity';
import { FoodAggregatesService } from '../../../modules/food/reviews/food-aggregates.service';
import {
  buildRiderUsernameBase,
  allocateRiderUsername,
  riderEmail,
} from '../../../modules/food/riders/rider-username';
import { maskOf } from '../../../modules/food/menu/item-pricing';
import { onBrandColor, INK } from '../../../common/branding/contrast';
import { newCode } from '../../../common/utils/codes';
import {
  buildPkIban,
  normalizeAccountNumber,
} from '../../../common/payments/payment-account.validation';
import { normalizePkPhone } from '../../../common/validation/phone';
import { PASSWORD_REGEX } from '../../../common/validation/password';
import { todayIn } from '../../../common/time/time.util';
import { SeedImages } from '../shopping/tiles';
import {
  DEMO_FOODIES,
  DEMO_VENDORS,
  DemoVendor,
  REVIEW_LINES,
  coverPhotoUrl,
  dishPhotoUrl,
} from './food-data';

export const DEMO_VENDOR_EMAIL = (key: string) =>
  `demo.food.${key}@metromatrix.test`;
export const DEMO_FOODIE_EMAIL = (key: string) =>
  `demo.${key}@metromatrix.test`;

export interface SeedFoodOptions {
  /** Password for every demo owner, rider and customer (SEED_DEMO_PASSWORD). */
  password: string;
  bcryptRounds?: number;
  images: SeedImages;
  log?: (line: string) => void;
  now?: Date;
}

export interface SeedFoodResult {
  vendors: Array<{
    key: string;
    email: string;
    brandId: string;
    slug: string;
    riders: string[];
  }>;
  customers: string[];
  created: Record<
    | 'vendors'
    | 'items'
    | 'riders'
    | 'customers'
    | 'orders'
    | 'reviews'
    | 'promotions'
    | 'banners',
    number
  >;
}

/** Stable small numbers from a string, so reruns and machines agree. */
const hashInt = (s: string, mod: number) =>
  parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16) % mod;

const initials = (name: string) =>
  name
    .replace(/[’']s\b/g, '')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');

/** A monogram logo — generated, so no real brand's mark is ever used. */
export function monogramSvg(text: string, bg: string, fg: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" rx="96" fill="${bg}"/>
<circle cx="256" cy="256" r="196" fill="none" stroke="${fg}" stroke-opacity="0.25" stroke-width="10"/>
<text x="256" y="266" fill="${fg}" font-family="Georgia, 'Times New Roman', serif" font-size="190" font-weight="700" text-anchor="middle" dominant-baseline="middle">${text}</text>
</svg>`;
}

const DEMO_BANNERS = [
  {
    title: 'Karahi night in Gulberg',
    subtitle: 'Coal-fired, straight from the wok',
    photo: 'chickenKarahi' as const,
    target: { type: 'vendor' as const, vendor: 'qandeel' },
    city: 'Lahore',
  },
  {
    title: 'Biryani week',
    subtitle: 'Every biryani kitchen near you',
    photo: 'biryani' as const,
    target: { type: 'cuisine' as const, slug: 'biryani' },
    city: null,
  },
  {
    title: 'Smash burgers, delivered',
    subtitle: 'Free delivery over Rs 1,500',
    photo: 'doubleBurger' as const,
    target: { type: 'search' as const, query: 'burger' },
    city: 'Lahore',
  },
];

/**
 * The Food Court demo: six approved, live, fictional vendors (3 restaurants,
 * a cloud kitchen, a pre-order-only home kitchen and a home kitchen with
 * daily portions) in Lahore and Karachi, with menus (variants, reusable
 * option groups, time windows, weekly days), hours, delivery zones, payment
 * accounts, deals, riders for three of them, six demo customers, past orders
 * with full event histories, reviews, rider cash, and three home banners.
 *
 * Idempotent: a vendor or customer found by email is left as it is; banners
 * found by title are re-pointed; ratings and sold_30d are recomputed.
 */
export async function seedFood(
  ds: DataSource,
  opts: SeedFoodOptions,
): Promise<SeedFoodResult> {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date();
  if (
    opts.password.length < 8 ||
    opts.password.length > 72 ||
    !PASSWORD_REGEX.test(opts.password)
  )
    throw new Error(
      'SEED_DEMO_PASSWORD must be 8–72 characters with a lower-case letter, an upper-case letter and a digit',
    );
  const cuisines = new Map<string, string>(
    (await ds.query(`SELECT id, slug FROM cuisines`)).map(
      (r: { id: string; slug: string }) => [r.slug, r.id],
    ),
  );
  if (!cuisines.size)
    throw new Error('No cuisines — run the migrations first.');
  const hash = await bcrypt.hash(opts.password, opts.bcryptRounds ?? 12);
  const created: SeedFoodResult['created'] = {
    vendors: 0,
    items: 0,
    riders: 0,
    customers: 0,
    orders: 0,
    reviews: 0,
    promotions: 0,
    banners: 0,
  };

  // ── Customers ──
  const customers: Array<{
    id: string;
    city: string;
    address: (typeof DEMO_FOODIES)[number];
  }> = [];
  for (const f of DEMO_FOODIES) {
    const email = DEMO_FOODIE_EMAIL(f.key);
    let u = await ds.manager.findOne(User, {
      where: { email, status: Not('deleted') },
    });
    if (!u) {
      u = await ds.manager.save(
        ds.manager.create(User, {
          email,
          passwordHash: hash,
          displayName: f.name,
          role: 'customer',
          isEmailVerified: true,
          phone: normalizePkPhone(f.phone) ?? null,
        }),
      );
      await ds.query(
        `INSERT INTO addresses (user_id, label, full_name, phone, city, area, line1, lat, lng, is_default)
         VALUES ($1, 'home', $2, $3, $4, $5, $6, $7, $8, true)`,
        [
          u.id,
          f.name,
          normalizePkPhone(f.phone),
          f.city,
          f.area,
          f.line1,
          f.lat,
          f.lng,
        ],
      );
      created.customers += 1;
    } else if (u.role !== 'customer')
      throw new Error(`${email} exists but is not a customer account`);
    customers.push({ id: u.id, city: f.city, address: f });
  }

  // ── Vendors ──
  const vendors: SeedFoodResult['vendors'] = [];
  for (const [index, demo] of DEMO_VENDORS.entries()) {
    const email = DEMO_VENDOR_EMAIL(demo.key);
    const existing = await ds.manager.findOne(User, {
      where: { email, status: Not('deleted') },
    });
    if (existing) {
      const [b] = await ds.query(
        `SELECT fb.id, fb.slug FROM food_brands fb JOIN businesses b ON b.id = fb.business_id WHERE b.owner_user_id = $1`,
        [existing.id],
      );
      if (!b) throw new Error(`${email} exists but has no food brand`);
      const riders = await ds.query(
        `SELECT u.username FROM riders r JOIN users u ON u.id = r.user_id JOIN food_brands fb ON fb.business_id = r.business_id WHERE fb.id = $1 ORDER BY u.username`,
        [b.id],
      );
      vendors.push({
        key: demo.key,
        email,
        brandId: b.id,
        slug: b.slug,
        riders: riders.map((r: any) => r.username),
      });
      continue;
    }
    const out = await ds.transaction((m) =>
      createVendor(m, demo, index, {
        email,
        hash,
        now,
        images: opts.images,
        cuisines,
        customers,
        created,
      }),
    );
    created.vendors += 1;
    vendors.push(out);
    log(`[seed] ${demo.name}: ${out.slug} (${demo.subType}, ${demo.city})`);
  }

  // ── Banners ──
  const bannerOwner = (
    await ds.manager.findOneByOrFail(User, {
      email: DEMO_VENDOR_EMAIL(DEMO_VENDORS[0].key),
    })
  ).id;
  for (const [i, b] of DEMO_BANNERS.entries()) {
    const image = await opts.images.remote({
      ownerUserId: bannerOwner,
      purpose: 'banner',
      storeKey: 'food',
      name: `banner-${i + 1}`,
      url: coverPhotoUrl(b.photo),
    });
    let targetId: string | null = null;
    let targetQuery: string | null = null;
    if (b.target.type === 'vendor')
      targetId = vendors.find(
        (v) => v.key === (b.target as { vendor: string }).vendor,
      )!.brandId;
    if (b.target.type === 'cuisine')
      targetId = cuisines.get((b.target as { slug: string }).slug)!;
    if (b.target.type === 'search')
      targetQuery = (b.target as { query: string }).query;
    const [row] = await ds.query(
      `SELECT id FROM food_banners WHERE title = $1`,
      [b.title],
    );
    if (row)
      await ds.query(
        `UPDATE food_banners SET image_url = $2, subtitle = $3, target_type = $4, target_id = $5, target_query = $6, city = $7,
                is_active = true, sort = $8, updated_at = now() WHERE id = $1`,
        [
          row.id,
          image.url,
          b.subtitle,
          b.target.type,
          targetId,
          targetQuery,
          b.city,
          i,
        ],
      );
    else {
      await ds.query(
        `INSERT INTO food_banners (image_url, title, subtitle, target_type, target_id, target_query, city, starts_at, sort)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz - interval '1 day', $9)`,
        [
          image.url,
          b.title,
          b.subtitle,
          b.target.type,
          targetId,
          targetQuery,
          b.city,
          now,
          i,
        ],
      );
      created.banners += 1;
    }
  }

  // Derived numbers, every run.
  const aggregates = new FoodAggregatesService(ds);
  await aggregates.ratings();
  await aggregates.sold30d(now);
  return {
    vendors,
    customers: DEMO_FOODIES.map((f) => DEMO_FOODIE_EMAIL(f.key)),
    created,
  };
}

async function createVendor(
  m: EntityManager,
  demo: DemoVendor,
  index: number,
  ctx: {
    email: string;
    hash: string;
    now: Date;
    images: SeedImages;
    cuisines: Map<string, string>;
    customers: Array<{
      id: string;
      city: string;
      address: (typeof DEMO_FOODIES)[number];
    }>;
    created: SeedFoodResult['created'];
  },
): Promise<SeedFoodResult['vendors'][number]> {
  const { now } = ctx;
  const owner = await m.save(
    m.create(User, {
      email: ctx.email,
      passwordHash: ctx.hash,
      displayName: `${demo.name} (owner)`,
      role: 'partner',
      isEmailVerified: true,
      phone: normalizePkPhone(demo.phone) ?? null,
    }),
  );
  const business = await m.save(
    m.create(Business, {
      ownerUserId: owner.id,
      serviceType: 'food',
      subType: demo.subType,
      name: demo.name,
      slug: slugify(`${demo.name} ${demo.city}`),
      phone: demo.phone.replace(/\s+/g, ''),
      city: demo.city,
      addressLine: `${demo.addressLine}, ${demo.area}`,
      lat: demo.lat,
      lng: demo.lng,
      // Demo vendors are approved directly; real ones go through review.
      status: 'approved',
      submittedAt: now,
      reviewedAt: now,
    }),
  );
  const slug = slugify(demo.name);
  const [brand] = await m.query(
    `INSERT INTO food_brands (business_id, name, slug, is_home_kitchen) VALUES ($1, $2, $3, $4) RETURNING id`,
    [business.id, demo.name, slug, demo.subType === 'home_kitchen'],
  );
  const fg = onBrandColor(demo.brandColor) ?? INK;
  const logo = await ctx.images.image({
    ownerUserId: owner.id,
    purpose: 'food_branding',
    storeKey: demo.key,
    name: 'logo',
    title: initials(demo.name),
    bg: demo.brandColor,
    fg,
    motif: 'dots',
    width: 512,
    height: 512,
    svg: monogramSvg(initials(demo.name), demo.brandColor, fg),
  });
  const cover = await ctx.images.remote({
    ownerUserId: owner.id,
    purpose: 'food_branding',
    storeKey: demo.key,
    name: 'cover',
    url: coverPhotoUrl(demo.cover),
  });
  await m.query(
    `UPDATE food_brands SET tagline = $2, logo_url = $3, cover_url = $4, brand_color = $5, on_brand_color = $6,
            cuisine_ids = $7::uuid[], price_level = $8 WHERE id = $1`,
    [
      brand.id,
      demo.tagline,
      logo.url,
      cover.url,
      demo.brandColor,
      fg,
      demo.cuisines.map((c) => {
        const id = ctx.cuisines.get(c);
        if (!id) throw new Error(`${demo.key}: unknown cuisine ${c}`);
        return id;
      }),
      demo.priceLevel,
    ],
  );
  const liveDays = 20 + hashInt(demo.key, 60) - (demo.key === 'smash' ? 70 : 0); // Smash Theory is new
  const [branch] = await m.query(
    `INSERT INTO branches (business_id, brand_id, address_line, area, city, phone, geo, prep_minutes, accepts_delivery,
            accepts_pickup, accepts_cod, cod_limit, max_radius_km, free_delivery_over, preorder_only, status, went_live_at,
            food_safety_checked_at, food_safety_note, portions_reset_on)
     VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7::float8, $8::float8), 4326)::geography, $9, $10, $11, true,
             $12, $13, $14, $15, 'active', $16::timestamptz - make_interval(days => $17), $18, $19, $20)
     RETURNING id, timezone`,
    [
      business.id,
      brand.id,
      demo.addressLine,
      demo.area,
      demo.city,
      demo.phone.replace(/\s+/g, ''),
      demo.lng,
      demo.lat,
      demo.prepMinutes,
      demo.acceptsDelivery,
      demo.acceptsPickup,
      demo.codLimit,
      demo.maxRadiusKm,
      demo.freeDeliveryOver,
      demo.preorderOnly ?? false,
      now,
      Math.max(liveDays, 5),
      demo.subType === 'home_kitchen' ? now : null,
      demo.subType === 'home_kitchen'
        ? 'Demo kitchen: test order passed (fictional).'
        : null,
      todayIn('Asia/Karachi', now),
    ],
  );
  await m.query(
    `INSERT INTO business_plans (business_id, plan_key, started_at) VALUES ($1, 'community', $2) ON CONFLICT (business_id) DO NOTHING`,
    [business.id, now],
  );
  for (const [weekday, opens, closes] of demo.hours)
    await m.query(
      `INSERT INTO branch_hours (branch_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4)`,
      [branch.id, weekday, opens, closes],
    );
  for (const band of demo.bands)
    await m.query(
      `INSERT INTO delivery_fee_bands (branch_id, from_km, to_km, fee, min_order) VALUES ($1, $2, $3, $4, $5)`,
      [branch.id, band.fromKm, band.toKm, band.fee, band.minOrder],
    );
  const iban = buildPkIban(
    'MEZN',
    String(2000000000000000 + index * 104729).slice(0, 16),
  );
  const norm = normalizeAccountNumber('bank', iban);
  if (!norm.ok) throw new Error(`${demo.key}: bad demo IBAN: ${norm.reason}`);
  await m.query(
    `INSERT INTO vendor_payment_accounts (business_id, kind, account_title, account_number, bank_name) VALUES ($1, 'bank', $2, $3, 'Meezan Bank (demo)')`,
    [business.id, `${demo.name} (demo)`, norm.value],
  );

  // Menu: reusable option groups, then categories and items.
  const groupIds = new Map<
    string,
    { id: string; options: Array<{ id: string; isDefault: boolean }> }
  >();
  for (const g of demo.groups) {
    const group = await m.save(
      m.create(OptionGroup, {
        brandId: brand.id,
        name: g.name,
        minSelect: g.min,
        maxSelect: g.max,
      }),
    );
    const options = [];
    for (const [i, [name, delta, isDefault]] of g.options.entries()) {
      const o = await m.save(
        m.create(MenuOption, {
          groupId: group.id,
          name,
          priceDelta: delta,
          isDefault: !!isDefault,
          isActive: true,
          sort: i,
        }),
      );
      options.push({ id: o.id, isDefault: !!isDefault });
    }
    groupIds.set(g.key, { id: group.id, options });
  }
  const items: Array<{
    id: string;
    name: string;
    price: number;
    variant: { id: string; name: string } | null;
    required: string[];
  }> = [];
  for (const [ci, c] of demo.menu.entries()) {
    const cat = await m.save(
      m.create(MenuCategory, {
        brandId: brand.id,
        name: c.name,
        sort: ci,
        isActive: true,
        availableFrom: c.window?.[0] ?? null,
        availableTo: c.window?.[1] ?? null,
      }),
    );
    for (const [ii, it] of c.items.entries()) {
      const photo = it.photo
        ? await ctx.images.remote({
            ownerUserId: owner.id,
            purpose: 'menu_item',
            storeKey: demo.key,
            name: slugify(it.name),
            url: dishPhotoUrl(it.photo),
          })
        : null;
      const item = await m.save(
        m.create(MenuItem, {
          brandId: brand.id,
          categoryId: cat.id,
          name: it.name,
          description: it.description,
          photoUrl: photo?.url ?? null,
          basePrice: it.variants ? it.variants[0][1] : it.price,
          tags: it.tags ?? [],
          isDeal: it.isDeal ?? false,
          serves: it.serves ?? null,
          daysMask: it.days ? maskOf(it.days) : 127,
          isActive: true,
          sort: ii,
        }),
      );
      ctx.created.items += 1;
      let first: { id: string; name: string } | null = null;
      for (const [vi, [name, price]] of (it.variants ?? []).entries()) {
        const v = await m.save(
          m.create(ItemVariant, { itemId: item.id, name, price, sort: vi }),
        );
        if (!first) first = { id: v.id, name };
      }
      for (const [gi, key] of (it.groups ?? []).entries())
        await m.query(
          `INSERT INTO item_option_groups (item_id, group_id, sort) VALUES ($1, $2, $3)`,
          [item.id, groupIds.get(key)!.id, gi],
        );
      if (it.portions)
        await m.query(
          `INSERT INTO branch_item_overrides (branch_id, item_id, is_available, daily_limit, remaining_today) VALUES ($1, $2, true, $3, $3)`,
          [branch.id, item.id, it.portions],
        );
      await m.query(`SELECT food_item_search_refresh($1)`, [item.id]);
      items.push({
        id: item.id,
        name: it.name,
        price: it.variants ? it.variants[0][1] : it.price,
        variant: first,
        required: (it.groups ?? []).filter(
          (k) => demo.groups.find((g) => g.key === k)!.min > 0,
        ),
      });
    }
  }
  for (const s of demo.slots ?? [])
    await m.query(
      `INSERT INTO preorder_slots (branch_id, weekday, slot_start, cutoff_minutes_before, max_orders) VALUES ($1, $2, $3, $4, $5)`,
      [branch.id, s.weekday, s.start, s.cutoff, s.max],
    );
  await m.query(`SELECT food_brand_search_refresh($1)`, [brand.id]);

  // Deals.
  for (const d of demo.deals) {
    await m.query(
      `INSERT INTO food_promotions (brand_id, title, kind, value, item_ids, min_order, max_discount, code, starts_at,
              weekdays_mask, time_from, time_to)
       VALUES ($1, $2, $3, $4, $5::uuid[], $6, $7, $8, $9::timestamptz - interval '7 days', $10, $11, $12)`,
      [
        brand.id,
        d.title,
        d.kind,
        d.value,
        (d.items ?? []).map((n) => items.find((i) => i.name === n)!.id),
        d.minOrder ?? 0,
        d.maxDiscount ?? null,
        d.code ?? null,
        now,
        d.weekdays ? maskOf(d.weekdays) : 127,
        d.timeFrom ?? null,
        d.timeTo ?? null,
      ],
    );
    ctx.created.promotions += 1;
  }

  // Riders: vendor-issued usernames, the demo password.
  const riders: Array<{ id: string; username: string }> = [];
  for (const r of demo.riders ?? []) {
    const username = await allocateRiderUsername(
      m,
      buildRiderUsernameBase({ brandSlug: slug, fullName: r.name }),
    );
    const [u] = await m.query(
      `INSERT INTO users (email, username, password_hash, display_name, role, is_email_verified)
       VALUES ($1, $2, $3, $4, 'rider', true) RETURNING id`,
      [riderEmail(username), username, ctx.hash, r.name],
    );
    const [row] = await m.query(
      `INSERT INTO riders (user_id, business_id, full_name, phone, vehicle, status) VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
      [
        u.id,
        business.id,
        r.name,
        `+9230${String(10000000 + hashInt(r.name, 89999999)).slice(0, 8)}`,
        r.vehicle,
      ],
    );
    riders.push({ id: row.id, username });
    ctx.created.riders += 1;
  }

  // Past orders, delivered or collected, with their whole history.
  const local = ctx.customers.filter((c) => c.city === demo.city);
  for (let n = 0; n < demo.pastOrders; n++) {
    const seed = `${demo.key}:${n}`;
    const customer = local[hashInt(seed, local.length)];
    const pickup =
      !demo.acceptsDelivery ||
      (demo.acceptsPickup && hashInt(`${seed}:p`, 4) === 0);
    const lines: Array<{
      it: (typeof items)[number];
      qty: number;
      unit: number;
      opts: Array<{
        id: string;
        name: string;
        group: string;
        priceDelta: number;
      }>;
    }> = [];
    const count = 1 + hashInt(`${seed}:n`, 3);
    for (let l = 0; l < count; l++) {
      const it = items[hashInt(`${seed}:i${l}`, items.length)];
      if (lines.some((x) => x.it.id === it.id)) continue;
      const opts = it.required.map((key) => {
        const g = groupIds.get(key)!;
        const o = g.options.find((x) => x.isDefault) ?? g.options[0];
        const def = demo.groups.find((x) => x.key === key)!;
        const idx = g.options.indexOf(o);
        return {
          id: o.id,
          name: def.options[idx][0],
          group: def.name,
          priceDelta: def.options[idx][1],
        };
      });
      const unit = it.price + opts.reduce((s, o) => s + o.priceDelta, 0);
      lines.push({ it, qty: 1 + hashInt(`${seed}:q${l}`, 2), unit, opts });
    }
    const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
    const fee = pickup ? 0 : demo.bands[0].fee;
    const total = subtotal + fee;
    const daysAgo = 1 + hashInt(`${seed}:d`, 29);
    const placed = new Date(
      now.getTime() - daysAgo * 86_400_000 - hashInt(`${seed}:h`, 6) * 3600_000,
    );
    const at = (min: number) => new Date(placed.getTime() + min * 60_000);
    const rider =
      !pickup && riders.length && hashInt(`${seed}:r`, 3) > 0
        ? riders[hashInt(`${seed}:rr`, riders.length)]
        : null;
    const method = pickup ? 'pay_at_pickup' : 'cod';
    const lateBy = hashInt(`${seed}:late`, 5) === 0 ? 12 : -6;
    const promised = at(demo.prepMinutes + 30);
    const done = at(demo.prepMinutes + 30 + lateBy);
    const a = customer.address;
    const [order] = await m.query(
      `INSERT INTO food_orders (code, user_id, brand_id, branch_id, fulfilment, status, payment_method, payment_status,
              paid_at, address_snapshot, drop_geo, distance_m, subtotal, discount, delivery_fee, total, eta_minutes,
              promised_at, accept_by, rider_id, rider_step, cod_collected, accepted_at, preparing_at, ready_at,
              picked_up_at, delivered_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', $8, $9,
               CASE WHEN $10::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($11::float8, $10::float8), 4326)::geography END,
               $12, $13, 0, $14, $15, 30, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $8)
       RETURNING id, code`,
      [
        newCode('FC'),
        customer.id,
        brand.id,
        branch.id,
        pickup ? 'pickup' : 'delivery',
        pickup ? 'picked_up' : 'delivered',
        method,
        done,
        pickup
          ? null
          : JSON.stringify({
              label: 'home',
              fullName: a.name,
              phone: normalizePkPhone(a.phone),
              city: a.city,
              area: a.area,
              line1: a.line1,
              landmark: null,
              building: null,
              floor: null,
              riderInstructions: null,
              lat: a.lat,
              lng: a.lng,
            }),
        pickup ? null : a.lat,
        a.lng,
        pickup ? null : 1500 + hashInt(`${seed}:km`, 3000),
        subtotal,
        fee,
        total,
        promised,
        at(5),
        rider?.id ?? null,
        rider ? 'delivered' : null,
        method === 'cod' ? total : null,
        at(2),
        at(4),
        at(demo.prepMinutes + 2),
        pickup ? done : at(demo.prepMinutes + 8),
        pickup ? null : done,
        placed,
      ],
    );
    for (const [i, l] of lines.entries())
      await m.query(
        `INSERT INTO food_order_items (order_id, line_no, item_id, variant_id, item_name, variant_name, options, unit_price,
                quantity, line_total, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          order.id,
          i + 1,
          l.it.id,
          l.it.variant?.id ?? null,
          l.it.name,
          l.it.variant?.name ?? null,
          JSON.stringify(l.opts),
          l.unit,
          l.qty,
          l.unit * l.qty,
          placed,
        ],
      );
    const steps: Array<
      [
        kind: string,
        from: string | null,
        to: string,
        actor: string,
        min: number,
      ]
    > = [
      ['status', null, 'placed', 'customer', 0],
      ['status', 'placed', 'accepted', 'vendor', 2],
      ['status', 'accepted', 'preparing', 'vendor', 4],
      ['status', 'preparing', 'ready', 'vendor', demo.prepMinutes + 2],
    ];
    if (pickup)
      steps.push([
        'status',
        'ready',
        'picked_up',
        'vendor',
        demo.prepMinutes + 30 + lateBy,
      ]);
    else {
      if (rider)
        steps.push(
          ['rider', null, 'assigned', 'vendor', 3],
          ['rider', null, 'picked_up', 'rider', demo.prepMinutes + 8],
        );
      steps.push([
        'status',
        'ready',
        'on_the_way',
        rider ? 'rider' : 'vendor',
        demo.prepMinutes + 8,
      ]);
      steps.push([
        'status',
        'on_the_way',
        'delivered',
        rider ? 'rider' : 'vendor',
        demo.prepMinutes + 30 + lateBy,
      ]);
    }
    steps.push([
      'payment',
      pickup ? 'unpaid' : 'cod_pending',
      'paid',
      'vendor',
      demo.prepMinutes + 30 + lateBy,
    ]);
    for (const [kind, from, to, actor, min] of steps.sort(
      (x, y) => x[4] - y[4],
    ))
      await m.query(
        `INSERT INTO food_order_events (order_id, kind, from_state, to_state, actor_role, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, kind, from, to, actor, at(min)],
      );
    if (rider && method === 'cod') {
      await m.query(
        `INSERT INTO rider_cash_ledger (rider_id, order_id, kind, amount, at) VALUES ($1, $2, 'cod_collected', $3, $4)`,
        [rider.id, order.id, total, done],
      );
      // Older cash was handed over; the last couple of days' is still with the rider.
      if (daysAgo > 2)
        await m.query(
          `INSERT INTO rider_cash_ledger (rider_id, kind, amount, note, recorded_by, at) VALUES ($1, 'handover', $2, 'End of shift', $3, $4)`,
          [rider.id, -total, owner.id, new Date(done.getTime() + 3 * 3600_000)],
        );
    }
    ctx.created.orders += 1;
    // About two in three get a review.
    if (hashInt(`${seed}:rev`, 3) > 0) {
      const line = REVIEW_LINES[hashInt(`${seed}:rl`, REVIEW_LINES.length)];
      await m.query(
        `INSERT INTO food_reviews (order_id, brand_id, user_id, food_rating, delivery_rating, tags, text, vendor_reply, replied_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10)`,
        [
          order.id,
          brand.id,
          customer.id,
          line.stars,
          pickup
            ? null
            : Math.min(5, line.stars + (hashInt(`${seed}:dr`, 2) ? 0 : -1)) ||
              1,
          line.tags,
          line.text,
          line.stars <= 3
            ? 'Sorry about that — thank you for telling us. Your next order is on our minds.'
            : null,
          line.stars <= 3 ? new Date(done.getTime() + 86_400_000) : null,
          new Date(done.getTime() + 2 * 3600_000),
        ],
      );
      ctx.created.reviews += 1;
    }
  }
  return {
    key: demo.key,
    email: ctx.email,
    brandId: brand.id,
    slug,
    riders: riders.map((r) => r.username),
  };
}
