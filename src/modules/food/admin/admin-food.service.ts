import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminService } from '../../admin/admin.service';
import { BusinessesService } from '../../businesses/businesses.service';
import { SUB_TYPE_LABELS, SubType } from '../../businesses/business-types';
import { PlanService } from '../../plans/plans.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../../common/errors/codes';
import { likeEscape, paged } from '../../../common/pagination/pagination';
import {
  OperationalAuditService,
  snapshot,
} from '../../../common/audit/operational-audit.service';

const CUISINE_FIELDS: (keyof Cuisine & string)[] = [
  'slug',
  'name',
  'icon',
  'sort',
  'isActive',
];
import { todayIn } from '../../../common/time/time.util';
import { Cuisine } from '../reference/entities/cuisine.entity';
import { FoodOrder } from '../orders/entities/food-order.entity';
import { FoodOrderViewsService } from '../orders/food-order-views.service';
import { FoodNotifier } from '../orders/food-notifier.service';
import { ACTIVE_STATUSES } from '../orders/food-order-status';
import { FoodVendorService } from '../vendor/food-vendor.service';
import { VendorSettingsService } from '../vendor/vendor-settings.service';
import { VendorSetupService } from '../vendor/vendor-setup.service';
import { FoodReviewsService } from '../reviews/food-reviews.service';
import { VISIBLE_VENDOR_SQL } from '../discovery/discovery.service';
import {
  AdminFoodOrdersQueryDto,
  AdminFoodVendorsQueryDto,
  CuisineDto,
  UpdateCuisineDto,
} from './dto/admin-food.dto';

const PKT = 'Asia/Karachi';
const ACTIVE = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ');

/**
 * MetroMatrix staff on Food Court: the overview, vendors (feature, suspend,
 * reinstate — the same business suspension as everywhere, plus telling the
 * customers with active orders), orders for dispute lookups (read-only),
 * and cuisines. Every write is audited.
 */
