import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import {
  LOW_STOCK_THRESHOLD,
  likeEscape,
  PRODUCT_FROM_SQL,
  SqlParams,
  VISIBLE_PRODUCT_SQL,
  VISIBLE_STORE_SQL,
  variantLabel,
} from '../common/catalog-sql';
import {
  CatalogProductQueryDto,
  CatalogStoreQueryDto,
  ProductSort,
} from './dto/catalog-query.dto';

/** Below this, a typo is not treated as a match. */
const TRIGRAM_MIN = 0.4;
const HOME_LIMIT = 12;

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

/** Card fields every product list shares. Expects p, s, b aliases. */
const PRODUCT_CARD_COLUMNS = `
  p.id, p.name, p.slug, p.base_price, p.sale_price,
  COALESCE(p.sale_price, p.base_price) AS price,
  p.rating_avg, p.rating_count, p.sold_count, p.published_at,
  s.id AS store_id, s.slug AS store_slug, b.name AS store_name,
  (SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.created_at LIMIT 1) AS cover_url,
  EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.stock > 0) AS in_stock`;

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  price: number;
  basePrice: number;
  salePrice: number | null;
  onSale: boolean;
  coverUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
  inStock: boolean;
  isWishlisted?: boolean;
  store: { id: string; slug: string; name: string };
}

export const productCard = (r: any): ProductCard => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  price: r.price,
  basePrice: r.base_price,
  salePrice: r.sale_price,
  onSale: r.sale_price !== null,
  coverUrl: r.cover_url,
  ratingAvg: parseFloat(r.rating_avg),
  ratingCount: r.rating_count,
  inStock: r.in_stock,
  store: { id: r.store_id, slug: r.store_slug, name: r.store_name },
});

const STORE_CARD_COLUMNS = `
  s.id, s.slug, b.name, b.city, s.tagline, s.logo_url, s.cover_url, s.brand_color, s.on_brand_color,
  s.rating_avg, s.rating_count, s.is_featured,
  (SELECT count(*)::int FROM products p WHERE p.store_id = s.id AND p.status = 'active') AS product_count`;

const storeCard = (r: any) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  city: r.city,
  tagline: r.tagline,
  logoUrl: r.logo_url,
  coverUrl: r.cover_url,
  brandColor: r.brand_color,
  onBrandColor: r.on_brand_color,
  ratingAvg: parseFloat(r.rating_avg),
  ratingCount: r.rating_count,
  isFeatured: r.is_featured,
  productCount: r.product_count,
});

const SORT_SQL: Record<Exclude<ProductSort, 'relevance'>, string> = {
  newest: 'p.published_at DESC NULLS LAST',
  price_asc: 'price ASC',
  price_desc: 'price DESC',
  rating: 'p.rating_avg DESC, p.rating_count DESC',
  popular: 'p.sold_count DESC',
};

/**
 * The public shopping catalogue. Everything here uses the one visibility
 * rule (catalog-sql.ts), shows stock only as flags, and never exposes a
 * store's payment account numbers.
 */
@Injectable()
export class CatalogService {
  /**
   * Hooks other parts of Shopping fill in: wishlist flags for a signed-in
   * caller, the trending window, and the review breakdown.
   */
  wishlistedIds: (
    userId: string,
    productIds: string[],
  ) => Promise<Set<string>> = async () => new Set();

  constructor(private readonly dataSource: DataSource) {}

  // ── Categories ────────────────────────────────────────────────────────────

