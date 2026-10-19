import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { VendorQueryDto } from './dto/discovery.dto';
import { BranchStateService } from '../availability/branch-state.service';
import {
  BranchRow,
  Quote,
  ServiceabilityService,
  branchColumns,
} from '../availability/serviceability.service';
import { MenuReadService } from '../menu/menu-read.service';
import { ErrorCode } from '../../../common/errors/codes';
import { likeEscape, paged } from '../../../common/pagination/pagination';
import { TRIGRAM_MIN } from '../../healthcare/reference/reference.service';

/** How far a customer may collect from, whatever the vendor's delivery zone. */
export const PICKUP_REACH_KM = 25;
/** Recently live = "New on Food Court". */
const NEW_DAYS = 30;
const CANDIDATE_CAP = 500;

/** The one visibility rule for customers: approved business, active brand, live branch. Aliases b, fb, br. */
export const VISIBLE_VENDOR_SQL = `b.status = 'approved' AND fb.status = 'active' AND br.status = 'active' AND br.geo IS NOT NULL`;

export interface DealLabel {
  id: string;
  title: string;
  label: string;
  /** Free delivery with no minimum: the card shows a Rs 0 fee. */
  freeDelivery: boolean;
}

interface Candidate extends BranchRow {
  brand: {
    id: string;
    slug: string;
    name: string;
    tagline: string | null;
    logo_url: string | null;
    cover_url: string | null;
    brand_color: string;
    on_brand_color: string;
    cuisine_ids: string[];
    price_level: number;
    is_home_kitchen: boolean;
    is_featured: boolean;
    rating_avg: string;
    rating_count: number;
    went_live_at: Date | null;
  };
}

/** A look for food, for the demand map: where, what, how many found and open. */
export interface SearchSignal {
  kind: 'home' | 'list' | 'search';
  point: { lat: number; lng: number };
  q: string | null;
  cuisine: string | null;
  results: number;
  openResults: number;
  now: Date;
}

export const vendorNotFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'This vendor is not on Food Court.',
  });

/**
 * What a customer can order from where they are. Every list starts from
 * VISIBLE_VENDOR_SQL plus the delivery radius (or pickup reach); paused
 * vendors are left out of lists but their own page still opens with the
 * pause message. Fee, minimum, ETA and open state come from
 * ServiceabilityService, the same code cart and checkout use.
 */
@Injectable()
export class FoodDiscoveryService {
  /** Filled in by promotions: live automatic deals per brand, best first. */
  dealsFor: (
    brandIds: string[],
    now: Date,
  ) => Promise<Map<string, DealLabel[]>> = async () => new Map();
  /** Filled in by orders (P5): brands this customer ordered from before, most recent first. */
  orderAgain: (userId: string) => Promise<string[]> = async () => [];
  /** Filled in by admin (P7): live banners near this point. */
  banners: (city: string | null, now: Date) => Promise<unknown[]> =
    async () => [];
  /** Filled in by reviews (P7): rating summary for a vendor page. */
  reviewSummary: (brandId: string) => Promise<unknown> = async () => null;
  /**
   * Chunk 5 additions, each a list so several sub-domains can add to them:
   * badges on vendor cards (signature, hygiene, Bachat Box), extra home
   * rails (rail → brand ids, best first), blocks on a vendor page and fields
   * on an item sheet.
   */
  readonly badgeSources: Array<
    (brandIds: string[], now: Date) => Promise<Map<string, string[]>>
  > = [];
  readonly railSources: Array<
    (ctx: {
      brandIds: string[];
      city: string | null;
      now: Date;
    }) => Promise<Record<string, string[]>>
  > = [];
  readonly vendorExtras: Array<
    (
      v: { brandId: string; branchId: string; timezone: string },
      now: Date,
    ) => Promise<Record<string, unknown>>
  > = [];
  readonly itemExtras: Array<
    (itemId: string, now: Date) => Promise<Record<string, unknown>>
  > = [];
  /** Narrow the vendor list (nutrition filters, P10): allowed brand ids, or null for no filter. */
  readonly brandFilters: Array<
    (q: VendorQueryDto) => Promise<string[] | null>
  > = [];
  /** Told about every home, list and search (the demand map, P8). Never fails the request. */
  readonly searchSinks: Array<(e: SearchSignal) => Promise<void>> = [];

