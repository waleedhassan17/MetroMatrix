import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShopCategory } from '../catalog/entities/shop-category.entity';
import { ShopBanner } from '../catalog/entities/shop-banner.entity';
import { Store } from '../stores/entities/store.entity';
import { Product } from '../products/entities/product.entity';
import { ProductImage } from '../products/entities/product-image.entity';
import { ProductVariant } from '../products/entities/product-variant.entity';
import { ProductReport } from '../reports/entities/product-report.entity';
import { StoreOrder } from '../orders/entities/store-order.entity';
import { ReviewsService } from '../reviews/reviews.service';
import {
  AdminOrderQueryDto,
  AdminReportQueryDto,
  CreateBannerDto,
  CreateCategoryDto,
  UpdateBannerDto,
  UpdateCategoryDto,
} from './dto/admin-shop.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { slugify } from '../../businesses/businesses.service';
import { MediaService } from '../../media/media.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SqlParams, likeEscape } from '../common/catalog-sql';
import { invalidTransition } from '../common/transitions';

const notFound = (what: string) =>
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

const categoryView = (c: ShopCategory) => ({
  id: c.id,
  parentId: c.parentId,
  name: c.name,
  slug: c.slug,
  icon: c.icon,
  sort: c.sort,
  isActive: c.isActive,
});

const bannerView = (b: ShopBanner) => ({
  id: b.id,
  imageUrl: b.imageUrl,
  title: b.title,
  subtitle: b.subtitle,
  targetType: b.targetType,
  targetId: b.targetId,
  startsAt: b.startsAt,
  endsAt: b.endsAt,
  sort: b.sort,
  isActive: b.isActive,
});

/**
 * MetroMatrix staff tools for Shopping. Every write is recorded in the
 * operational audit log; moderation that affects a store (product removal)
 * notifies it.
 */
