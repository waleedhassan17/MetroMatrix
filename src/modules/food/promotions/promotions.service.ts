import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FoodPromotion } from './entities/food-promotion.entity';
import {
  PromotionDto,
  PromotionQueryDto,
  PromotionState,
  UpdatePromotionDto,
} from './dto/promotion.dto';
import { PromotionRule, dealLabel, dealRank, isLive } from './best-promotion';
import { PlanService } from '../../plans/plans.service';
import {
  FoodDiscoveryService,
  DealLabel,
} from '../discovery/discovery.service';
import type { VendorRef } from '../vendor/food-vendor.service';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { daysOf, maskOf } from '../menu/item-pricing';
import { NEGATIVE_END } from '../orders/food-order-status';

/** Active, started and not ended — what counts against `promotions_active`. */
const RUNNING_SQL = `p.is_active AND (p.ends_at IS NULL OR p.ends_at > now())`;

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Promotion not found.',
  });

export const toRule = (p: FoodPromotion): PromotionRule => ({
  id: p.id,
  title: p.title,
  kind: p.kind,
  value: p.value,
  itemIds: p.itemIds,
  minOrder: p.minOrder,
  maxDiscount: p.maxDiscount,
  code: p.code,
  startsAt: p.startsAt,
  endsAt: p.endsAt,
  weekdaysMask: p.weekdaysMask,
  timeFrom: p.timeFrom,
  timeTo: p.timeTo,
  usageLimit: p.usageLimit,
  perUserLimit: p.perUserLimit,
  usedCount: p.usedCount,
  firstOrderOnly: p.firstOrderOnly,
  isActive: p.isActive,
});

const NEGATIVE = NEGATIVE_END.map((s) => `'${s}'`).join(', ');

/**
 * Vendor-funded deals: the vendor's CRUD, the live deal labels on cards
 * (the discovery hook) and the rules checkout prices with. Usage is counted
 * by checkout's atomic increment and given back on any cancel.
 */