  constructor(
    private readonly dataSource: DataSource,
    private readonly state: BranchStateService,
    private readonly serviceability: ServiceabilityService,
    private readonly menu: MenuReadService,
  ) {}

  /** Visible vendors near a point: deliverable to it, or (pickup) within reach. */
  private async candidates(
    point: { lat: number; lng: number },
    opts: {
      pickup?: boolean;
      q?: string;
      cuisine?: string;
      minRating?: number;
      homeKitchen?: boolean;
      priceLevel?: number;
      includePaused?: boolean;
      brandIds?: string[];
    } = {},
  ): Promise<Candidate[]> {
    const params: unknown[] = [point.lat, point.lng];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const geo = `ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography`;
    const where = [VISIBLE_VENDOR_SQL];
    if (!opts.includePaused) where.push('NOT br.is_paused');
    where.push(
      opts.pickup
        ? `br.accepts_pickup AND ST_DWithin(br.geo, ${geo}, ${PICKUP_REACH_KM * 1000})`
        : `br.accepts_delivery AND ST_DWithin(br.geo, ${geo}, br.max_radius_km * 1000)`,
    );
    if (opts.brandIds) where.push(`fb.id = ANY(${p(opts.brandIds)}::uuid[])`);
    if (opts.cuisine) {
      const c = p(opts.cuisine);
      where.push(
        `EXISTS (SELECT 1 FROM cuisines cu WHERE cu.id = ANY(fb.cuisine_ids) AND (cu.slug = ${c} OR cu.id::text = ${c}))`,
      );
    }
    if (opts.minRating) where.push(`fb.rating_avg >= ${p(opts.minRating)}`);
    if (opts.homeKitchen) where.push('fb.is_home_kitchen');
    if (opts.priceLevel) where.push(`fb.price_level = ${p(opts.priceLevel)}`);
    if (opts.q) {
      const text = p(opts.q);
      const like = p(`%${likeEscape(opts.q)}%`);
      where.push(`(fb.search @@ (websearch_to_tsquery('english', ${text}) || websearch_to_tsquery('simple', ${text}))
        OR fb.name ILIKE ${like} OR word_similarity(${text}, fb.name) >= ${TRIGRAM_MIN}
        OR EXISTS (SELECT 1 FROM menu_items mi WHERE mi.brand_id = fb.id AND mi.is_active
                    AND (mi.search @@ websearch_to_tsquery('english', ${text}) OR mi.name ILIKE ${like}
                         OR word_similarity(${text}, mi.name) >= ${TRIGRAM_MIN})))`);
    }
    const rows = await this.dataSource.query(
      `SELECT ${branchColumns('$1', '$2')},
              json_build_object('id', fb.id, 'slug', fb.slug, 'name', fb.name, 'tagline', fb.tagline,
                'logo_url', fb.logo_url, 'cover_url', fb.cover_url, 'brand_color', fb.brand_color,
                'on_brand_color', fb.on_brand_color, 'cuisine_ids', fb.cuisine_ids, 'price_level', fb.price_level,
                'is_home_kitchen', fb.is_home_kitchen, 'is_featured', fb.is_featured, 'rating_avg', fb.rating_avg,
                'rating_count', fb.rating_count, 'went_live_at', br.went_live_at) AS brand
         FROM food_brands fb JOIN branches br ON br.brand_id = fb.id JOIN businesses b ON b.id = fb.business_id
        WHERE ${where.join(' AND ')}
        ORDER BY fb.id LIMIT ${CANDIDATE_CAP}`,
      params,
    );
    return rows;
  }

