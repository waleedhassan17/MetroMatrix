import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Product, ProductStatus } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { InventoryMovement } from '../inventory/entities/inventory-movement.entity';
import { InventoryService, StockChange } from '../inventory/inventory.service';
import { ShopCategory } from '../catalog/entities/shop-category.entity';
import { StoreCollection } from '../stores/entities/store-collection.entity';
import {
  CreateProductDto,
  PartnerProductQueryDto,
  ProductImageDto,
  ProductVariantDto,
  UpdateProductDto,
} from './dto/product.dto';
import { MediaService } from '../../media/media.service';
import { slugify } from '../../businesses/businesses.service';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { invalidTransition } from '../common/transitions';
import {
  LOW_STOCK_THRESHOLD,
  likeEscape,
  SqlParams,
  unitPrice,
  variantLabel,
} from '../common/catalog-sql';

const notFound = (what = 'Product') =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

const invalid = (field: string, message: string) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] } },
  });

/** What the partner sees: exact stock, every variant, every status. */
export function partnerProductView(
  p: Product,
  images: ProductImage[],
  variants: ProductVariant[],
) {
  const sortedVariants = [...variants].sort(
    (a, b) =>
      a.sort - b.sort ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    categoryId: p.categoryId,
    collectionId: p.collectionId,
    basePrice: p.basePrice,
    salePrice: p.salePrice,
    price: p.salePrice ?? p.basePrice,
    status: p.status,
    removedReason: p.removedReason,
    tags: p.tags,
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    soldCount: p.soldCount,
    publishedAt: p.publishedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    images: [...images]
      .sort((a, b) => a.sort - b.sort)
      .map((i) => ({
        id: i.id,
        url: i.url,
        publicId: i.publicId,
        sort: i.sort,
      })),
    variants: sortedVariants.map((v) => ({
      id: v.id,
      option1: v.option1,
      option2: v.option2,
      label: variantLabel(v),
      colorHex: v.colorHex,
      sku: v.sku,
      priceDelta: v.priceDelta,
      price: unitPrice(p, v),
      stock: v.stock,
      isActive: v.isActive,
      lowStock: v.isActive && v.stock <= LOW_STOCK_THRESHOLD,
    })),
    totalStock: variants
      .filter((v) => v.isActive)
      .reduce((n, v) => n + v.stock, 0),
  };
}

/** Normalised option key: case- and space-insensitive. */
const optionKey = (v: { option1?: string | null; option2?: string | null }) =>
  `${(v.option1 ?? '').trim().toLowerCase()}|${(v.option2 ?? '').trim().toLowerCase()}`;

/**
 * A store partner's catalogue. Every method is scoped by the caller's store
 * id — another store's product is "not found", never "forbidden".
 */
