import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { DataSource, EntityManager, Not } from 'typeorm';
import { User } from '../../../modules/users/entities/user.entity';
import { Business } from '../../../modules/businesses/entities/business.entity';
import { slugify } from '../../../modules/businesses/businesses.service';
import { Store } from '../../../modules/shopping/stores/entities/store.entity';
import { StorePaymentAccount } from '../../../modules/shopping/stores/entities/store-payment-account.entity';
import { StoreCollection } from '../../../modules/shopping/stores/entities/store-collection.entity';
import { normalizeCity } from '../../../modules/shopping/stores/stores.service';
import { Product } from '../../../modules/shopping/products/entities/product.entity';
import { ProductImage } from '../../../modules/shopping/products/entities/product-image.entity';
import { ProductVariant } from '../../../modules/shopping/products/entities/product-variant.entity';
import { InventoryMovement } from '../../../modules/shopping/inventory/entities/inventory-movement.entity';
import { Coupon } from '../../../modules/shopping/coupons/entities/coupon.entity';
import { ShopBanner } from '../../../modules/shopping/catalog/entities/shop-banner.entity';
import { onBrandColor } from '../../../modules/shopping/common/contrast';
import {
  buildPkIban,
  normalizeAccountNumber,
} from '../../../common/payments/payment-account.validation';
import { normalizePkPhone } from '../../../common/validation/phone';
import { PASSWORD_REGEX } from '../../../common/validation/password';
import {
  DEMO_BANNERS,
  DEMO_STORES,
  DemoProduct,
  DemoStore,
  VariantSpec,
} from './catalog-data';
import { SeedImages } from './tiles';

export const DEMO_EMAIL = (key: string) => `demo.${key}@metromatrix.test`;

export interface SeedShoppingOptions {
  /** Password for the four demo partner accounts (from SEED_DEMO_PASSWORD). */
  password: string;
  bcryptRounds?: number;
  images: SeedImages;
  log?: (line: string) => void;
}

export interface SeedShoppingResult {
  stores: Array<{
    key: string;
    email: string;
    storeId: string;
    slug: string;
    products: number;
  }>;
  created: Record<
    | 'partners'
    | 'products'
    | 'variants'
    | 'coupons'
    | 'collections'
    | 'accounts'
    | 'banners',
    number
  >;
}

/** Stable small numbers from a name, so reruns and machines agree. */
const hashInt = (s: string, mod: number) =>
  parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16) % mod;

export function variantRows(spec: VariantSpec) {
  const rows: Array<{
    option1: string | null;
    option2: string | null;
    colorHex: string | null;
    priceDelta: number;
    stock: number;
  }> = [];
  if (spec.kind === 'single') {
    rows.push({
      option1: null,
      option2: null,
      colorHex: null,
      priceDelta: 0,
      stock: spec.stock,
    });
  } else if (spec.kind === 'options') {
    spec.label1.forEach((label, i) =>
      rows.push({
        option1: label,
        option2: null,
        colorHex: null,
        priceDelta: spec.deltas?.[i] ?? 0,
        stock: Math.max(0, spec.stock - (i % 3)),
      }),
    );
  } else {
    const colours = spec.colours ?? [
      [null, null] as unknown as [string, string],
    ];
    spec.sizes.forEach((size, i) =>
      colours.forEach(([colour, hex], j) =>
        rows.push({
          option1: size,
          option2: colour ?? null,
          colorHex: hex ?? null,
          priceDelta: 0,
          stock: Math.max(0, spec.stock - ((i + j) % 4)),
        }),
      ),
    );
  }
  return rows;
}

/**
 * The demo marketplace: four approved store partners with products,
 * variants, collections, coupons, payment accounts and three banners.
 *
 * Idempotent: everything is found by a natural key (email, store + slug,
 * store + code, banner title) and only missing rows are created; store
 * settings are re-applied. Stock and orders created since are left alone.
 */