  private async cuisineNames(ids: string[]) {
    if (!ids.length) return new Map<string, { name: string; slug: string }>();
    const rows = await this.dataSource.query(
      `SELECT id, name, slug FROM cuisines WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map<string, { name: string; slug: string }>(
      rows.map((r: any) => [r.id, { name: r.name, slug: r.slug }]),
    );
  }

  /** Cards with quotes, for any set of candidates. */
  private async cards(
    rows: Candidate[],
    fulfilment: 'delivery' | 'pickup',
    now: Date,
  ) {
    const brandIds = rows.map((r) => r.brand.id);
    const [schedules, deals, cuisines, badges] = await Promise.all([
      this.state.schedules(
        rows.map((r) => r.id),
        now,
      ),
      this.dealsFor(brandIds, now),
      this.cuisineNames([...new Set(rows.flatMap((r) => r.brand.cuisine_ids))]),
      this.badgesFor(brandIds, now),
    ]);
    return rows.map((r) => {
      const quote = this.serviceability.quote(
        r,
        schedules.get(r.id)!,
        fulfilment,
        { now },
      );
      const deal = deals.get(r.brand.id)?.[0] ?? null;
      return {
        row: r,
        quote,
        deal,
        card: {
          ...this.card(r, quote, deal, cuisines, now),
          badges: badges.get(r.brand.id) ?? [],
        },
      };
    });
  }

  private async signal(e: SearchSignal) {
    for (const sink of this.searchSinks)
      try {
        await sink(e);
      } catch {
        /* demand data is best-effort */
      }
  }

  private async badgesFor(brandIds: string[], now: Date) {
    const out = new Map<string, string[]>();
    if (!brandIds.length) return out;
    for (const m of await Promise.all(
      this.badgeSources.map((f) => f(brandIds, now)),
    ))
      for (const [id, list] of m)
        out.set(id, [...(out.get(id) ?? []), ...list]);
    return out;
  }

  private card(
    r: Candidate,
    q: Quote,
    deal: DealLabel | null,
    cuisines: Map<string, { name: string; slug: string }>,
    now: Date,
  ) {
    const b = r.brand;
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      tagline: b.tagline,
      logoUrl: b.logo_url,
      coverUrl: b.cover_url,
      brandColor: b.brand_color,
      onBrandColor: b.on_brand_color,
      cuisines: b.cuisine_ids.map((id) => cuisines.get(id)).filter(Boolean),
      priceLevel: b.price_level,
      ratingAvg: parseFloat(b.rating_avg),
      ratingCount: b.rating_count,
      isHomeKitchen: b.is_home_kitchen,
      isFeatured: b.is_featured,
      isNew:
        !!b.went_live_at &&
        now.getTime() - new Date(b.went_live_at).getTime() <
          NEW_DAYS * 86_400_000,
      distanceKm: q.distanceKm,
      etaRange: { min: q.eta.min, max: q.eta.max, label: q.etaLabel },
      deliveryFee: deal?.freeDelivery ? 0 : q.deliveryFee,
      minOrder: q.minOrder,
      freeDeliveryOver: q.freeDeliveryOver,
      dealLabel: deal?.label ?? null,
      fulfilment: { delivery: r.accepts_delivery, pickup: r.accepts_pickup },
      preorderOnly: r.preorder_only,
      openState: {
        open: q.open.open,
        paused: q.open.paused,
        label: q.open.label,
        opensAt: q.open.opensAt,
      },
    };
  }

  private recommendedScore(c: {
    quote: Quote;
    row: Candidate;
    deal: DealLabel | null;
  }) {
    const rating = parseFloat(c.row.brand.rating_avg) / 5;
    const reviews = Math.min(
      Math.log(1 + c.row.brand.rating_count) / Math.log(101),
      1,
    );
    const open = c.quote.open.open ? 1 : 0;
    const near = 1 - Math.min((c.quote.distanceKm ?? 10) / 10, 1);
    return (
      rating * 0.3 +
      reviews * 0.15 +
      open * 0.3 +
      near * 0.15 +
      (c.row.brand.is_featured ? 0.05 : 0) +
      (c.deal ? 0.05 : 0)
    );
  }

  async list(q: VendorQueryDto, now = new Date()) {
    const pickup = q.pickup === 'true';
    let brandIds: string[] | undefined;
    for (const f of this.brandFilters) {
      const allowed = await f(q);
      if (allowed === null) continue;
      brandIds = brandIds
        ? brandIds.filter((id) => allowed.includes(id))
        : allowed;
    }
    const rows = await this.candidates(
      { lat: q.lat, lng: q.lng },
      {
        pickup,
        q: q.q,
        cuisine: q.cuisine,
        minRating: q.minRating,
        homeKitchen: q.homeKitchen === 'true',
        priceLevel: q.priceLevel,
        brandIds,
      },
    );
    let list = await this.cards(rows, pickup ? 'pickup' : 'delivery', now);
    if (q.openNow === 'true') list = list.filter((c) => c.quote.open.open);
    if (q.offers === 'true') list = list.filter((c) => c.deal);
    if (q.freeDelivery === 'true')
      list = list.filter((c) => c.card.deliveryFee === 0);
    await this.signal({
      kind: 'list',
      point: { lat: q.lat, lng: q.lng },
      q: q.q ?? null,
      cuisine: q.cuisine ?? null,
      results: list.length,
      openResults: list.filter((c) => c.quote.open.open).length,
      now,
    });
    const by = q.sort ?? 'recommended';
    const sorters: Record<
      string,
      (a: (typeof list)[number], b: (typeof list)[number]) => number
    > = {
      recommended: (a, b) =>
        this.recommendedScore(b) - this.recommendedScore(a),
      distance: (a, b) => (a.quote.distanceKm ?? 0) - (b.quote.distanceKm ?? 0),
      rating: (a, b) =>
        b.card.ratingAvg - a.card.ratingAvg ||
        b.card.ratingCount - a.card.ratingCount,
      delivery_time: (a, b) => a.quote.eta.min - b.quote.eta.min,
      delivery_fee: (a, b) => a.card.deliveryFee - b.card.deliveryFee,
    };
    // Open vendors first for every sort; then the sort; then id for stable pages.
    list.sort(
      (a, b) =>
        Number(b.quote.open.open) - Number(a.quote.open.open) ||
        sorters[by](a, b) ||
        a.card.id.localeCompare(b.card.id),
    );
    const start = (q.page - 1) * q.pageSize;
    return paged(
      list.slice(start, start + q.pageSize).map((c) => c.card),
      list.length,
      q,
    );
  }

  /** The home screen sections for a point. */
  async home(
    point: { lat: number; lng: number },
    userId: string | null,
    now = new Date(),
  ) {
    const [rows, pickupRows, cuisines] = await Promise.all([
      this.candidates(point),
      this.candidates(point, { pickup: true }),
      this.dataSource.query(
        `SELECT id, name, slug, icon FROM cuisines WHERE is_active ORDER BY sort, name`,
      ),
    ]);
    const list = await this.cards(rows, 'delivery', now);
    const open = list.filter((c) => c.quote.open.open);
    const top = (xs: typeof list, n = 10) => xs.slice(0, n).map((c) => c.card);
    const [city] = rows.length
      ? await this.dataSource.query(`SELECT city FROM branches WHERE id = $1`, [
          rows[0].id,
        ])
      : [{ city: null }];
    const again = userId ? await this.orderAgain(userId) : [];
    await this.signal({
      kind: 'home',
      point,
      q: null,
      cuisine: null,
      results: list.length,
      openResults: open.length,
      now,
    });
    const extra = await this.extraRails(
      list,
      pickupRows,
      city?.city ?? null,
      now,
    );
    return {
      coverage: {
        delivering: rows.length > 0,
        message: rows.length ? null : 'Not delivering here yet',
        pickupNearby: pickupRows.length,
      },
      cuisines,
      banners: await this.banners(city?.city ?? null, now),
      orderAgain: again
        .map((id) => list.find((c) => c.card.id === id)?.card)
        .filter(Boolean)
        .slice(0, 10),
      offers: top(open.filter((c) => c.deal)),
      homeKitchens: top(list.filter((c) => c.row.brand.is_home_kitchen)),
      topRated: top(
        [...open]
          .filter((c) => c.card.ratingCount > 0)
          .sort((a, b) => b.card.ratingAvg - a.card.ratingAvg),
      ),
      fastest: top([...open].sort((a, b) => a.quote.eta.min - b.quote.eta.min)),
      newOnFoodCourt: top(list.filter((c) => c.card.isNew)),
      freeDelivery: top(open.filter((c) => c.card.deliveryFee === 0)),
      ...extra,
    };
  }

  /**
   * Rails other sub-domains add to the home (iftarNearYou, surplusNearYou,
   * tiffinNearYou). Vendors you can only collect from (a Bachat Box) get
   * pickup cards; everything keeps the order the rail gave, open first.
   */
  private async extraRails(
    list: Awaited<ReturnType<FoodDiscoveryService['cards']>>,
    pickupRows: Candidate[],
    city: string | null,
    now: Date,
  ): Promise<Record<string, unknown[]>> {
    if (!this.railSources.length) return {};
    const brandIds = [
      ...new Set([
        ...list.map((c) => c.card.id),
        ...pickupRows.map((r) => r.brand.id),
      ]),
    ];
    const rails = Object.assign(
      {},
      ...(await Promise.all(
        this.railSources.map((f) => f({ brandIds, city, now })),
      )),
    ) as Record<string, string[]>;
    const pool = new Map(list.map((c) => [c.card.id, c]));
    const missing = new Set(
      Object.values(rails)
        .flat()
        .filter((id) => !pool.has(id)),
    );
    if (missing.size)
      for (const c of await this.cards(
        pickupRows.filter((r) => missing.has(r.brand.id)),
        'pickup',
        now,
      ))
        pool.set(c.card.id, c);
    const out: Record<string, unknown[]> = {};
    for (const [name, ids] of Object.entries(rails)) {
      const cs = ids.map((id) => pool.get(id)).filter((c) => !!c);
      cs.sort((a, b) => Number(b.quote.open.open) - Number(a.quote.open.open));
      out[name] = cs.slice(0, 10).map((c) => c.card);
    }
    return out;
  }

  /** A vendor's own page: open state (even when paused), fulfilment, quote, deals, rating, full menu. */
  async vendor(
    slug: string,
    point: { lat?: number; lng?: number },
    now = new Date(),
  ) {
    const [row] = await this.dataSource.query(
      `SELECT br.id FROM food_brands fb JOIN branches br ON br.brand_id = fb.id JOIN businesses b ON b.id = fb.business_id
        WHERE (fb.slug = $1 OR fb.id::text = $1) AND ${VISIBLE_VENDOR_SQL}`,
      [slug],
    );
    if (!row) throw vendorNotFound();
    const hasPoint = point.lat !== undefined && point.lng !== undefined;
    const branch = (await this.serviceability.branch(
      row.id,
      hasPoint ? { lat: point.lat!, lng: point.lng! } : null,
    ))!;
    const [brand] = await this.dataSource.query(
      `SELECT fb.*, br.address_line, br.area, br.city, br.phone, br.went_live_at
         FROM food_brands fb JOIN branches br ON br.brand_id = fb.id WHERE br.id = $1`,
      [row.id],
    );
    const candidate = {
      ...branch,
      brand: { ...brand, went_live_at: brand.went_live_at },
    } as Candidate;
    const [{ card, quote }] = await this.cards([candidate], 'delivery', now);
    const pickup = (await this.cards([candidate], 'pickup', now))[0].quote;
    const [menu, rating, deals, ...extras] = await Promise.all([
      this.menu.customerMenu(brand.id, row.id, branch.timezone, now),
      this.reviewSummary(brand.id),
      this.dealsFor([brand.id], now),
      ...this.vendorExtras.map((f) =>
        f(
          { brandId: brand.id, branchId: row.id, timezone: branch.timezone },
          now,
        ),
      ),
    ]);
    return {
      ...card,
      paused: branch.is_paused,
      pauseMessage: branch.is_paused
        ? branch.pause_message || 'Not taking orders right now'
        : null,
      location: {
        addressLine: brand.address_line,
        area: brand.area,
        city: brand.city,
        lat: branch.lat,
        lng: branch.lng,
        phone: brand.phone,
      },
      delivery: hasPoint
        ? {
            available: branch.accepts_delivery && quote.serviceable,
            outOfZone: branch.accepts_delivery && !quote.serviceable,
            fee: card.deliveryFee,
            minOrder: quote.minOrder,
            etaRange: card.etaRange,
          }
        : null,
      pickup: branch.accepts_pickup
        ? {
            readyIn: {
              min: pickup.eta.min,
              max: pickup.eta.max,
              label: pickup.etaLabel,
            },
          }
        : null,
      acceptsCod: branch.accepts_cod,
      deals: deals.get(brand.id) ?? [],
      ratingSummary: rating,
      menu: menu.categories,
      popular: menu.popular,
      ...Object.assign({}, ...extras),
    };
  }

  /** An item sheet, for a visible vendor only. */
  async item(itemId: string, now = new Date()) {
    const [row] = await this.dataSource.query(
      `SELECT br.id AS branch_id, br.timezone FROM menu_items mi JOIN food_brands fb ON fb.id = mi.brand_id
         JOIN branches br ON br.brand_id = fb.id JOIN businesses b ON b.id = fb.business_id
        WHERE mi.id = $1 AND mi.is_active AND ${VISIBLE_VENDOR_SQL}`,
      [itemId],
    );
    if (!row)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Dish not found.',
      });
    const [sheet, ...extras] = await Promise.all([
      this.menu.itemSheet(itemId, row.branch_id, row.timezone, now),
      ...this.itemExtras.map((f) => f(itemId, now)),
    ]);
    return sheet && Object.assign(sheet, ...extras);
  }

  /** Vendors by name/cuisine, and dishes grouped by the vendor that cooks them. */
  async search(
    q: string,
    point: { lat: number; lng: number },
    now = new Date(),
  ) {
    const rows = await this.candidates(point, { q });
    const list = await this.cards(rows, 'delivery', now);
    await this.signal({
      kind: 'search',
      point,
      q,
      cuisine: null,
      results: list.length,
      openResults: list.filter((c) => c.quote.open.open).length,
      now,
    });
    if (!list.length) return { vendors: [], dishes: [] };
    const like = `%${likeEscape(q)}%`;
    const dishes = await this.dataSource.query(
      `SELECT mi.id, mi.brand_id, mi.name, mi.photo_url, mi.base_price, mi.tags,
              (SELECT min(v.price) FROM item_variants v WHERE v.item_id = mi.id) AS min_variant,
              ts_rank(mi.search, websearch_to_tsquery('english', $1)) AS rank
         FROM menu_items mi JOIN menu_categories c ON c.id = mi.category_id AND c.is_active
        WHERE mi.brand_id = ANY($2::uuid[]) AND mi.is_active
          AND (mi.search @@ websearch_to_tsquery('english', $1) OR mi.name ILIKE $3 OR word_similarity($1, mi.name) >= ${TRIGRAM_MIN})
        ORDER BY rank DESC, mi.sold_30d DESC, mi.name`,
      [q, list.map((c) => c.card.id), like],
    );
    const byBrand = new Map<string, any[]>();
    for (const d of dishes)
      byBrand.set(d.brand_id, [...(byBrand.get(d.brand_id) ?? []), d]);
    const ordered = [...list].sort(
      (a, b) =>
        Number(b.quote.open.open) - Number(a.quote.open.open) ||
        (a.quote.distanceKm ?? 0) - (b.quote.distanceKm ?? 0),
    );
    return {
      vendors: ordered
        .filter(
          (c) =>
            !byBrand.has(c.card.id) ||
            c.card.name.toLowerCase().includes(q.toLowerCase()),
        )
        .map((c) => c.card),
      dishes: ordered
        .filter((c) => byBrand.has(c.card.id))
        .map((c) => ({
          vendor: c.card,
          items: byBrand
            .get(c.card.id)!
            .slice(0, 5)
            .map((d) => ({
              id: d.id,
              name: d.name,
              photoUrl: d.photo_url,
              fromPrice: d.min_variant ?? d.base_price,
              tags: d.tags,
            })),
        })),
    };
  }
}