@Injectable()
export class AdminShopService {
  private readonly logger = new Logger(AdminShopService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: OperationalAuditService,
    private readonly reviews: ReviewsService,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Categories ────────────────────────────────────────────────────────────

  async categories() {
    const rows = await this.dataSource.manager.find(ShopCategory, {
      order: { sort: 'ASC', name: 'ASC' },
    });
    const roots = rows.filter((r) => !r.parentId);
    return roots.map((r) => ({
      ...categoryView(r),
      children: rows.filter((c) => c.parentId === r.id).map(categoryView),
    }));
  }

  async createCategory(dto: CreateCategoryDto) {
    const m = this.dataSource.manager;
    if (dto.parentId) await this.checkParent(dto.parentId, null);
    const slug = dto.slug ?? slugify(dto.name);
    if (await m.exists(ShopCategory, { where: { slug } }))
      throw this.slugTaken();
    const saved = await m.save(
      m.create(ShopCategory, {
        name: dto.name,
        slug,
        parentId: dto.parentId ?? null,
        icon: dto.icon ?? null,
        sort: dto.sort ?? 0,
      }),
    );
    await this.audit.record({
      action: 'shop.category.create',
      targetType: 'shop_category',
      targetId: saved.id,
      details: { slug },
    });
    return categoryView(saved);
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const m = this.dataSource.manager;
    const c = await m.findOne(ShopCategory, { where: { id } });
    if (!c) throw notFound('Category');
    if (dto.parentId !== undefined && dto.parentId !== null)
      await this.checkParent(dto.parentId, id);
    if (
      dto.parentId &&
      (await m.exists(ShopCategory, { where: { parentId: id } }))
    ) {
      throw invalid(
        'parentId',
        'A category with children must stay a top-level category.',
      );
    }
    if (
      dto.slug &&
      dto.slug !== c.slug &&
      (await m.exists(ShopCategory, { where: { slug: dto.slug } }))
    ) {
      throw this.slugTaken();
    }
    Object.assign(c, {
      name: dto.name ?? c.name,
      slug: dto.slug ?? c.slug,
      parentId: dto.parentId !== undefined ? dto.parentId : c.parentId,
      icon: dto.icon ?? c.icon,
      sort: dto.sort ?? c.sort,
      isActive: dto.isActive ?? c.isActive,
    });
    await m.save(c);
    await this.audit.record({
      action: 'shop.category.update',
      targetType: 'shop_category',
      targetId: id,
      details: { ...dto },
    });
    return categoryView(c);
  }

  /** Only an unused leaf can be deleted; anything in use is deactivated instead. */
  async deleteCategory(id: string) {
    const m = this.dataSource.manager;
    const c = await m.findOne(ShopCategory, { where: { id } });
    if (!c) throw notFound('Category');
    const [children, products] = await Promise.all([
      m.count(ShopCategory, { where: { parentId: id } }),
      m.count(Product, { where: { categoryId: id } }),
    ]);
    if (children || products) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: 'This category is in use — deactivate it instead.',
        details: { children, products },
      });
    }
    await m.delete(ShopCategory, { id });
    await this.audit.record({
      action: 'shop.category.delete',
      targetType: 'shop_category',
      targetId: id,
      details: { slug: c.slug },
    });
    return { deleted: true };
  }

  private async checkParent(parentId: string, selfId: string | null) {
    if (parentId === selfId)
      throw invalid('parentId', 'A category cannot be its own parent.');
    const parent = await this.dataSource.manager.findOne(ShopCategory, {
      where: { id: parentId },
    });
    if (!parent) throw invalid('parentId', 'Parent category not found.');
    if (parent.parentId)
      throw invalid(
        'parentId',
        'Categories are two levels deep: choose a top-level parent.',
      );
  }

  private slugTaken() {
    return new ConflictException({
      code: ErrorCode.CONFLICT,
      message: 'Another category already uses this slug.',
      details: { fields: { slug: ['already used'] } },
    });
  }

  // ── Banners ───────────────────────────────────────────────────────────────

  async banners() {
    const rows = await this.dataSource.manager.find(ShopBanner, {
      order: { sort: 'ASC', createdAt: 'DESC' },
    });
    return rows.map(bannerView);
  }

  async createBanner(adminId: string, dto: CreateBannerDto) {
    this.media.assertOwnedAsset(
      adminId,
      'banner',
      dto.imageUrl,
      undefined,
      'imageUrl',
    );
    const window = this.window(dto.startsAt ?? null, dto.endsAt ?? null);
    await this.checkTarget(dto.targetType, dto.targetId ?? null);
    const m = this.dataSource.manager;
    const saved = await m.save(
      m.create(ShopBanner, {
        imageUrl: dto.imageUrl,
        title: dto.title,
        subtitle: dto.subtitle ?? null,
        targetType: dto.targetType,
        targetId: dto.targetType === 'none' ? null : dto.targetId!,
        ...window,
        sort: dto.sort ?? 0,
        isActive: dto.isActive ?? true,
      }),
    );
    await this.audit.record({
      action: 'shop.banner.create',
      targetType: 'shop_banner',
      targetId: saved.id,
      details: { title: dto.title },
    });
    return bannerView(saved);
  }

  async updateBanner(adminId: string, id: string, dto: UpdateBannerDto) {
    const m = this.dataSource.manager;
    const b = await m.findOne(ShopBanner, { where: { id } });
    if (!b) throw notFound('Banner');
    if (dto.imageUrl !== undefined)
      this.media.assertOwnedAsset(
        adminId,
        'banner',
        dto.imageUrl,
        undefined,
        'imageUrl',
      );
    const targetType = dto.targetType ?? b.targetType;
    const targetId = dto.targetId !== undefined ? dto.targetId : b.targetId;
    if (dto.targetType !== undefined || dto.targetId !== undefined)
      await this.checkTarget(targetType, targetId);
    const window = this.window(
      dto.startsAt !== undefined
        ? dto.startsAt
        : (b.startsAt?.toISOString() ?? null),
      dto.endsAt !== undefined ? dto.endsAt : (b.endsAt?.toISOString() ?? null),
    );
    Object.assign(b, {
      imageUrl: dto.imageUrl ?? b.imageUrl,
      title: dto.title ?? b.title,
      subtitle: dto.subtitle !== undefined ? dto.subtitle : b.subtitle,
      targetType,
      targetId: targetType === 'none' ? null : targetId,
      ...window,
      sort: dto.sort ?? b.sort,
      isActive: dto.isActive ?? b.isActive,
    });
    await m.save(b);
    await this.audit.record({
      action: 'shop.banner.update',
      targetType: 'shop_banner',
      targetId: id,
      details: { ...dto },
    });
    return bannerView(b);
  }

  async deleteBanner(id: string) {
    const res = await this.dataSource.manager.delete(ShopBanner, { id });
    if (!res.affected) throw notFound('Banner');
    await this.audit.record({
      action: 'shop.banner.delete',
      targetType: 'shop_banner',
      targetId: id,
    });
    return { deleted: true };
  }

  private window(startsAt: string | null, endsAt: string | null) {
    const s = startsAt ? new Date(startsAt) : null;
    const e = endsAt ? new Date(endsAt) : null;
    if (s && e && e <= s)
      throw invalid('endsAt', 'The end must be after the start.');
    return { startsAt: s, endsAt: e };
  }

  private async checkTarget(type: string, id: string | null) {
    if (type === 'none') return;
    if (!id) throw invalid('targetId', 'Choose what the banner opens.');
    const table = {
      store: 'stores',
      category: 'shop_categories',
      collection: 'store_collections',
      product: 'products',
    }[type];
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM ${table} WHERE id = $1`,
      [id],
    );
    if (!row) throw invalid('targetId', `That ${type} does not exist.`);
  }

  // ── Stores ────────────────────────────────────────────────────────────────

  async setFeatured(id: string, featured: boolean) {
    const res = await this.dataSource.manager.update(
      Store,
      { id },
      { isFeatured: featured },
    );
    if (!res.affected) throw notFound('Store');
    await this.audit.record({
      action: featured ? 'shop.store.feature' : 'shop.store.unfeature',
      targetType: 'store',
      targetId: id,
    });
    return { id, isFeatured: featured };
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  async reports(q: AdminReportQueryDto) {
    const status = q.status ?? 'open';
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM product_reports WHERE status = $1`,
      [status],
    );
    const rows = await this.dataSource.query(
      `SELECT r.id, r.reason, r.details, r.status, r.created_at, r.resolved_at, r.resolution_note,
              p.id AS product_id, p.name AS product_name, p.status AS product_status,
              s.id AS store_id, b.name AS store_name,
              (SELECT count(*)::int FROM product_reports x WHERE x.product_id = p.id AND x.status = 'open') AS open_reports_on_product
         FROM product_reports r
         JOIN products p ON p.id = r.product_id
         JOIN stores s ON s.id = p.store_id JOIN businesses b ON b.id = s.business_id
        WHERE r.status = $1
        ORDER BY r.created_at ASC, r.id
        LIMIT $2 OFFSET $3`,
      [status, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return paged(
      rows.map((r: any) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
        resolutionNote: r.resolution_note,
        openReportsOnProduct: r.open_reports_on_product,
        product: {
          id: r.product_id,
          name: r.product_name,
          status: r.product_status,
        },
        store: { id: r.store_id, name: r.store_name },
      })),
      total,
      q,
    );
  }

  async dismissReport(adminId: string, id: string, note: string | null) {
    const res = await this.dataSource.manager.update(
      ProductReport,
      { id, status: 'open' },
      {
        status: 'dismissed',
        resolvedAt: new Date(),
        resolvedBy: adminId,
        resolutionNote: note,
      },
    );
    if (!res.affected) {
      const exists = await this.dataSource.manager.exists(ProductReport, {
        where: { id },
      });
      if (!exists) throw notFound('Report');
      throw invalidTransition(
        'resolved',
        'dismissed',
        [],
        'This report is already resolved.',
      );
    }
    await this.audit.record({
      action: 'shop.report.dismiss',
      targetType: 'product_report',
      targetId: id,
      details: { note },
    });
    return { id, status: 'dismissed' };
  }

  // ── Products ──────────────────────────────────────────────────────────────

  /** Hide a product everywhere (status `removed`); orders keep their snapshots. */
  async removeProduct(adminId: string, id: string, reason: string) {
    const { product, ownerId } = await this.dataSource.transaction(
      async (m) => {
        const product = await m.findOne(Product, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!product) throw notFound('Product');
        if (product.status === 'removed') {
          throw invalidTransition(
            'removed',
            'removed',
            ['active', 'draft'],
            'This product is already removed.',
          );
        }
        await m.update(
          Product,
          { id },
          { status: 'removed', removedReason: reason },
        );
        await m.update(
          ProductReport,
          { productId: id, status: 'open' },
          {
            status: 'actioned',
            resolvedAt: new Date(),
            resolvedBy: adminId,
            resolutionNote: reason,
          },
        );
        const [owner] = await m.query(
          `SELECT b.owner_user_id FROM stores s JOIN businesses b ON b.id = s.business_id WHERE s.id = $1`,
          [product.storeId],
        );
        return { product, ownerId: owner.owner_user_id as string };
      },
    );
    await this.audit.record({
      action: 'shop.product.remove',
      targetType: 'product',
      targetId: id,
      details: { reason, from: product.status },
    });
    try {
      await this.notifications.notify(ownerId, {
        type: 'shop.product.removed',
        title: `"${product.name}" was removed`,
        body: `MetroMatrix removed this product: ${reason}`,
        data: { productId: id },
      });
    } catch (err) {
      this.logger.warn(`notification failed: ${(err as Error).message}`);
    }
    return { id, status: 'removed', removedReason: reason };
  }

  /** Back to `active` — or `draft` if it no longer meets the publishing rules. */
  async restoreProduct(id: string) {
    const m = this.dataSource.manager;
    const product = await m.findOne(Product, { where: { id } });
    if (!product) throw notFound('Product');
    if (product.status !== 'removed') {
      throw invalidTransition(
        product.status,
        'active',
        [],
        'Only a removed product can be restored.',
      );
    }
    const [images, variants] = await Promise.all([
      m.count(ProductImage, { where: { productId: id } }),
      m.count(ProductVariant, { where: { productId: id, isActive: true } }),
    ]);
    const status = images && variants ? 'active' : 'draft';
    await m.update(
      Product,
      { id },
      {
        status,
        removedReason: null,
        publishedAt: product.publishedAt ?? new Date(),
      },
    );
    await this.audit.record({
      action: 'shop.product.restore',
      targetType: 'product',
      targetId: id,
      details: { status },
    });
    return { id, status };
  }

  // ── Orders (read-only) ────────────────────────────────────────────────────

  /** Dispute lookup by code, store or status. Read-only: admins never edit orders. */
  async orders(q: AdminOrderQueryDto) {
    const params = new SqlParams();
    const where: string[] = ['TRUE'];
    if (q.code)
      where.push(
        `so.code ILIKE ${params.add(`${likeEscape(q.code.toUpperCase())}%`)}`,
      );
    if (q.storeId) where.push(`so.store_id = ${params.add(q.storeId)}`);
    if (q.status) where.push(`so.status = ${params.add(q.status)}`);
    const whereSql = where.join(' AND ');
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM store_orders so WHERE ${whereSql}`,
      params.values,
    );
    const rows = await this.dataSource.query(
      `SELECT so.id, so.code, so.status, so.payment_method, so.payment_status, so.total, so.created_at,
              so.cancel_reason, so.cancelled_by, b.name AS store_name, so.store_id,
              g.code AS group_code, g.address_snapshot->>'fullName' AS customer_name,
              g.address_snapshot->>'city' AS city
         FROM store_orders so
         JOIN order_groups g ON g.id = so.group_id
         JOIN stores s ON s.id = so.store_id JOIN businesses b ON b.id = s.business_id
        WHERE ${whereSql}
        ORDER BY so.created_at DESC, so.id
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    return paged(
      rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        groupCode: r.group_code,
        status: r.status,
        paymentMethod: r.payment_method,
        paymentStatus: r.payment_status,
        total: r.total,
        store: { id: r.store_id, name: r.store_name },
        customerName: r.customer_name,
        city: r.city,
        cancelReason: r.cancel_reason,
        cancelledBy: r.cancelled_by,
        placedAt: r.created_at,
      })),
      total,
      q,
    );
  }

  async order(id: string) {
    const o = await this.dataSource.manager.findOne(StoreOrder, {
      where: { id },
    });
    if (!o) throw notFound('Order');
    const [items, events] = await Promise.all([
      this.dataSource.query(
        `SELECT id, product_name, variant_label, unit_price, quantity, line_total, returned_qty
           FROM store_order_items WHERE store_order_id = $1 ORDER BY line_no, id`,
        [id],
      ),
      this.dataSource.query(
        `SELECT kind, from_state AS "from", to_state AS "to", actor_role AS "actorRole", note, at
           FROM store_order_events WHERE store_order_id = $1 ORDER BY at, id`,
        [id],
      ),
    ]);
    return {
      id: o.id,
      code: o.code,
      storeId: o.storeId,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      subtotal: o.subtotal,
      discount: o.discount,
      shippingFee: o.shippingFee,
      total: o.total,
      paymentRef: o.paymentRef,
      paymentProofUrl: o.paymentProofUrl,
      cancelReason: o.cancelReason,
      cancelledBy: o.cancelledBy,
      items: items.map((i: any) => ({
        id: i.id,
        productName: i.product_name,
        variantLabel: i.variant_label,
        unitPrice: i.unit_price,
        quantity: i.quantity,
        lineTotal: i.line_total,
        returnedQty: i.returned_qty,
      })),
      events,
      placedAt: o.createdAt,
    };
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  async hideReview(id: string, reason: string) {
    const r = await this.reviews.setHidden(id, true, reason);
    await this.audit.record({
      action: 'shop.review.hide',
      targetType: 'product_review',
      targetId: id,
      details: { reason },
    });
    return { id: r.id, isHidden: true, hiddenReason: reason };
  }

  async unhideReview(id: string) {
    const r = await this.reviews.setHidden(id, false, null);
    await this.audit.record({
      action: 'shop.review.unhide',
      targetType: 'product_review',
      targetId: id,
    });
    return { id: r.id, isHidden: false };
  }
}