@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly media: MediaService,
    private readonly inventory: InventoryService,
  ) {}

  async list(storeId: string, q: PartnerProductQueryDto) {
    const params = new SqlParams();
    const where = [`p.store_id = ${params.add(storeId)}`];
    if (q.status) where.push(`p.status = ${params.add(q.status)}`);
    if (q.collectionId)
      where.push(`p.collection_id = ${params.add(q.collectionId)}`);
    if (q.q) where.push(`p.name ILIKE ${params.add(`%${likeEscape(q.q)}%`)}`);
    if (q.lowStock === 'true') {
      where.push(
        `EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.stock <= ${LOW_STOCK_THRESHOLD})`,
      );
    }
    const whereSql = where.join(' AND ');
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM products p WHERE ${whereSql}`,
      params.values,
    );
    const rows = await this.dataSource.query(
      `SELECT p.id, p.name, p.slug, p.status, p.base_price, p.sale_price, p.collection_id, p.category_id,
              p.sold_count, p.rating_avg, p.updated_at,
              (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.created_at LIMIT 1) AS cover_url,
              (SELECT count(*)::int FROM product_variants v WHERE v.product_id = p.id AND v.is_active) AS variant_count,
              (SELECT coalesce(sum(v.stock), 0)::int FROM product_variants v WHERE v.product_id = p.id AND v.is_active) AS total_stock,
              EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.stock <= ${LOW_STOCK_THRESHOLD}) AS low_stock
         FROM products p
        WHERE ${whereSql}
        ORDER BY p.updated_at DESC, p.id
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    return paged(
      rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        basePrice: r.base_price,
        salePrice: r.sale_price,
        price: r.sale_price ?? r.base_price,
        categoryId: r.category_id,
        collectionId: r.collection_id,
        coverUrl: r.cover_url,
        variantCount: r.variant_count,
        totalStock: r.total_stock,
        lowStock: r.low_stock,
        soldCount: r.sold_count,
        ratingAvg: parseFloat(r.rating_avg),
        updatedAt: r.updated_at,
      })),
      total,
      q,
    );
  }

  async get(
    storeId: string,
    id: string,
    m: EntityManager = this.dataSource.manager,
  ) {
    const product = await m.findOne(Product, { where: { id, storeId } });
    if (!product) throw notFound();
    const [images, variants] = await Promise.all([
      m.find(ProductImage, { where: { productId: id } }),
      m.find(ProductVariant, { where: { productId: id } }),
    ]);
    return partnerProductView(product, images, variants);
  }

  async create(storeId: string, ownerUserId: string, dto: CreateProductDto) {
    this.checkPrices(dto.basePrice, dto.salePrice ?? null);
    const variants: ProductVariantDto[] = dto.variants?.length
      ? dto.variants
      : [{ option1: null, option2: null, stock: 0 }];
    this.checkVariantSet(variants, dto.basePrice, dto.salePrice ?? null);
    const images = dto.images ?? [];
    this.checkImages(ownerUserId, images);
    const status = dto.status ?? 'draft';
    if (status === 'active')
      this.checkPublishable(
        images.length,
        variants.filter((v) => v.isActive !== false).length,
      );

    const id = await this.dataSource.transaction(async (m) => {
      await this.checkRefs(
        m,
        storeId,
        dto.categoryId,
        dto.collectionId ?? null,
      );
      const product = await m.save(
        m.create(Product, {
          storeId,
          categoryId: dto.categoryId,
          collectionId: dto.collectionId ?? null,
          name: dto.name,
          slug: await this.freeSlug(m, storeId, dto.name),
          description: dto.description,
          basePrice: dto.basePrice,
          salePrice: dto.salePrice ?? null,
          status,
          tags: this.cleanTags(dto.tags),
          publishedAt: status === 'active' ? new Date() : null,
        }),
      );
      await this.replaceImages(m, product.id, images);
      for (const [i, v] of variants.entries())
        await this.insertVariant(m, product.id, v, ownerUserId, i);
      return product.id;
    });
    return this.get(storeId, id);
  }

  async update(
    storeId: string,
    ownerUserId: string,
    id: string,
    dto: UpdateProductDto,
  ) {
    await this.dataSource.transaction(async (m) => {
      const product = await m.findOne(Product, {
        where: { id, storeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!product) throw notFound();
      if (product.status === 'removed' && dto.status !== undefined) {
        throw invalidTransition(
          'removed',
          dto.status,
          [],
          'This product was removed by MetroMatrix; ask support to restore it.',
        );
      }

      const basePrice = dto.basePrice ?? product.basePrice;
      const salePrice =
        dto.salePrice !== undefined ? dto.salePrice : product.salePrice;
      this.checkPrices(basePrice, salePrice);
      if (dto.categoryId !== undefined || dto.collectionId !== undefined) {
        await this.checkRefs(
          m,
          storeId,
          dto.categoryId ?? product.categoryId,
          dto.collectionId !== undefined
            ? dto.collectionId
            : product.collectionId,
        );
      }

      if (dto.images) {
        // New images must be the partner's own uploads; ones already on the
        // product (re-sent unchanged by an edit form) are kept as they are.
        const current = await m.find(ProductImage, {
          where: { productId: product.id },
        });
        const known = new Set(current.map((i) => i.url));
        this.checkImages(
          ownerUserId,
          dto.images.filter((i) => !known.has(i.url.trim())),
        );
        await this.replaceImages(m, product.id, dto.images);
      }
      if (dto.variants) {
        await this.syncVariants(
          m,
          product.id,
          dto.variants,
          ownerUserId,
          basePrice,
          salePrice,
        );
      } else if (dto.basePrice !== undefined || dto.salePrice !== undefined) {
        // A price change must still leave every variant a positive price.
        const existing = await m.find(ProductVariant, {
          where: { productId: product.id, isActive: true },
        });
        this.checkVariantSet(existing, basePrice, salePrice, false);
      }

      if (dto.name !== undefined && dto.name !== product.name) {
        product.name = dto.name;
        product.slug = await this.freeSlug(m, storeId, dto.name, product.id);
      }
      if (dto.description !== undefined) product.description = dto.description;
      if (dto.categoryId !== undefined) product.categoryId = dto.categoryId;
      if (dto.collectionId !== undefined)
        product.collectionId = dto.collectionId;
      if (dto.tags !== undefined) product.tags = this.cleanTags(dto.tags);
      product.basePrice = basePrice;
      product.salePrice = salePrice;

      if (dto.status !== undefined && dto.status !== product.status) {
        if (dto.status === 'active') {
          const [imageCount, activeVariants] = await Promise.all([
            m.count(ProductImage, { where: { productId: product.id } }),
            m.count(ProductVariant, {
              where: { productId: product.id, isActive: true },
            }),
          ]);
          this.checkPublishable(imageCount, activeVariants);
          product.publishedAt ??= new Date();
        }
        product.status = dto.status;
      }
      await m.save(product);
    });
    return this.get(storeId, id);
  }

  /** Archive a product that was ever ordered (orders keep pointing at it); delete otherwise. */
  async remove(
    storeId: string,
    id: string,
  ): Promise<{ archived: boolean; deleted: boolean }> {
    return this.dataSource.transaction(async (m) => {
      const product = await m.findOne(Product, { where: { id, storeId } });
      if (!product) throw notFound();
      if (await this.productHasOrders(m, id)) {
        if (product.status !== 'archived' && product.status !== 'removed') {
          await m.update(Product, { id }, { status: 'archived' });
        }
        return { archived: true, deleted: false };
      }
      await m.delete(Product, { id });
      return { archived: false, deleted: true };
    });
  }

  /** A draft copy: same details and images, variants at zero stock. */
  async duplicate(storeId: string, ownerUserId: string, id: string) {
    const src = await this.get(storeId, id);
    const newId = await this.dataSource.transaction(async (m) => {
      const name = `${src.name} (copy)`.slice(0, 140);
      const product = await m.save(
        m.create(Product, {
          storeId,
          categoryId: src.categoryId,
          collectionId: src.collectionId,
          name,
          slug: await this.freeSlug(m, storeId, name),
          description: src.description,
          basePrice: src.basePrice,
          salePrice: src.salePrice,
          status: 'draft' as ProductStatus,
          tags: src.tags,
          publishedAt: null,
        }),
      );
      await this.replaceImages(m, product.id, src.images);
      for (const [i, v] of src.variants.entries()) {
        await this.insertVariant(
          m,
          product.id,
          {
            option1: v.option1,
            option2: v.option2,
            colorHex: v.colorHex,
            sku: null,
            priceDelta: v.priceDelta,
            stock: 0,
            isActive: v.isActive,
          },
          ownerUserId,
          i,
        );
      }
      return product.id;
    });
    return this.get(storeId, newId);
  }

  // ── rules ─────────────────────────────────────────────────────────────────

  private checkPrices(basePrice: number, salePrice: number | null) {
    if (salePrice !== null && salePrice >= basePrice) {
      throw invalid(
        'salePrice',
        'The sale price must be lower than the regular price.',
      );
    }
  }

  /** Unique option combinations, and every variant must cost more than 0. */
  private checkVariantSet(
    variants: Array<
      Pick<ProductVariantDto, 'option1' | 'option2' | 'priceDelta' | 'isActive'>
    >,
    basePrice: number,
    salePrice: number | null,
    checkDuplicates = true,
  ) {
    if (checkDuplicates) {
      const keys = variants.map(optionKey);
      if (new Set(keys).size !== keys.length) {
        throw invalid('variants', 'Two variants have the same options.');
      }
    }
    for (const v of variants) {
      if (
        unitPrice(
          { basePrice, salePrice },
          { priceDelta: v.priceDelta ?? 0 },
        ) <= 0
      ) {
        throw invalid(
          'variants',
          'Every variant must cost more than Rs 0 after its price adjustment.',
        );
      }
    }
  }

  private checkPublishable(images: number, activeVariants: number) {
    if (images < 1)
      throw invalid('images', 'Add at least one photo before publishing.');
    if (activeVariants < 1)
      throw invalid('variants', 'Keep at least one variant active to publish.');
  }

  private checkImages(ownerUserId: string, images: ProductImageDto[]) {
    images.forEach((img, i) =>
      this.media.assertOwnedAsset(
        ownerUserId,
        'product_image',
        img.url,
        img.publicId,
        `images.${i}`,
      ),
    );
  }

  private async checkRefs(
    m: EntityManager,
    storeId: string,
    categoryId: string,
    collectionId: string | null,
  ) {
    const category = await m.findOne(ShopCategory, {
      where: { id: categoryId, isActive: true },
    });
    if (!category)
      throw invalid('categoryId', 'Choose one of the MetroMatrix categories.');
    if (collectionId) {
      const owned = await m.exists(StoreCollection, {
        where: { id: collectionId, storeId },
      });
      if (!owned) throw notFound('Collection');
    }
  }

  private cleanTags(tags?: string[]): string[] {
    return [
      ...new Set(
        (tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      ),
    ];
  }

  private async freeSlug(
    m: EntityManager,
    storeId: string,
    name: string,
    exceptId?: string,
  ): Promise<string> {
    const base = slugify(name);
    const taken = await m.findOne(Product, {
      where: { storeId, slug: base },
      select: { id: true },
    });
    if (!taken || taken.id === exceptId) return base;
    return `${base}-${randomBytes(2).toString('hex')}`;
  }

  private async replaceImages(
    m: EntityManager,
    productId: string,
    images: Array<{ url: string; publicId: string }>,
  ) {
    await m.delete(ProductImage, { productId });
    if (images.length) {
      await m.insert(
        ProductImage,
        images.map((img, i) => ({
          productId,
          url: img.url.trim(),
          publicId: img.publicId.trim(),
          sort: i,
        })),
      );
    }
  }

  private async insertVariant(
    m: EntityManager,
    productId: string,
    v: ProductVariantDto,
    actorUserId: string,
    sort: number,
  ) {
    const saved = await m.save(
      m.create(ProductVariant, {
        productId,
        option1: v.option1?.trim() || null,
        option2: v.option2?.trim() || null,
        colorHex: v.colorHex?.toUpperCase() ?? null,
        sku: v.sku ?? null,
        priceDelta: v.priceDelta ?? 0,
        stock: v.stock ?? 0,
        isActive: v.isActive ?? true,
        sort,
      }),
    );
    if (saved.stock > 0) {
      await m.insert(InventoryMovement, {
        variantId: saved.id,
        delta: saved.stock,
        reason: 'manual',
        refType: 'product',
        refId: productId,
        actorUserId,
        balanceAfter: saved.stock,
      });
    }
    return saved;
  }

  /**
   * `wanted` is the full set, in display order. With an id → update; without
   * → add (or revive an inactive variant with the same options); missing →
   * deactivated, never deleted (past orders and movements keep pointing at
   * it). Stock changes go through InventoryService as manual movements.
   */
  private async syncVariants(
    m: EntityManager,
    productId: string,
    wanted: ProductVariantDto[],
    actorUserId: string,
    basePrice: number,
    salePrice: number | null,
  ) {
    const existing = await m.find(ProductVariant, { where: { productId } });
    const byId = new Map(existing.map((v) => [v.id, v]));
    const byKey = new Map(existing.map((v) => [optionKey(v), v]));

    // Resolve each entry to its row and its final field values first, so the
    // rules run on what the variant set will actually be.
    const plan = wanted.map((w) => {
      const target = w.id ? byId.get(w.id) : byKey.get(optionKey(w));
      if (w.id && !target) throw notFound('Variant');
      const pick = <K extends keyof ProductVariantDto>(
        k: K,
        fallback: ProductVariantDto[K],
      ) => (w[k] !== undefined ? w[k] : fallback);
      return {
        target,
        final: {
          option1: pick('option1', target?.option1 ?? null)?.trim() || null,
          option2: pick('option2', target?.option2 ?? null)?.trim() || null,
          colorHex:
            pick('colorHex', target?.colorHex ?? null)?.toUpperCase() ?? null,
          sku: pick('sku', target?.sku ?? null),
          priceDelta: pick('priceDelta', target?.priceDelta ?? 0) ?? 0,
          isActive: w.isActive ?? true,
          stock: w.stock,
        },
      };
    });
    this.checkVariantSet(
      plan.map((p) => p.final),
      basePrice,
      salePrice,
    );
    const keep = new Set(plan.flatMap((p) => (p.target ? [p.target.id] : [])));
    const finalKeys = new Set(plan.map((p) => optionKey(p.final)));
    const clash = existing.find(
      (v) => !keep.has(v.id) && finalKeys.has(optionKey(v)),
    );
    if (clash) {
      throw invalid(
        'variants',
        `A removed variant already uses "${variantLabel(clash)}"; add it back instead of renaming another variant to it.`,
      );
    }

    const stockChanges: StockChange[] = [];
    for (const [sort, { target, final }] of plan.entries()) {
      if (!target) {
        const created = await this.insertVariant(
          m,
          productId,
          final,
          actorUserId,
          sort,
        );
        keep.add(created.id);
        continue;
      }
      // Everything but stock is written here; stock goes through the locked
      // inventory path so a checkout running at the same moment is never
      // overwritten by a stale read.
      const { stock, ...fields } = final;
      await m.update(ProductVariant, { id: target.id }, { ...fields, sort });
      if (stock !== undefined && stock !== target.stock) {
        stockChanges.push({ variantId: target.id, setTo: stock });
      }
    }
    if (stockChanges.length) {
      await this.inventory.apply(m, stockChanges, {
        reason: 'manual',
        refType: 'product',
        refId: productId,
        actorUserId,
      });
    }
    const dropped = existing
      .filter((v) => !keep.has(v.id) && v.isActive)
      .map((v) => v.id);
    if (dropped.length)
      await m.update(ProductVariant, { id: In(dropped) }, { isActive: false });
  }

  /** Was this product ever ordered? Then it is archived, never deleted (order lines point at it). */
  private async productHasOrders(
    m: EntityManager,
    productId: string,
  ): Promise<boolean> {
    const [row] = await m.query(
      `SELECT 1 FROM store_order_items WHERE product_id = $1 LIMIT 1`,
      [productId],
    );
    return !!row;
  }

  /** For checkout/admin: a store's product, or throw. */
  async assertOwned(storeId: string, id: string) {
    const exists = await this.products.exists({ where: { id, storeId } });
    if (!exists) throw notFound();
  }
}