export async function seedShopping(
  ds: DataSource,
  opts: SeedShoppingOptions,
): Promise<SeedShoppingResult> {
  const log = opts.log ?? (() => undefined);
  if (
    opts.password.length < 8 ||
    opts.password.length > 72 ||
    !PASSWORD_REGEX.test(opts.password)
  ) {
    throw new Error(
      'SEED_DEMO_PASSWORD must be 8–72 characters with a lower-case letter, an upper-case letter and a digit',
    );
  }
  const created: SeedShoppingResult['created'] = {
    partners: 0,
    products: 0,
    variants: 0,
    coupons: 0,
    collections: 0,
    accounts: 0,
    banners: 0,
  };
  const categories = new Map<string, string>(
    (await ds.query(`SELECT id, slug FROM shop_categories`)).map(
      (r: { id: string; slug: string }) => [r.slug, r.id],
    ),
  );
  if (!categories.size)
    throw new Error('No shop categories — run the migrations first.');

  const hash = await bcrypt.hash(opts.password, opts.bcryptRounds ?? 12);
  const result: SeedShoppingResult['stores'] = [];
  const storeIds = new Map<
    string,
    { storeId: string; ownerId: string; collections: Map<string, string> }
  >();

  for (const demo of DEMO_STORES) {
    const out = await ds.transaction(async (m) => {
      const owner = await ensurePartner(m, demo, hash, created);
      const business = await ensureBusiness(m, demo, owner.id);
      const store = await ensureStore(m, demo, business, owner.id, opts.images);
      created.accounts += await ensureAccounts(m, demo, store.id);
      const collections = await ensureCollections(m, demo, store.id, created);
      let count = 0;
      for (const [i, p] of demo.products.entries()) {
        count += await ensureProduct(
          m,
          demo,
          p,
          i,
          store.id,
          owner.id,
          categories,
          collections,
          opts.images,
          created,
        );
      }
      for (const c of demo.coupons) {
        const exists = await m.exists(Coupon, {
          where: { storeId: store.id, code: c.code },
        });
        if (exists) continue;
        const now = new Date();
        await m.insert(Coupon, {
          storeId: store.id,
          code: c.code,
          type: c.type,
          value: c.value,
          minOrder: c.minOrder ?? 0,
          maxDiscount: c.maxDiscount ?? null,
          startsAt: now,
          endsAt: new Date(now.getTime() + 365 * 86_400_000),
          usageLimit: null,
          perUserLimit: 3,
        });
        created.coupons += 1;
      }
      storeIds.set(demo.key, {
        storeId: store.id,
        ownerId: owner.id,
        collections,
      });
      return {
        key: demo.key,
        email: DEMO_EMAIL(demo.key),
        storeId: store.id,
        slug: store.slug,
        products: count,
      };
    });
    result.push(out);
    log(`[seed] ${demo.name}: store ${out.slug}, ${out.products} products`);
  }

  await ds.transaction(async (m) => {
    for (const [i, b] of DEMO_BANNERS.entries()) {
      const t = b.target;
      const storeKey = 'store' in t ? t.store : 'beauty';
      const owner = storeIds.get(storeKey)!;
      const targetId =
        t.type === 'store'
          ? owner.storeId
          : t.type === 'collection'
            ? owner.collections.get(t.collection)
            : categories.get(t.category);
      if (!targetId) {
        throw new Error(
          `Banner "${b.title}": its ${t.type} target was not found`,
        );
      }
      const existing = await m.findOne(ShopBanner, {
        where: { title: b.title },
      });
      if (existing) {
        // Re-point it in case the target was recreated (or was wrong).
        await m.update(
          ShopBanner,
          { id: existing.id },
          { targetType: t.type, targetId },
        );
        continue;
      }
      const demo = DEMO_STORES.find((s) => s.key === storeKey)!;
      const image = await opts.images.image({
        ownerUserId: owner.ownerId,
        purpose: 'banner',
        storeKey: demo.key,
        name: `banner-${i + 1}`,
        title: b.title,
        caption: b.subtitle,
        bg: demo.brandColor,
        fg: onBrandColor(demo.brandColor)!,
        motif: demo.motif,
        width: 1200,
        height: 500,
      });
      await m.insert(ShopBanner, {
        imageUrl: image.url,
        title: b.title,
        subtitle: b.subtitle,
        targetType: t.type,
        targetId,
        sort: i,
        isActive: true,
      });
      created.banners += 1;
    }
  });
  return { stores: result, created };
}