  async categories() {
    const rows: Array<{
      id: string;
      parent_id: string | null;
      name: string;
      slug: string;
      icon: string | null;
    }> = await this.dataSource.query(
      `SELECT id, parent_id, name, slug, icon FROM shop_categories WHERE is_active ORDER BY sort, name`,
    );
    const roots = rows
      .filter((r) => !r.parent_id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        icon: r.icon,
        children: [] as any[],
      }));
    const byId = new Map(roots.map((r) => [r.id, r]));
    for (const r of rows) {
      if (r.parent_id && byId.has(r.parent_id)) {
        byId.get(r.parent_id)!.children.push({
          id: r.id,
          name: r.name,
          slug: r.slug,
          icon: r.icon,
        });
      }
    }
    return roots;
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async products(q: CatalogProductQueryDto, userId?: string) {
    const params = new SqlParams();
    const where = [VISIBLE_PRODUCT_SQL];
    if (q.storeId) where.push(`p.store_id = ${params.add(q.storeId)}`);
    if (q.categoryId) {
      // A parent category matches its children too (the FYP's empty-store bug).
      const cat = params.add(q.categoryId);
      where.push(
        `p.category_id IN (SELECT id FROM shop_categories WHERE id = ${cat} OR parent_id = ${cat})`,
      );
    }
    if (q.collectionId)
      where.push(`p.collection_id = ${params.add(q.collectionId)}`);
    if (q.minPrice !== undefined)
      where.push(
        `COALESCE(p.sale_price, p.base_price) >= ${params.add(q.minPrice)}`,
      );
    if (q.maxPrice !== undefined)
      where.push(
        `COALESCE(p.sale_price, p.base_price) <= ${params.add(q.maxPrice)}`,
      );
    if (q.inStock === 'true') {
      where.push(
        `EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.stock > 0)`,
      );
    }
    if (q.minRating !== undefined)
      where.push(`p.rating_avg >= ${params.add(q.minRating)}`);
    if (q.onSale === 'true') where.push(`p.sale_price IS NOT NULL`);

    const sort = q.sort ?? 'relevance';
    const base = { where, params };

    if (q.q) {
      // Full-text first; a typo that matches nothing falls back to trigrams.
      const ft = await this.runProductQuery(base, q, sort, {
        match: (p) =>
          `p.search @@ websearch_to_tsquery('english', ${p.add(q.q)})`,
        rank: (p) =>
          `ts_rank(p.search, websearch_to_tsquery('english', ${p.add(q.q)}))`,
      });
      if (ft.total > 0) return this.withWishlist(ft, userId);
      const fuzzy = await this.runProductQuery(base, q, sort, {
        match: (p) =>
          `word_similarity(${p.add(q.q)}, p.name) >= ${TRIGRAM_MIN}`,
        rank: (p) => `word_similarity(${p.add(q.q)}, p.name)`,
      });
      return this.withWishlist(fuzzy, userId);
    }
    return this.withWishlist(await this.runProductQuery(base, q, sort), userId);
  }

  private async runProductQuery(
    base: { where: string[]; params: SqlParams },
    q: CatalogProductQueryDto,
    sort: ProductSort,
    search?: {
      match: (p: SqlParams) => string;
      rank: (p: SqlParams) => string;
    },
  ) {
    // Fresh params per run: the two search passes share the filters.
    const params = new SqlParams();
    base.params.values.forEach((v) => params.add(v));
    const where = [...base.where];
    if (search) where.push(search.match(params));
    const whereSql = where.join(' AND ');

    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total ${PRODUCT_FROM_SQL} WHERE ${whereSql}`,
      params.values,
    );
    const order =
      sort === 'relevance'
        ? search
          ? `${search.rank(params)} DESC, p.sold_count DESC`
          : 'p.sold_count DESC, p.rating_avg DESC, p.published_at DESC NULLS LAST'
        : SORT_SQL[sort];
    const rows = await this.dataSource.query(
      `SELECT ${PRODUCT_CARD_COLUMNS} ${PRODUCT_FROM_SQL}
        WHERE ${whereSql}
        ORDER BY ${order}, p.id
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    return paged<ProductCard>(rows.map(productCard), total, q);
  }

  private async withWishlist<T extends { items: ProductCard[] }>(
    page: T,
    userId?: string,
  ): Promise<T> {
    if (!userId || page.items.length === 0) return page;
    const ids = await this.wishlistedIds(
      userId,
      page.items.map((i) => i.id),
    );
    page.items.forEach((i) => (i.isWishlisted = ids.has(i.id)));
    return page;
  }

  /** Search-as-you-type: 5 products + 3 stores, prefix or near-miss. */
  async suggest(q: string) {
    const like = `%${likeEscape(q)}%`;
    const products = await this.dataSource.query(
      `SELECT ${PRODUCT_CARD_COLUMNS} ${PRODUCT_FROM_SQL}
        WHERE ${VISIBLE_PRODUCT_SQL}
          AND (p.name ILIKE $1 OR word_similarity($2, p.name) >= ${TRIGRAM_MIN})
        ORDER BY (p.name ILIKE $1) DESC, word_similarity($2, p.name) DESC, p.sold_count DESC, p.id
        LIMIT 5`,
      [like, q],
    );
    const stores = await this.dataSource.query(
      `SELECT ${STORE_CARD_COLUMNS}
         FROM stores s JOIN businesses b ON b.id = s.business_id
        WHERE ${VISIBLE_STORE_SQL}
          AND (b.name ILIKE $1 OR word_similarity($2, b.name) >= ${TRIGRAM_MIN})
        ORDER BY (b.name ILIKE $1) DESC, s.rating_avg DESC, s.id
        LIMIT 3`,
      [like, q],
    );
    return {
      products: products.map(productCard),
      stores: stores.map(storeCard),
    };
  }

  async product(id: string, userId?: string) {
    const [row] = await this.dataSource.query(
      `SELECT ${PRODUCT_CARD_COLUMNS}, p.description, p.tags, p.category_id, p.collection_id, p.store_id,
              s.logo_url AS store_logo_url, s.brand_color, s.on_brand_color,
              s.rating_avg AS store_rating_avg, s.rating_count AS store_rating_count,
              s.return_window_days, s.cod_enabled, s.shipping_flat_fee, s.free_shipping_over,
              s.dispatch_days_min, s.dispatch_days_max
         ${PRODUCT_FROM_SQL}
        WHERE p.id = $1 AND ${VISIBLE_PRODUCT_SQL}`,
      [id],
    );
    if (!row) throw notFound('Product');

    const [images, variants, breakdown] = await Promise.all([
      this.dataSource.query(
        `SELECT id, url, sort FROM product_images WHERE product_id = $1 ORDER BY sort, created_at`,
        [id],
      ),
      this.dataSource.query(
        `SELECT id, option1, option2, color_hex, price_delta, stock
           FROM product_variants WHERE product_id = $1 AND is_active ORDER BY sort, created_at, id`,
        [id],
      ),
      this.ratingBreakdown(id),
    ]);
    const card = productCard(row);
    const distinct = (key: 'option1' | 'option2') =>
      [
        ...new Set(variants.map((v: any) => v[key]).filter(Boolean)),
      ] as string[];
    const result = {
      ...card,
      description: row.description,
      tags: row.tags,
      categoryId: row.category_id,
      collectionId: row.collection_id,
      images: images.map((i: any) => ({ id: i.id, url: i.url })),
      options: { option1: distinct('option1'), option2: distinct('option2') },
      variants: variants.map((v: any) => ({
        id: v.id,
        option1: v.option1,
        option2: v.option2,
        label: variantLabel(v),
        colorHex: v.color_hex,
        price: card.price + v.price_delta,
        // Flags only: customers never learn exact stock numbers.
        inStock: v.stock > 0,
        lowStock: v.stock > 0 && v.stock <= LOW_STOCK_THRESHOLD,
      })),
      store: {
        id: row.store_id,
        slug: row.store_slug,
        name: row.store_name,
        logoUrl: row.store_logo_url,
        brandColor: row.brand_color,
        onBrandColor: row.on_brand_color,
        ratingAvg: parseFloat(row.store_rating_avg),
        ratingCount: row.store_rating_count,
        returnWindowDays: row.return_window_days,
        codEnabled: row.cod_enabled,
        shippingFlatFee: row.shipping_flat_fee,
        freeShippingOver: row.free_shipping_over,
        dispatchDaysMin: row.dispatch_days_min,
        dispatchDaysMax: row.dispatch_days_max,
      },
      ratingBreakdown: breakdown,
      isWishlisted: false,
    };
    if (userId)
      result.isWishlisted = (await this.wishlistedIds(userId, [id])).has(id);
    return result;
  }

  /** Overridden once reviews exist: { 5: n, 4: n, … }. */
  ratingBreakdown: (
    productId: string,
  ) => Promise<Record<1 | 2 | 3 | 4 | 5, number>> = async () => ({
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  });

  /** Same category; other stores first, then this store's. */
  async related(id: string) {
    const [row] = await this.dataSource.query(
      `SELECT p.category_id, p.store_id ${PRODUCT_FROM_SQL} WHERE p.id = $1 AND ${VISIBLE_PRODUCT_SQL}`,
      [id],
    );
    if (!row) throw notFound('Product');
    const rows = await this.dataSource.query(
      `SELECT ${PRODUCT_CARD_COLUMNS} ${PRODUCT_FROM_SQL}
        WHERE ${VISIBLE_PRODUCT_SQL} AND p.category_id = $1 AND p.id <> $2
        ORDER BY (p.store_id = $3) ASC, p.sold_count DESC, p.rating_avg DESC, p.id
        LIMIT 10`,
      [row.category_id, id, row.store_id],
    );
    return rows.map(productCard);
  }

  // ── Stores ────────────────────────────────────────────────────────────────

  async stores(q: CatalogStoreQueryDto) {
    const params = new SqlParams();
    const where = [VISIBLE_STORE_SQL];
    if (q.q) {
      const like = params.add(`%${likeEscape(q.q)}%`);
      where.push(`(b.name ILIKE ${like} OR s.tagline ILIKE ${like})`);
    }
    if (q.categoryId) {
      const cat = params.add(q.categoryId);
      where.push(
        `EXISTS (SELECT 1 FROM products p WHERE p.store_id = s.id AND p.status = 'active'
                  AND p.category_id IN (SELECT id FROM shop_categories WHERE id = ${cat} OR parent_id = ${cat}))`,
      );
    }
    if (q.city) {
      const city = params.add(q.city.trim());
      where.push(
        `(cardinality(s.delivery_cities) = 0 OR EXISTS (SELECT 1 FROM unnest(s.delivery_cities) c WHERE lower(c) = lower(${city})))`,
      );
    }
    if (q.featured === 'true') where.push('s.is_featured');
    const whereSql = where.join(' AND ');
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM stores s JOIN businesses b ON b.id = s.business_id WHERE ${whereSql}`,
      params.values,
    );
    const rows = await this.dataSource.query(
      `SELECT ${STORE_CARD_COLUMNS}
         FROM stores s JOIN businesses b ON b.id = s.business_id
        WHERE ${whereSql}
        ORDER BY s.is_featured DESC, s.rating_avg DESC, s.created_at DESC, s.id
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    return paged(rows.map(storeCard), total, q);
  }

  /** The public storefront. Policies, never account numbers. */
  async store(slug: string) {
    const [row] = await this.dataSource.query(
      `SELECT ${STORE_CARD_COLUMNS}, s.about, s.socials, s.delivery_cities, s.return_window_days,
              s.cod_enabled, s.cod_limit, s.shipping_flat_fee, s.free_shipping_over,
              s.dispatch_days_min, s.dispatch_days_max
         FROM stores s JOIN businesses b ON b.id = s.business_id
        WHERE s.slug = $1 AND ${VISIBLE_STORE_SQL}`,
      [slug],
    );
    if (!row) throw notFound('Store');
    const [collections, kinds] = await Promise.all([
      this.dataSource.query(
        `SELECT c.id, c.name, c.slug,
                (SELECT count(*)::int FROM products p WHERE p.collection_id = c.id AND p.status = 'active') AS product_count
           FROM store_collections c WHERE c.store_id = $1 ORDER BY c.sort, c.created_at`,
        [row.id],
      ),
      this.dataSource.query(
        `SELECT DISTINCT kind FROM store_payment_accounts WHERE store_id = $1 AND is_active ORDER BY kind`,
        [row.id],
      ),
    ]);
    const transferVia = kinds.map((k: any) => k.kind);
    return {
      ...storeCard(row),
      about: row.about,
      socials: row.socials,
      collections: collections.map((c: any) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        productCount: c.product_count,
      })),
      policies: {
        shippingFlatFee: row.shipping_flat_fee,
        freeShippingOver: row.free_shipping_over,
        returnWindowDays: row.return_window_days,
        dispatchDaysMin: row.dispatch_days_min,
        dispatchDaysMax: row.dispatch_days_max,
        deliveryCities: row.delivery_cities,
        paymentMethods: [
          ...(row.cod_enabled ? ['cod'] : []),
          ...(transferVia.length ? ['transfer'] : []),
        ],
        codLimit: row.cod_enabled ? row.cod_limit : null,
        transferVia,
      },
    };
  }

  // ── Home ──────────────────────────────────────────────────────────────────

  /** Overridden once orders exist: units sold in the last 14 days. */
  trending: (limit: number) => Promise<ProductCard[]> = async (limit) => {
    const rows = await this.dataSource.query(
      `SELECT ${PRODUCT_CARD_COLUMNS} ${PRODUCT_FROM_SQL}
        WHERE ${VISIBLE_PRODUCT_SQL}
        ORDER BY p.sold_count DESC, p.rating_avg DESC, p.id LIMIT $1`,
      [limit],
    );
    return rows.map(productCard);
  };

  async home(userId?: string) {
    const [banners, featured, newArrivals, trending, categories] =
      await Promise.all([
        this.liveBanners(),
        this.dataSource.query(
          `SELECT ${STORE_CARD_COLUMNS} FROM stores s JOIN businesses b ON b.id = s.business_id
          WHERE ${VISIBLE_STORE_SQL} AND s.is_featured
          ORDER BY s.rating_avg DESC, s.id LIMIT 10`,
        ),
        this.dataSource.query(
          `SELECT ${PRODUCT_CARD_COLUMNS} ${PRODUCT_FROM_SQL}
          WHERE ${VISIBLE_PRODUCT_SQL}
          ORDER BY p.published_at DESC NULLS LAST, p.id LIMIT $1`,
          [HOME_LIMIT],
        ),
        this.trending(HOME_LIMIT),
        this.categories(),
      ]);
    const products = { items: [...newArrivals.map(productCard), ...trending] };
    await this.withWishlist(products, userId);
    return {
      banners,
      featuredStores: featured.map(storeCard),
      newArrivals: products.items.slice(0, newArrivals.length),
      trending: products.items.slice(newArrivals.length),
      categories,
    };
  }

  /**
   * Active, inside their date window, and pointing at something a customer
   * can actually open — a banner for a paused store or a removed product is
   * dropped rather than leading to a 404.
   */
  private async liveBanners() {
    const rows = await this.dataSource.query(
      `SELECT bn.id, bn.image_url, bn.title, bn.subtitle, bn.target_type, bn.target_id
         FROM shop_banners bn
        WHERE bn.is_active
          AND (bn.starts_at IS NULL OR bn.starts_at <= now())
          AND (bn.ends_at IS NULL OR bn.ends_at >= now())
          AND (
            bn.target_type = 'none'
            OR (bn.target_type = 'category' AND EXISTS (SELECT 1 FROM shop_categories c WHERE c.id = bn.target_id AND c.is_active))
            OR (bn.target_type = 'store' AND EXISTS (
                  SELECT 1 FROM stores s JOIN businesses b ON b.id = s.business_id
                   WHERE s.id = bn.target_id AND ${VISIBLE_STORE_SQL}))
            OR (bn.target_type = 'collection' AND EXISTS (
                  SELECT 1 FROM store_collections sc JOIN stores s ON s.id = sc.store_id JOIN businesses b ON b.id = s.business_id
                   WHERE sc.id = bn.target_id AND ${VISIBLE_STORE_SQL}))
            OR (bn.target_type = 'product' AND EXISTS (
                  SELECT 1 ${PRODUCT_FROM_SQL} WHERE p.id = bn.target_id AND ${VISIBLE_PRODUCT_SQL}))
          )
        ORDER BY bn.sort, bn.created_at DESC`,
    );
    return rows.map((r: any) => ({
      id: r.id,
      imageUrl: r.image_url,
      title: r.title,
      subtitle: r.subtitle,
      targetType: r.target_type,
      targetId: r.target_id,
    }));
  }
}