@Injectable()
export class AdminFoodService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly admin: AdminService,
    private readonly businesses: BusinessesService,
    private readonly plans: PlanService,
    private readonly vendors: FoodVendorService,
    private readonly settings: VendorSettingsService,
    private readonly setup: VendorSetupService,
    private readonly reviews: FoodReviewsService,
    private readonly views: FoodOrderViewsService,
    private readonly notifier: FoodNotifier,
    private readonly audit: OperationalAuditService,
  ) {}

  onModuleInit(): void {
    this.businesses.onStatusChanged(async (business, change) => {
      if (business.serviceType !== 'food' || change.to !== 'suspended') return;
      await this.tellActiveCustomers(business.id);
    });
  }

  /** A suspended vendor's customers mid-order hear about it straight away. */
  private async tellActiveCustomers(businessId: string) {
    const rows = await this.dataSource.query(
      `SELECT o.id, o.code, o.user_id, fb.name FROM food_orders o JOIN food_brands fb ON fb.id = o.brand_id
        WHERE fb.business_id = $1 AND o.status IN (${ACTIVE})`,
      [businessId],
    );
    await this.notifier.send(
      rows.map((r: any) => ({
        userId: r.user_id,
        payload: {
          type: 'food.vendor.suspended',
          title: `${r.name} is unavailable`,
          body: `${r.name} has been suspended on Food Court. Your order ${r.code} may not be completed — please contact them.`,
          data: { orderId: r.id, code: r.code, screen: 'food.order' },
        },
      })),
    );
  }

  // ── overview ──────────────────────────────────────────────────────────────

  async overview(now = new Date()) {
    const today = todayIn(PKT, now);
    const vendors = await this.dataSource.query(
      `SELECT b.sub_type, count(*)::int AS n FROM food_brands fb JOIN branches br ON br.brand_id = fb.id
         JOIN businesses b ON b.id = fb.business_id WHERE ${VISIBLE_VENDOR_SQL} GROUP BY b.sub_type`,
    );
    const [o] = await this.dataSource.query(
      `SELECT count(*)::int AS orders,
              count(*) FILTER (WHERE accepted_at IS NOT NULL)::int AS accepted,
              count(*) FILTER (WHERE accepted_at IS NOT NULL OR status IN ('rejected', 'auto_rejected'))::int AS answered,
              count(*) FILTER (WHERE status = 'auto_rejected')::int AS auto_rejected,
              count(*) FILTER (WHERE status IN (${ACTIVE}))::int AS active
         FROM food_orders WHERE (created_at AT TIME ZONE $1)::date = $2::date`,
      [PKT, today],
    );
    const cuisines = await this.dataSource.query(
      `SELECT c.slug, c.name, count(o.id)::int AS orders
         FROM food_orders o JOIN food_brands fb ON fb.id = o.brand_id
         JOIN cuisines c ON c.id = ANY(fb.cuisine_ids)
        WHERE o.created_at > $1::timestamptz - interval '7 days'
        GROUP BY c.slug, c.name ORDER BY orders DESC, c.name LIMIT 5`,
      [now],
    );
    const [pending] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE b.status = 'pending_approval')::int AS approvals,
              count(*) FILTER (WHERE b.status = 'approved' AND b.sub_type = 'home_kitchen'
                                 AND br.food_safety_checked_at IS NULL)::int AS safety_checks
         FROM businesses b LEFT JOIN branches br ON br.business_id = b.id
        WHERE b.service_type = 'food'`,
    );
    const by = (t: string) =>
      vendors.find((v: any) => v.sub_type === t)?.n ?? 0;
    return {
      date: today,
      activeVendors: {
        restaurant: by('restaurant'),
        cloud_kitchen: by('cloud_kitchen'),
        home_kitchen: by('home_kitchen'),
        total: vendors.reduce((s: number, v: any) => s + v.n, 0),
      },
      ordersToday: o.orders,
      activeOrders: o.active,
      acceptanceRateToday: o.answered
        ? Math.round((o.accepted / o.answered) * 1000) / 1000
        : null,
      autoRejectsToday: o.auto_rejected,
      topCuisines: cuisines.map((c: any) => ({
        slug: c.slug,
        name: c.name,
        orders: c.orders,
      })),
      waiting: {
        approvals: pending.approvals,
        foodSafetyChecks: pending.safety_checks,
      },
    };
  }

  // ── vendors ───────────────────────────────────────────────────────────────

  async listVendors(q: AdminFoodVendorsQueryDto) {
    const where: string[] = [`b.service_type = 'food'`];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.type) where.push(`b.sub_type = ${p(q.type)}`);
    if (q.status === 'live')
      where.push(
        `b.status = 'approved' AND br.status = 'active' AND NOT br.is_paused`,
      );
    if (q.status === 'draft')
      where.push(`b.status = 'approved' AND br.status = 'draft'`);
    if (q.status === 'paused')
      where.push(`b.status = 'approved' AND br.is_paused`);
    if (q.status === 'suspended') where.push(`b.status = 'suspended'`);
    if (q.city) where.push(`lower(br.city) = lower(${p(q.city)})`);
    if (q.q) {
      const like = p(`%${likeEscape(q.q)}%`);
      where.push(
        `(fb.name ILIKE ${like} OR fb.slug ILIKE ${like} OR u.email ILIKE ${like})`,
      );
    }
    const from = `FROM food_brands fb JOIN branches br ON br.brand_id = fb.id
      JOIN businesses b ON b.id = fb.business_id JOIN users u ON u.id = b.owner_user_id
      WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total ${from}`,
      params,
    );
    const rows = await this.dataSource.query(
      `SELECT fb.id, fb.business_id, fb.name, fb.slug, fb.is_featured, fb.rating_avg, fb.rating_count,
              b.sub_type, b.status AS business_status, br.status AS branch_status, br.is_paused, br.city,
              br.went_live_at, br.food_safety_checked_at, u.email AS owner_email, bp.plan_key,
              (SELECT count(*)::int FROM food_orders o WHERE o.brand_id = fb.id
                 AND o.created_at > now() - interval '30 days') AS orders_30d
         ${from.replace('WHERE', 'LEFT JOIN business_plans bp ON bp.business_id = b.id WHERE')}
        ORDER BY fb.created_at DESC, fb.id
        LIMIT ${p(q.pageSize)} OFFSET ${p((q.page - 1) * q.pageSize)}`,
      params,
    );
    return paged(
      rows.map((r: any) => ({
        id: r.id,
        businessId: r.business_id,
        name: r.name,
        slug: r.slug,
        subType: r.sub_type,
        subTypeLabel: SUB_TYPE_LABELS[r.sub_type as SubType] ?? r.sub_type,
        city: r.city,
        businessStatus: r.business_status,
        branchStatus: r.branch_status,
        isPaused: r.is_paused,
        isFeatured: r.is_featured,
        ratingAvg: parseFloat(r.rating_avg),
        ratingCount: r.rating_count,
        orders30d: r.orders_30d,
        wentLiveAt: r.went_live_at,
        foodSafetyCheckedAt: r.food_safety_checked_at,
        ownerEmail: r.owner_email,
        planKey: r.plan_key ?? 'community',
      })),
      total,
      q,
    );
  }

  /** Everything staff need on one vendor; the menu is read-only here. */
  async vendor(id: string) {
    const v = await this.vendors.byBrandId(id);
    const [business] = await this.dataSource.query(
      `SELECT b.status, b.suspension_reason, u.email FROM businesses b JOIN users u ON u.id = b.owner_user_id WHERE b.id = $1`,
      [v.businessId],
    );
    const menu = await this.dataSource.query(
      `SELECT c.id, c.name, c.is_active,
              coalesce(json_agg(json_build_object('id', i.id, 'name', i.name, 'basePrice', i.base_price,
                         'isActive', i.is_active) ORDER BY i.sort, i.name) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
         FROM menu_categories c LEFT JOIN menu_items i ON i.category_id = c.id
        WHERE c.brand_id = $1 GROUP BY c.id ORDER BY c.sort, c.name`,
      [v.brandId],
    );
    const recent = await this.dataSource.manager.find(FoodOrder, {
      where: { brandId: v.brandId },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    return {
      id: v.brandId,
      businessId: v.businessId,
      subType: v.subType,
      subTypeLabel: SUB_TYPE_LABELS[v.subType],
      businessStatus: business.status,
      suspensionReason: business.suspension_reason,
      ownerEmail: business.email,
      profile: await this.settings.profile(v),
      settings: await this.settings.settings(v),
      hours: await this.settings.hours(v),
      feeBands: await this.settings.feeBands(v),
      setup: await this.setup.setup(v),
      plan: await this.plans.view(v.businessId),
      menu: menu.map((c: any) => ({
        id: c.id,
        name: c.name,
        isActive: c.is_active,
        items: c.items,
      })),
      recentOrders: await this.views.boardCards(recent),
      ratings: await this.reviews.summary(v.brandId),
      complaints: (
        await this.reviews.adminList({
          vendorId: v.brandId,
          maxRating: 2,
          page: 1,
          pageSize: 10,
        } as never)
      ).items,
    };
  }

  async setFeatured(id: string, featured: boolean) {
    const v = await this.vendors.byBrandId(id);
    const [was] = (await this.dataSource.query(
      `SELECT is_featured AS "isFeatured" FROM food_brands WHERE id = $1`,
      [v.brandId],
    )) as Array<{ isFeatured: boolean }>;
    await this.dataSource.query(
      `UPDATE food_brands SET is_featured = $2, updated_at = now() WHERE id = $1`,
      [v.brandId, featured],
    );
    await this.audit.record({
      action: featured ? 'food.vendor.feature' : 'food.vendor.unfeature',
      targetType: 'food_brand',
      targetId: v.brandId,
      before: { isFeatured: was?.isFeatured ?? null },
      after: { isFeatured: featured },
    });
    return { id: v.brandId, isFeatured: featured };
  }

  /** The business suspension (it hides the vendor at once); customers with active orders are told. */
  async suspend(staff: AuthenticatedUser, id: string, reason: string) {
    const v = await this.vendors.byBrandId(id);
    await this.admin.suspend(staff, v.businessId, reason);
    return this.statusView(v.brandId);
  }

  async reinstate(staff: AuthenticatedUser, id: string, reason: string) {
    const v = await this.vendors.byBrandId(id);
    await this.admin.reinstate(staff, v.businessId, reason);
    return this.statusView(v.brandId);
  }

  private async statusView(brandId: string) {
    const [r] = await this.dataSource.query(
      `SELECT b.status, b.suspension_reason FROM food_brands fb JOIN businesses b ON b.id = fb.business_id WHERE fb.id = $1`,
      [brandId],
    );
    return {
      id: brandId,
      businessStatus: r.status,
      suspensionReason: r.suspension_reason,
    };
  }

  // ── orders (read-only) ────────────────────────────────────────────────────

  async orders(q: AdminFoodOrdersQueryDto) {
    const qb = this.dataSource.getRepository(FoodOrder).createQueryBuilder('o');
    if (q.code) qb.andWhere('o.code = :code', { code: q.code.toUpperCase() });
    if (q.vendorId) qb.andWhere('o.brand_id = :b', { b: q.vendorId });
    if (q.status) qb.andWhere('o.status = :s', { s: q.status });
    const [rows, total] = await qb
      .orderBy('o.createdAt', 'DESC')
      .addOrderBy('o.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    const cards = await this.views.boardCards(rows);
    return paged(
      cards.map((c, i) => ({ ...c, vendorId: rows[i].brandId })),
      total,
      q,
    );
  }

  async order(id: string) {
    const o = await this.dataSource.manager.findOne(FoodOrder, {
      where: { id },
    });
    if (!o)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Order not found.',
      });
    const [u] = await this.dataSource.query(
      `SELECT display_name, email, phone FROM users WHERE id = $1`,
      [o.userId],
    );
    return {
      ...(await this.views.detail(o, 'admin')),
      customer: {
        userId: o.userId,
        name: u?.display_name ?? null,
        email: u?.email,
        phone: u?.phone,
      },
    };
  }

  // ── cuisines ──────────────────────────────────────────────────────────────

  async cuisines() {
    const rows = await this.dataSource.query(
      `SELECT c.*, (SELECT count(*)::int FROM food_brands fb WHERE c.id = ANY(fb.cuisine_ids)) AS vendors
         FROM cuisines c ORDER BY c.sort, c.name`,
    );
    return rows.map((c: any) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      icon: c.icon,
      sort: c.sort,
      isActive: c.is_active,
      vendors: c.vendors,
    }));
  }

  async createCuisine(dto: CuisineDto) {
    if (
      await this.dataSource.manager.exists(Cuisine, {
        where: { slug: dto.slug },
      })
    )
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `A cuisine with the slug ${dto.slug} exists.`,
        details: { field: 'slug' },
      });
    const c = await this.dataSource.manager.save(
      this.dataSource.manager.create(Cuisine, {
        slug: dto.slug,
        name: dto.name,
        icon: dto.icon ?? null,
        sort: dto.sort ?? 0,
        isActive: true,
      }),
    );
    await this.audit.record({
      action: 'food.cuisine.create',
      targetType: 'cuisine',
      targetId: c.id,
      before: null,
      after: snapshot(c, CUISINE_FIELDS),
    });
    return c;
  }

  async updateCuisine(id: string, dto: UpdateCuisineDto) {
    const c = await this.dataSource.manager.findOne(Cuisine, { where: { id } });
    if (!c)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Cuisine not found.',
      });
    const before = snapshot(c, CUISINE_FIELDS);
    if (dto.slug && dto.slug !== c.slug) {
      if (
        await this.dataSource.manager.exists(Cuisine, {
          where: { slug: dto.slug },
        })
      )
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `A cuisine with the slug ${dto.slug} exists.`,
          details: { field: 'slug' },
        });
      c.slug = dto.slug;
    }
    if (dto.name !== undefined) c.name = dto.name;
    if (dto.icon !== undefined) c.icon = dto.icon;
    if (dto.sort !== undefined) c.sort = dto.sort;
    if (dto.isActive !== undefined) c.isActive = dto.isActive;
    const saved = await this.dataSource.manager.save(c);
    await this.audit.record({
      action: 'food.cuisine.update',
      targetType: 'cuisine',
      targetId: id,
      before,
      after: snapshot(saved, CUISINE_FIELDS),
    });
    return saved;
  }

  /** Only a cuisine no vendor uses; otherwise deactivate it. */
  async removeCuisine(id: string) {
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM food_brands WHERE $1 = ANY(cuisine_ids)`,
      [id],
    );
    if (n > 0)
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `${n} vendor${n === 1 ? ' uses' : 's use'} this cuisine — deactivate it instead.`,
        details: { vendors: n },
      });
    const c = await this.dataSource.manager.findOne(Cuisine, { where: { id } });
    if (!c)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Cuisine not found.',
      });
    await this.dataSource.manager.delete(Cuisine, { id });
    await this.audit.record({
      action: 'food.cuisine.delete',
      targetType: 'cuisine',
      targetId: id,
      before: snapshot(c, CUISINE_FIELDS),
      after: null,
    });
    return { deleted: true };
  }
}