export async function ensurePartner(
  m: EntityManager,
  demo: DemoStore,
  hash: string,
  created: SeedShoppingResult['created'],
) {
  const email = DEMO_EMAIL(demo.key);
  const found = await m.findOne(User, {
    where: { email, status: Not('deleted') },
  });
  if (found) {
    if (found.role !== 'partner')
      throw new Error(`${email} exists but is not a partner account`);
    return found;
  }
  created.partners += 1;
  return m.save(
    m.create(User, {
      email,
      passwordHash: hash,
      displayName: demo.ownerName,
      role: 'partner',
      isEmailVerified: true,
      phone: normalizePkPhone(demo.phone) ?? null,
    }),
  );
}

export async function ensureBusiness(
  m: EntityManager,
  demo: DemoStore,
  ownerId: string,
) {
  const found = await m.findOne(Business, { where: { ownerUserId: ownerId } });
  if (found) {
    if (found.serviceType !== 'shopping')
      throw new Error(
        `${demo.name}: owner already runs a ${found.serviceType} business`,
      );
    return found;
  }
  const now = new Date();
  return m.save(
    m.create(Business, {
      ownerUserId: ownerId,
      serviceType: 'shopping',
      subType: 'store',
      name: demo.name,
      slug: slugify(demo.name),
      phone: normalizePkPhone(demo.phone)!,
      city: demo.city,
      addressLine: demo.addressLine,
      // Demo partners are approved directly; real ones go through review.
      status: 'approved',
      submittedAt: now,
      reviewedAt: now,
    }),
  );
}

export async function ensureStore(
  m: EntityManager,
  demo: DemoStore,
  business: Business,
  ownerId: string,
  images: SeedImages,
) {
  const on = onBrandColor(demo.brandColor);
  if (!on)
    throw new Error(`${demo.name}: brand colour fails the contrast rule`);
  await m
    .createQueryBuilder()
    .insert()
    .into(Store)
    .values({
      businessId: business.id,
      slug: business.slug,
      brandColor: demo.brandColor,
      onBrandColor: on,
      socials: {},
      deliveryCities: [],
    })
    .orIgnore()
    .execute();
  const store = await m.findOneByOrFail(Store, { businessId: business.id });
  const art = {
    ownerUserId: ownerId,
    purpose: 'store_branding' as const,
    storeKey: demo.key,
    bg: demo.brandColor,
    fg: on,
    motif: demo.motif,
  };
  const logo =
    store.logoUrl ??
    (
      await images.image({
        ...art,
        name: 'logo',
        title: demo.name
          .split(' ')
          .map((w) => w[0])
          .join(''),
        width: 400,
        height: 400,
      })
    ).url;
  const cover =
    store.coverUrl ??
    (
      await images.image({
        ...art,
        name: 'cover',
        title: demo.name,
        caption: demo.tagline,
        width: 1200,
        height: 500,
      })
    ).url;
  await m.update(
    Store,
    { id: store.id },
    {
      tagline: demo.tagline,
      about: demo.about,
      brandColor: demo.brandColor,
      onBrandColor: on,
      logoUrl: logo,
      coverUrl: cover,
      isFeatured: demo.featured,
      deliveryCities: demo.deliveryCities.map(normalizeCity),
      shippingFlatFee: demo.shippingFlatFee,
      freeShippingOver: demo.freeShippingOver,
      returnWindowDays: demo.returnWindowDays,
      codEnabled: true,
      codLimit: demo.codLimit,
      dispatchDaysMin: 1,
      dispatchDaysMax: 3,
    },
  );
  return m.findOneByOrFail(Store, { id: store.id });
}

