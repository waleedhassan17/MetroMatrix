import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { addDays, todayIn } from '../../../common/time/time.util';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { CostingService } from '../costing/costing.service';
import { kitchenNotFound } from '../common/errors';
import { MenuExperiment } from '../entities/menu-experiment.entity';
import {
  ExperimentDto,
  ExperimentsQueryDto,
  UpdateExperimentDto,
} from '../dto/engineering.dto';
import { classifyMenu, experimentVerdict, median } from './menu-engineering';

/** Orders that sold food: accepted and on, not ended without it. */
const SOLD = `('accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'picked_up')`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const dayCount = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  ) + 1;

/**
 * The menu engineering matrix and menu experiments (Chunk 5, P8). Both read
 * real sales (accepted orders onwards) and the recipe-card costing; the
 * rules themselves are pure (menu-engineering.ts).
 */
@Injectable()
export class EngineeringService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly costing: CostingService,
  ) {}

  private async tz(m: EntityManager, branchId: string): Promise<string> {
    const [b] = await m.query(`SELECT timezone FROM branches WHERE id = $1`, [
      branchId,
    ]);
    return b.timezone;
  }

  /** GET /food/vendor/kitchen/menu-engineering — the last 30 days. */
  async matrix(v: VendorRef, now = new Date()) {
    const m = this.dataSource.manager;
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const [sold, rows, { target }] = await Promise.all([
      m.query(
        `SELECT oi.item_id, oi.variant_id, sum(oi.quantity)::int AS qty
           FROM food_order_items oi JOIN food_orders o ON o.id = oi.order_id
          WHERE o.brand_id = $1 AND o.created_at >= $2 AND o.status IN ${SOLD} AND oi.item_id IS NOT NULL
          GROUP BY oi.item_id, oi.variant_id`,
        [v.brandId, since],
      ),
      this.costing.rows(m, v, undefined, now),
      this.costing.target(m, v.branchId),
    ]);
    const qtyOf = (itemId: string, variantId: string | null) =>
      sold
        .filter(
          (s: any) =>
            s.item_id === itemId &&
            (variantId === undefined || s.variant_id === variantId),
        )
        .reduce((n: number, s: any) => n + s.qty, 0);
    const items = [
      ...new Set(rows.filter((r) => r.isActive).map((r) => r.itemId)),
    ].map((itemId) => {
      const sizes = rows.filter((r) => r.itemId === itemId);
      const costed = sizes.filter((r) => r.margin !== null);
      const qty = sold
        .filter((s: any) => s.item_id === itemId)
        .reduce((n: number, s: any) => n + s.qty, 0);
      let margin: number | null = null;
      if (costed.length) {
        const weights = costed.map((r) => qtyOf(itemId, r.variantId));
        const total = weights.reduce((a, b) => a + b, 0);
        margin = total
          ? r2(
              costed.reduce((s, r, i) => s + r.margin! * weights[i], 0) / total,
            )
          : r2(costed.reduce((s, r) => s + r.margin!, 0) / costed.length);
      }
      const first = sizes[0];
      return {
        itemId,
        name: first.name,
        qty,
        margin,
        price: first.price,
        cost: first.cost,
        foodCostPct: first.foodCostPct,
      };
    });
    const r = classifyMenu(items);
    const extra = new Map(items.map((i) => [i.itemId, i]));
    const counts = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 };
    for (const i of r.items) counts[i.quadrant]++;
    return {
      days: 30,
      targetFoodCostPct: target,
      medianQty: r.medianQty,
      medianMargin: r.medianMargin,
      counts,
      items: r.items.map((i) => ({
        ...i,
        price: extra.get(i.itemId)!.price,
        cost: extra.get(i.itemId)!.cost,
        foodCostPct: extra.get(i.itemId)!.foodCostPct,
      })),
      needsRecipe: r.needsRecipe.map((i) => ({
        ...i,
        message: 'Add a recipe card to analyse',
      })),
    };
  }

  // ── Experiments ─────────────────────────────────────────────────────

  private phase(e: MenuExperiment, today: string) {
    if (e.status !== 'active') return e.status;
    return today < e.startsOn ? 'planned' : 'running';
  }

  /** Sales vs the category's median dish and the forecast, through `last`. */
  async result(
    m: EntityManager,
    v: VendorRef,
    e: MenuExperiment,
    last: string,
  ) {
    const tz = await this.tz(m, v.branchId);
    const days = Math.max(0, dayCount(e.startsOn, last));
    const window = [e.startsOn, addDays(last, 1)];
    const [cat] = await m.query(
      `SELECT category_id FROM menu_items WHERE id = $1`,
      [e.menuItemId],
    );
    const perItem: Array<{ id: string; qty: number }> = days
      ? await m.query(
          `SELECT mi.id, coalesce(sum(oi.quantity) FILTER (WHERE o.id IS NOT NULL), 0)::int AS qty
             FROM menu_items mi
             LEFT JOIN food_order_items oi ON oi.item_id = mi.id
             LEFT JOIN food_orders o ON o.id = oi.order_id AND o.status IN ${SOLD}
                  AND o.created_at >= ($2::date)::timestamp AT TIME ZONE $4
                  AND o.created_at < ($3::date)::timestamp AT TIME ZONE $4
            WHERE mi.category_id = $1 AND (mi.is_active OR mi.id = $5)
            GROUP BY mi.id`,
          [cat.category_id, window[0], window[1], tz, e.menuItemId],
        )
      : [];
    const sold = perItem.find((x) => x.id === e.menuItemId)?.qty ?? 0;
    const others = perItem.filter((x) => x.id !== e.menuItemId);
    const itemDaily = days ? r2(sold / days) : 0;
    const categoryMedianDaily =
      others.length && days
        ? r2(median(others.map((x) => x.qty / days))!)
        : null;
    const [f] = await m.query(
      `SELECT sum(coalesce(adjusted, expected))::float AS expected FROM demand_forecasts
        WHERE branch_id = $1 AND menu_item_id = $2 AND for_date >= $3 AND for_date <= $4`,
      [v.branchId, e.menuItemId, e.startsOn, last],
    );
    const forecast = f?.expected ?? null;
    const vsForecast = forecast ? r2(sold / forecast) : null;
    const [cost] = await this.costing.rows(m, v, [e.menuItemId]);
    const { target } = await this.costing.target(m, v.branchId);
    const verdict = experimentVerdict({
      days,
      itemDaily,
      categoryMedianDaily,
      vsForecast,
      foodCostPct: cost?.foodCostPct ?? null,
      targetFoodCostPct: target,
    });
    return {
      through: last,
      days,
      sold,
      itemDaily,
      categoryMedianDaily,
      categoryDishes: others.length,
      forecast: forecast !== null ? r2(forecast) : null,
      vsForecast,
      price: cost?.price ?? null,
      foodCostPct: cost?.foodCostPct ?? null,
      margin: cost?.margin ?? null,
      targetFoodCostPct: target,
      ...verdict,
    };
  }

  private async view(
    m: EntityManager,
    v: VendorRef,
    e: MenuExperiment,
    now: Date,
  ) {
    const today = todayIn(await this.tz(m, v.branchId), now);
    const [item] = await m.query(`SELECT name FROM menu_items WHERE id = $1`, [
      e.menuItemId,
    ]);
    const status = this.phase(e, today);
    const yesterday = addDays(today, -1);
    const live =
      status === 'running'
        ? await this.result(
            m,
            v,
            e,
            e.endsOn < yesterday ? e.endsOn : yesterday,
          )
        : null;
    return {
      id: e.id,
      itemId: e.menuItemId,
      item: item?.name ?? null,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      days: dayCount(e.startsOn, e.endsOn),
      status,
      notes: e.notes,
      result: status === 'completed' ? e.result : live,
      completedAt: e.completedAt,
      createdAt: e.createdAt,
    };
  }

  private async own(m: EntityManager, v: VendorRef, id: string, lock = false) {
    const e = await m.findOne(MenuExperiment, {
      where: { id, branchId: v.branchId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!e) throw kitchenNotFound('Experiment');
    return e;
  }

  async create(v: VendorRef, dto: ExperimentDto, now = new Date()) {
    const m = this.dataSource.manager;
    const [item] = await m.query(
      `SELECT id FROM menu_items WHERE id = $1 AND brand_id = $2`,
      [dto.itemId, v.brandId],
    );
    if (!item) throw kitchenNotFound('Item');
    const today = todayIn(await this.tz(m, v.branchId), now);
    const startsOn = dto.startsOn ?? today;
    if (startsOn < addDays(today, -7))
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'An experiment can start at most a week ago.',
        details: { fields: { startsOn: ['At most 7 days ago.'] } },
      });
    const res = await m
      .createQueryBuilder()
      .insert()
      .into(MenuExperiment)
      .values({
        branchId: v.branchId,
        menuItemId: dto.itemId,
        startsOn,
        endsOn: addDays(startsOn, dto.days - 1),
        notes: dto.notes ?? null,
      })
      .orIgnore()
      .returning('id')
      .execute();
    if (!res.raw.length)
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: 'This dish already has an experiment running.',
      });
    return this.get(v, res.raw[0].id, now);
  }

  async list(v: VendorRef, q: ExperimentsQueryDto, now = new Date()) {
    const m = this.dataSource.manager;
    const today = todayIn(await this.tz(m, v.branchId), now);
    const qb = m
      .getRepository(MenuExperiment)
      .createQueryBuilder('e')
      .where('e.branch_id = :b', { b: v.branchId });
    if (q.status === 'planned')
      qb.andWhere(`e.status = 'active' AND e.starts_on > :today`, { today });
    else if (q.status === 'running')
      qb.andWhere(`e.status = 'active' AND e.starts_on <= :today`, { today });
    else if (q.status) qb.andWhere('e.status = :s', { s: q.status });
    const [rows, total] = await qb
      .orderBy('e.createdAt', 'DESC')
      .addOrderBy('e.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    const items = [];
    for (const e of rows) items.push(await this.view(m, v, e, now));
    return paged(items, total, q);
  }

  async get(v: VendorRef, id: string, now = new Date()) {
    const m = this.dataSource.manager;
    return this.view(m, v, await this.own(m, v, id), now);
  }

  async update(
    v: VendorRef,
    id: string,
    dto: UpdateExperimentDto,
    now = new Date(),
  ) {
    const m = this.dataSource.manager;
    const e = await this.own(m, v, id);
    if (e.status !== 'active')
      throw new ConflictException({
        code: ErrorCode.INVALID_TRANSITION,
        message: `This experiment is ${e.status}.`,
        details: { from: e.status },
      });
    if (dto.endsOn && dto.endsOn < e.startsOn)
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'The last day can’t be before the first.',
        details: { fields: { endsOn: ['Not before startsOn.'] } },
      });
    if (dto.endsOn && dayCount(e.startsOn, dto.endsOn) > 60)
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'An experiment is at most 60 days.',
        details: { fields: { endsOn: ['At most 60 days.'] } },
      });
    await m.update(
      MenuExperiment,
      { id },
      {
        ...(dto.endsOn ? { endsOn: dto.endsOn } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    );
    return this.get(v, id, now);
  }

  /** End now: the result through yesterday is kept. */
  async end(v: VendorRef, id: string, now = new Date()) {
    await this.dataSource.transaction(async (m) => {
      const e = await this.own(m, v, id, true);
      if (e.status !== 'active')
        throw new ConflictException({
          code: ErrorCode.INVALID_TRANSITION,
          message: `This experiment is ${e.status}.`,
          details: { from: e.status, to: 'completed' },
        });
      const yesterday = addDays(todayIn(await this.tz(m, v.branchId), now), -1);
      const last = e.endsOn < yesterday ? e.endsOn : yesterday;
      if (last < e.startsOn)
        throw new ConflictException({
          code: ErrorCode.INVALID_TRANSITION,
          message: 'Nothing to measure yet — cancel it instead.',
          details: { from: 'planned', to: 'completed' },
        });
      await this.complete(m, v, e, last, now);
    });
    return this.get(v, id, now);
  }

  async cancel(v: VendorRef, id: string, now = new Date()) {
    const m = this.dataSource.manager;
    const e = await this.own(m, v, id);
    if (e.status !== 'active')
      throw new ConflictException({
        code: ErrorCode.INVALID_TRANSITION,
        message: `This experiment is ${e.status}.`,
        details: { from: e.status, to: 'cancelled' },
      });
    await m.update(
      MenuExperiment,
      { id, status: 'active' },
      { status: 'cancelled' },
    );
    return this.get(v, id, now);
  }

  private async complete(
    m: EntityManager,
    v: VendorRef,
    e: MenuExperiment,
    last: string,
    now: Date,
  ) {
    const result = await this.result(m, v, e, last);
    await m.update(
      MenuExperiment,
      { id: e.id, status: 'active' },
      {
        status: 'completed',
        endsOn: last,
        // jsonb: TypeORM's deep-partial type can't express nullable values in it.
        result: { ...result, computedAt: now.toISOString() } as never,
        completedAt: now,
      },
    );
  }

  /** Nightly: every active experiment whose last day has passed (idempotent: only `active` rows). */
  async completeDue(m: EntityManager, now = new Date()) {
    const due: Array<{
      id: string;
      branch_id: string;
      brand_id: string;
      timezone: string;
      ends_on: string;
    }> = await m.query(
      `SELECT e.id, e.branch_id, br.brand_id, br.timezone, to_char(e.ends_on, 'YYYY-MM-DD') AS ends_on
         FROM menu_experiments e JOIN branches br ON br.id = e.branch_id
        WHERE e.status = 'active' FOR UPDATE OF e SKIP LOCKED`,
    );
    let completed = 0;
    for (const d of due) {
      if (d.ends_on >= todayIn(d.timezone, now)) continue;
      const e = (await m.findOne(MenuExperiment, { where: { id: d.id } }))!;
      await this.complete(
        m,
        { branchId: d.branch_id, brandId: d.brand_id } as VendorRef,
        e,
        e.endsOn,
        now,
      );
      completed++;
    }
    return { completed };
  }
}