@Injectable()
export class PromotionsService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly plans: PlanService,
    private readonly discovery: FoodDiscoveryService,
  ) {}

  onModuleInit(): void {
    this.plans.registerCounter(
      'promotions_active',
      async (m, businessId) =>
        (
          await m.query(
            `SELECT count(*)::int AS n FROM food_promotions p JOIN food_brands fb ON fb.id = p.brand_id
              WHERE fb.business_id = $1 AND ${RUNNING_SQL}`,
            [businessId],
          )
        )[0].n,
    );
    this.discovery.dealsFor = (brandIds, now) => this.dealsFor(brandIds, now);
  }

  /** Automatic deals live right now, best first, per brand. */
  async dealsFor(
    brandIds: string[],
    now = new Date(),
  ): Promise<Map<string, DealLabel[]>> {
    const out = new Map<string, DealLabel[]>();
    if (!brandIds.length) return out;
    const rows: Array<FoodPromotion & { tz: string }> = await this.dataSource
      .getRepository(FoodPromotion)
      .createQueryBuilder('p')
      .innerJoin('branches', 'br', 'br.brand_id = p.brand_id')
      .addSelect('br.timezone', 'tz')
      .where('p.brand_id = ANY(:ids::uuid[])', { ids: brandIds })
      .andWhere('p.code IS NULL AND p.is_active AND p.starts_at <= :now', {
        now,
      })
      .andWhere('(p.ends_at IS NULL OR p.ends_at > :now)', { now })
      .andWhere('(p.usage_limit IS NULL OR p.used_count < p.usage_limit)')
      .getRawAndEntities()
      .then(({ raw, entities }) =>
        entities.map((e) => {
          const r = raw.find((x: any) => x.p_id === e.id);
          return Object.assign(e, { tz: r.tz as string });
        }),
      );
    const live = rows
      .filter((p) => isLive(toRule(p), now, p.tz))
      .sort((a, b) => dealRank(toRule(a), toRule(b)));
    for (const p of live) {
      const list = out.get(p.brandId) ?? [];
      list.push({
        id: p.id,
        title: p.title,
        label: dealLabel(toRule(p)),
        freeDelivery: p.kind === 'free_delivery' && p.minOrder === 0,
      });
      out.set(p.brandId, list);
    }
    return out;
  }

  /** Every promotion that could apply to an order now (coded ones included). */
  async rulesFor(m: EntityManager, brandId: string): Promise<PromotionRule[]> {
    const rows = await m
      .getRepository(FoodPromotion)
      .createQueryBuilder('p')
      .where('p.brand_id = :brandId AND p.is_active', { brandId })
      .getMany();
    return rows.map(toRule);
  }

  /** How many of this customer's live orders used each promotion. */
  async userUses(
    m: EntityManager,
    userId: string,
    promotionIds: string[],
  ): Promise<Map<string, number>> {
    if (!promotionIds.length) return new Map();
    const rows = await m.query(
      `SELECT promotion_id, count(*)::int AS n FROM food_orders
        WHERE user_id = $1 AND promotion_id = ANY($2::uuid[]) AND status NOT IN (${NEGATIVE})
        GROUP BY promotion_id`,
      [userId, promotionIds],
    );
    return new Map(rows.map((r: any) => [r.promotion_id, r.n]));
  }

  async isFirstOrder(
    m: EntityManager,
    userId: string,
    brandId: string,
  ): Promise<boolean> {
    const [row] = await m.query(
      `SELECT 1 FROM food_orders WHERE user_id = $1 AND brand_id = $2 AND status NOT IN (${NEGATIVE}) LIMIT 1`,
      [userId, brandId],
    );
    return !row;
  }

  // ── vendor CRUD ───────────────────────────────────────────────────────────

  async list(v: VendorRef, q: PromotionQueryDto) {
    const qb = this.dataSource
      .getRepository(FoodPromotion)
      .createQueryBuilder('p')
      .where('p.brand_id = :brandId', { brandId: v.brandId });
    const state: Record<PromotionState, string> = {
      live: `p.is_active AND p.starts_at <= now() AND (p.ends_at IS NULL OR p.ends_at > now())`,
      scheduled: `p.is_active AND p.starts_at > now()`,
      ended: `p.ends_at IS NOT NULL AND p.ends_at <= now()`,
      inactive: `NOT p.is_active`,
    };
    if (q.state) qb.andWhere(state[q.state]);
    const [rows, total] = await qb
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(
      rows.map((p) => this.view(p)),
      total,
      q,
    );
  }

  async get(v: VendorRef, id: string) {
    return this.view(await this.find(this.dataSource.manager, v, id));
  }

  async create(v: VendorRef, dto: PromotionDto) {
    return this.dataSource.transaction(async (m) => {
      await this.plans.assertEntitled(m, v.businessId, 'promotions');
      const p = m.create(FoodPromotion, {
        brandId: v.brandId,
        title: dto.title,
        kind: dto.kind,
        value: dto.kind === 'free_delivery' ? 0 : (dto.value ?? 0),
        itemIds: dto.itemIds ?? [],
        minOrder: dto.minOrder ?? 0,
        maxDiscount: dto.maxDiscount ?? null,
        code: dto.code ? dto.code.toUpperCase() : null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        weekdaysMask: dto.weekdays ? maskOf(dto.weekdays) : 127,
        timeFrom: dto.timeFrom ?? null,
        timeTo: dto.timeTo ?? null,
        usageLimit: dto.usageLimit ?? null,
        perUserLimit: dto.perUserLimit ?? null,
        firstOrderOnly: dto.firstOrderOnly ?? false,
        isActive: dto.isActive ?? true,
      });
      await this.check(m, v, p, null);
      return this.view(await this.save(m, p));
    });
  }

  async update(v: VendorRef, id: string, dto: UpdatePromotionDto) {
    return this.dataSource.transaction(async (m) => {
      const p = await this.find(m, v, id, true);
      const wasRunning = this.running(p);
      if (dto.title !== undefined) p.title = dto.title;
      if (dto.kind !== undefined) p.kind = dto.kind;
      if (dto.value !== undefined) p.value = dto.value;
      if (p.kind === 'free_delivery') p.value = 0;
      if (dto.itemIds !== undefined) p.itemIds = dto.itemIds;
      if (dto.minOrder !== undefined) p.minOrder = dto.minOrder;
      if (dto.maxDiscount !== undefined) p.maxDiscount = dto.maxDiscount;
      if (dto.code !== undefined)
        p.code = dto.code ? dto.code.toUpperCase() : null;
      if (dto.startsAt !== undefined) p.startsAt = new Date(dto.startsAt);
      if (dto.endsAt !== undefined)
        p.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
      if (dto.weekdays !== undefined) p.weekdaysMask = maskOf(dto.weekdays);
      if (dto.timeFrom !== undefined) p.timeFrom = dto.timeFrom;
      if (dto.timeTo !== undefined) p.timeTo = dto.timeTo;
      if (dto.usageLimit !== undefined) p.usageLimit = dto.usageLimit;
      if (dto.perUserLimit !== undefined) p.perUserLimit = dto.perUserLimit;
      if (dto.firstOrderOnly !== undefined)
        p.firstOrderOnly = dto.firstOrderOnly;
      if (dto.isActive !== undefined) p.isActive = dto.isActive;
      await this.check(m, v, p, wasRunning ? p.id : null);
      return this.view(await this.save(m, p));
    });
  }

  async deactivate(v: VendorRef, id: string) {
    const p = await this.find(this.dataSource.manager, v, id);
    p.isActive = false;
    return this.view(await this.dataSource.manager.save(p));
  }

  /** Only a promotion nobody has used can be deleted; otherwise deactivate it (orders keep their snapshot). */
  async remove(v: VendorRef, id: string) {
    const p = await this.find(this.dataSource.manager, v, id);
    const [used] = await this.dataSource.query(
      `SELECT 1 FROM food_orders WHERE promotion_id = $1 LIMIT 1`,
      [p.id],
    );
    if (used || p.usedCount > 0)
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message:
          'Orders have used this promotion — deactivate it instead of deleting.',
      });
    await this.dataSource.manager.delete(FoodPromotion, { id: p.id });
    return { deleted: true };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private running(p: FoodPromotion) {
    return p.isActive && (!p.endsAt || p.endsAt > new Date());
  }

  private async find(
    m: EntityManager,
    v: VendorRef,
    id: string,
    lock = false,
  ): Promise<FoodPromotion> {
    const p = await m.findOne(FoodPromotion, {
      where: { id, brandId: v.brandId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!p) throw notFound();
    return p;
  }

  /** The rules a vendor can't break, and the plan's active-promotion limit. */
  private async check(
    m: EntityManager,
    v: VendorRef,
    p: FoodPromotion,
    alreadyCountedId: string | null,
  ) {
    const bad = (message: string, field: string) =>
      new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message,
        details: { fields: { [field]: [message] } },
      });
    if (
      (p.kind === 'percent_off_order' || p.kind === 'percent_off_items') &&
      (p.value < 1 || p.value > 100)
    )
      throw bad('A percent deal is 1–100%.', 'value');
    if (p.kind === 'flat_off' && p.value < 1)
      throw bad('A flat deal needs an amount in rupees.', 'value');
    if (p.kind === 'percent_off_items') {
      if (!p.itemIds.length)
        throw bad('Choose the dishes this deal applies to.', 'itemIds');
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM menu_items WHERE brand_id = $1 AND id = ANY($2::uuid[])`,
        [v.brandId, p.itemIds],
      );
      if (n !== new Set(p.itemIds).size)
        throw bad('Some of those dishes aren’t on your menu.', 'itemIds');
    } else p.itemIds = [];
    if ((p.timeFrom === null) !== (p.timeTo === null))
      throw bad('Give both times of a daily window, or neither.', 'timeTo');
    if (p.timeFrom && p.timeFrom === p.timeTo)
      throw bad('The daily window can’t start and end together.', 'timeTo');
    if (p.endsAt && p.endsAt <= p.startsAt)
      throw bad('A promotion must end after it starts.', 'endsAt');
    if (p.code) {
      const clash = await m.query(
        `SELECT 1 FROM food_promotions WHERE brand_id = $1 AND code = $2 AND id <> COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000')`,
        [v.brandId, p.code, p.id ?? null],
      );
      if (clash.length)
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `You already have a promotion with the code ${p.code}.`,
          details: { field: 'code' },
        });
    }
    if (this.running(p) && !alreadyCountedId) {
      const used = await this.plans.usage(v.businessId, m);
      await this.plans.assertWithin(
        m,
        v.businessId,
        'promotions_active',
        used.promotions_active + 1,
      );
    }
  }

  private async save(m: EntityManager, p: FoodPromotion) {
    return m.save(p);
  }

  view(p: FoodPromotion) {
    const now = new Date();
    const state: PromotionState = !p.isActive
      ? 'inactive'
      : p.endsAt && p.endsAt <= now
        ? 'ended'
        : p.startsAt > now
          ? 'scheduled'
          : 'live';
    return {
      id: p.id,
      title: p.title,
      kind: p.kind,
      value: p.value,
      itemIds: p.itemIds,
      minOrder: p.minOrder,
      maxDiscount: p.maxDiscount,
      code: p.code,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      weekdays: daysOf(p.weekdaysMask),
      timeFrom: p.timeFrom?.slice(0, 5) ?? null,
      timeTo: p.timeTo?.slice(0, 5) ?? null,
      usageLimit: p.usageLimit,
      perUserLimit: p.perUserLimit,
      usedCount: p.usedCount,
      firstOrderOnly: p.firstOrderOnly,
      isActive: p.isActive,
      state,
      label: dealLabel(toRule(p)),
    };
  }
}