export async function ensureAccounts(
  m: EntityManager,
  demo: DemoStore,
  storeId: string,
): Promise<number> {
  let n = 0;
  for (const a of demo.accounts) {
    const raw =
      a.kind === 'bank'
        ? buildPkIban(...(a.number.split(':') as [string, string]))
        : a.number;
    const norm = normalizeAccountNumber(a.kind, raw);
    if (!norm.ok)
      throw new Error(`${demo.name}: bad ${a.kind} account: ${norm.reason}`);
    if (
      await m.exists(StorePaymentAccount, {
        where: { storeId, accountNumber: norm.value },
      })
    )
      continue;
    await m.insert(StorePaymentAccount, {
      storeId,
      kind: a.kind,
      accountTitle: a.title,
      accountNumber: norm.value,
      bankName: a.bankName ?? null,
      isActive: true,
    });
    n += 1;
  }
  return n;
}

async function ensureCollections(
  m: EntityManager,
  demo: DemoStore,
  storeId: string,
  created: SeedShoppingResult['created'],
) {
  const out = new Map<string, string>();
  for (const [i, name] of demo.collections.entries()) {
    const slug = slugify(name);
    let c = await m.findOne(StoreCollection, { where: { storeId, slug } });
    if (!c) {
      c = await m.save(
        m.create(StoreCollection, { storeId, name, slug, sort: i }),
      );
      created.collections += 1;
    }
    out.set(name, c.id);
  }
  return out;
}

export async function ensureProduct(
  m: EntityManager,
  demo: DemoStore,
  p: DemoProduct,
  i: number,
  storeId: string,
  ownerId: string,
  categories: Map<string, string>,
  collections: Map<string, string>,
  images: SeedImages,
  created: SeedShoppingResult['created'],
): Promise<number> {
  const slug = slugify(p.name);
  if (await m.exists(Product, { where: { storeId, slug } })) return 1;
  const categoryId = categories.get(p.category);
  if (!categoryId) throw new Error(`${p.name}: unknown category ${p.category}`);
  const product = await m.save(
    m.create(Product, {
      storeId,
      categoryId,
      collectionId: p.collection ? collections.get(p.collection)! : null,
      name: p.name,
      slug,
      description: p.description,
      basePrice: p.basePrice,
      salePrice: p.salePrice ?? null,
      status: 'active',
      tags: p.tags,
      // Staggered so "newest" has an order; sold counts are synthetic demo
      // numbers (there are no fabricated reviews or ratings).
      publishedAt: new Date(Date.now() - i * 3_600_000),
      soldCount: hashInt(p.name, 40),
    }),
  );
  const fg = onBrandColor(demo.brandColor)!;
  const image = await images.image({
    ownerUserId: ownerId,
    purpose: 'product_image',
    storeKey: demo.key,
    name: slug,
    title: p.name,
    caption: demo.name,
    bg: demo.brandColor,
    fg,
    motif: demo.motif,
  });
  await m.insert(ProductImage, {
    productId: product.id,
    url: image.url,
    publicId: image.publicId,
    sort: 0,
  });
  for (const [sort, v] of variantRows(p.variants).entries()) {
    const saved = await m.save(
      m.create(ProductVariant, {
        productId: product.id,
        ...v,
        sku: null,
        isActive: true,
        sort,
      }),
    );
    created.variants += 1;
    if (saved.stock > 0) {
      await m.insert(InventoryMovement, {
        variantId: saved.id,
        delta: saved.stock,
        reason: 'manual',
        refType: 'seed',
        refId: product.id,
        actorUserId: ownerId,
        balanceAfter: saved.stock,
      });
    }
  }
  created.products += 1;
  return 1;
}
