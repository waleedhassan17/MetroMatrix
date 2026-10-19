import { pgDate } from '../../../common/db/parallel';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import {
  addDays,
  todayIn,
  wallTimeToInstant,
  parseTime,
  weekdayOf,
} from '../../../common/time/time.util';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { FoodOrderWriter } from '../../food/orders/food-order-writer.service';
import {
  FoodOrderTransitionsService,
  SYSTEM,
} from '../../food/orders/food-order-transitions.service';
import { FoodNotifier } from '../../food/orders/food-notifier.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { MediaService } from '../../media/media.service';
import { ForecastService } from '../../kitchen/forecast/forecast.service';
import { kitchenNotFound } from '../../kitchen/common/errors';
import { TiffinPlan } from './entities/tiffin.entity';
import {
  SubscribeDto,
  TiffinPlanDto,
  TiffinProofDto,
  TiffinSubscriptionsQueryDto,
} from './dto/tiffin.dto';

const LIVE = `('requested', 'active', 'paused')`;
const SEATED = `('active', 'paused')`;

const conflict = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => new ConflictException({ code, message, ...(details ? { details } : {}) });
const invalid = (field: string, message: string) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] } },
  });

const maskOf = (days: number[]) =>
  [...new Set(days)].reduce((m, d) => m | (1 << d), 0);
const daysOf = (mask: number) =>
  [0, 1, 2, 3, 4, 5, 6].filter((d) => mask & (1 << d));
const serves = (mask: number, date: string) =>
  (mask & (1 << weekdayOf(date))) !== 0;

/** Period end for a start date: 7 days, or a calendar month. */
export const periodEnd = (start: string, period: 'weekly' | 'monthly') =>
  period === 'weekly'
    ? addDays(start, 6)
    : DateTime.fromISO(start, { zone: 'UTC' })
        .plus({ months: 1 })
        .minus({ days: 1 })
        .toISODate()!;

/** Skips and pauses for a date close at the plan's hour on the day before (branch time). */
export const cutoffFor = (date: string, hour: number, tz: string) =>
  wallTimeToInstant(addDays(date, -1), hour * 60, tz)!;

/** The meal's value on the board: the period price spread over its meals. */
export const mealValue = (
  plan: Pick<TiffinPlan, 'pricePerPeriod' | 'period' | 'daysMask'>,
) => {
  const perWeek = daysOf(plan.daysMask).length;
  const meals = plan.period === 'weekly' ? perWeek : Math.round(perWeek * 4.33);
  return Math.max(0, Math.round(plan.pricePerPeriod / Math.max(1, meals)));
};

/**
 * Tiffin: plans, subscriptions and the daily orders. A subscription is
 * `requested` until the vendor approves it — only when the plan has a free
 * seat (`TIFFIN_FULL`). Skips and pauses close at the plan's cut-off the
 * evening before (`TIFFIN_SKIP_CUTOFF_PASSED`). At that cut-off the job
 * writes each day's meal as a scheduled board order (source `tiffin`,
 * payment `subscription`) through FoodOrderWriter, accepted by the system —
 * once per subscription and day (`tiffin_deliveries` is unique).
 */
@Injectable()
export class TiffinService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly writer: FoodOrderWriter,
    private readonly transitions: FoodOrderTransitionsService,
    private readonly notifier: FoodNotifier,
    private readonly notifications: NotificationsService,
    private readonly media: MediaService,
    private readonly forecast: ForecastService,
  ) {}

  onModuleInit(): void {
    // A tiffin order's day follows its order.
    this.transitions.afterStatus.push(async (m, order, _from, to) => {
      if (order.source !== 'tiffin') return;
      const status =
        to === 'ready'
          ? 'prepared'
          : to === 'delivered' || to === 'picked_up'
            ? 'delivered'
            : ['rejected', 'auto_rejected', 'cancelled'].includes(to)
              ? 'missed'
              : null;
      if (status)
        await m.query(
          `UPDATE tiffin_deliveries SET status = $2, updated_at = now() WHERE food_order_id = $1`,
          [order.id, status],
        );
    });
    // Subscriptions are certain demand for the prep sheet and shopping list.
    this.forecast.extraDemand.push((m, branchId, date) =>
      this.demand(m, branchId, date),
    );
  }

  // ── vendor: plans ──
  async plans(v: VendorRef) {
    const rows = await this.dataSource.query(
      `SELECT p.*, (SELECT count(*)::int FROM tiffin_subscriptions s WHERE s.plan_id = p.id AND s.status IN ${SEATED}) AS seated,
              (SELECT count(*)::int FROM tiffin_subscriptions s WHERE s.plan_id = p.id AND s.status = 'requested') AS requested
         FROM tiffin_plans p WHERE p.brand_id = $1 ORDER BY p.is_active DESC, p.created_at`,
      [v.brandId],
    );
    return rows.map((r: any) => this.planView(r));
  }

  async createPlan(v: VendorRef, dto: TiffinPlanDto) {
    await this.checkPlan(v, dto);
    const p = await this.dataSource.manager.save(
      this.dataSource.manager.create(TiffinPlan, {
        brandId: v.brandId,
        branchId: v.branchId,
        name: dto.name,
        description: dto.description ?? null,
        meal: dto.meal,
        daysMask: maskOf(dto.days),
        period: dto.period,
        pricePerPeriod: dto.pricePerPeriod,
        deliveryMode: dto.deliveryMode,
        deliveryWindowFrom: dto.deliveryWindowFrom,
        deliveryWindowTo: dto.deliveryWindowTo,
        capacity: dto.capacity,
        skipCutoffHour: dto.skipCutoffHour ?? 20,
        rotation: dto.rotation.map((r) => ({
          weekday: r.weekday,
          menuItemIds: r.menuItemIds,
          note: r.note ?? null,
        })),
        isActive: dto.isActive ?? true,
      }),
    );
    return this.plan(v, p.id);
  }

  async updatePlan(v: VendorRef, id: string, dto: TiffinPlanDto) {
    const p = await this.ownPlan(this.dataSource.manager, v, id);
    await this.checkPlan(v, dto);
    const [{ seated }] = await this.dataSource.query(
      `SELECT count(*)::int AS seated FROM tiffin_subscriptions WHERE plan_id = $1 AND status IN ${SEATED}`,
      [id],
    );
    if (dto.capacity < seated)
      throw invalid('capacity', `${seated} subscribers already have a seat.`);
    await this.dataSource.manager.update(
      TiffinPlan,
      { id: p.id },
      {
        name: dto.name,
        description: dto.description ?? null,
        meal: dto.meal,
        daysMask: maskOf(dto.days),
        period: dto.period,
        pricePerPeriod: dto.pricePerPeriod,
        deliveryMode: dto.deliveryMode,
        deliveryWindowFrom: dto.deliveryWindowFrom,
        deliveryWindowTo: dto.deliveryWindowTo,
        capacity: dto.capacity,
        skipCutoffHour: dto.skipCutoffHour ?? p.skipCutoffHour,
        rotation: dto.rotation.map((r) => ({
          weekday: r.weekday,
          menuItemIds: r.menuItemIds,
          note: r.note ?? null,
        })),
        isActive: dto.isActive ?? p.isActive,
      },
    );
    return this.plan(v, id);
  }

  async plan(v: VendorRef, id: string) {
    const [r] = await this.dataSource.query(
      `SELECT p.*, (SELECT count(*)::int FROM tiffin_subscriptions s WHERE s.plan_id = p.id AND s.status IN ${SEATED}) AS seated,
              (SELECT count(*)::int FROM tiffin_subscriptions s WHERE s.plan_id = p.id AND s.status = 'requested') AS requested
         FROM tiffin_plans p WHERE p.id = $1 AND p.brand_id = $2`,
      [id, v.brandId],
    );
    if (!r) throw kitchenNotFound('Tiffin plan');
    return this.planView(r);
  }

  private async checkPlan(v: VendorRef, dto: TiffinPlanDto) {
    if (parseTime(dto.deliveryWindowTo) <= parseTime(dto.deliveryWindowFrom))
      throw invalid('deliveryWindowTo', 'The window must end after it starts.');
    const days = new Set(dto.days);
    const rotation = new Map(dto.rotation.map((r) => [r.weekday, r]));
    for (const d of days)
      if (!rotation.has(d))
        throw invalid(
          'rotation',
          `Say what is cooked on ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]}.`,
        );
    for (const r of dto.rotation)
      if (!days.has(r.weekday))
        throw invalid(
          'rotation',
          'The rotation names a day the plan doesn’t serve.',
        );
    const ids = [...new Set(dto.rotation.flatMap((r) => r.menuItemIds))];
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM menu_items WHERE brand_id = $1 AND id = ANY($2::uuid[])`,
      [v.brandId, ids],
    );
    if (n !== ids.length) throw kitchenNotFound('Item');
  }

  private planView(r: any) {
    const seated = r.seated ?? 0;
    return {
      id: r.id,
      brandId: r.brand_id,
      name: r.name,
      description: r.description,
      meal: r.meal,
      days: daysOf(r.days_mask),
      period: r.period,
      pricePerPeriod: r.price_per_period,
      mealValue: mealValue({
        pricePerPeriod: r.price_per_period,
        period: r.period,
        daysMask: r.days_mask,
      }),
      deliveryMode: r.delivery_mode,
      deliveryWindow: {
        from: String(r.delivery_window_from).slice(0, 5),
        to: String(r.delivery_window_to).slice(0, 5),
      },
      capacity: r.capacity,
      seatsLeft: Math.max(0, r.capacity - seated),
      subscribers: seated,
      requests: r.requested ?? 0,
      skipCutoffHour: r.skip_cutoff_hour,
      rotation: r.rotation,
      isActive: r.is_active,
    };
  }

  private async ownPlan(m: EntityManager, v: VendorRef, id: string) {
    const p = await m.findOne(TiffinPlan, {
      where: { id, brandId: v.brandId },
    });
    if (!p) throw kitchenNotFound('Tiffin plan');
    return p;
  }

  // ── vendor: subscriptions ──
  async subscriptions(v: VendorRef, q: TiffinSubscriptionsQueryDto) {
    const params: unknown[] = [v.brandId];
    const where = ['p.brand_id = $1'];
    if (q.status) {
      params.push(q.status);
      where.push(`s.status = $${params.length}`);
    }
    if (q.planId) {
      params.push(q.planId);
      where.push(`s.plan_id = $${params.length}`);
    }
    const rows = await this.dataSource.query(
      `SELECT s.*, p.name AS plan_name, u.display_name, u.phone AS user_phone
         FROM tiffin_subscriptions s JOIN tiffin_plans p ON p.id = s.plan_id JOIN users u ON u.id = s.user_id
        WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC LIMIT 300`,
      params,
    );
    return rows.map((r: any) => ({
      ...this.subView(r),
      customer: {
        name: r.display_name,
        phone: r.address_snapshot?.phone ?? r.user_phone,
      },
    }));
  }

  async approve(v: VendorRef, id: string, now = new Date()) {
    const sub = await this.dataSource.transaction(async (m) => {
      const s = await this.ownSub(m, v, id);
      if (s.status !== 'requested')
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This subscription is ${s.status}.`,
        );
      const [plan] = await m.query(
        `SELECT * FROM tiffin_plans WHERE id = $1 FOR UPDATE`,
        [s.plan_id],
      );
      const [{ seated }] = await m.query(
        `SELECT count(*)::int AS seated FROM tiffin_subscriptions WHERE plan_id = $1 AND status IN ${SEATED}`,
        [s.plan_id],
      );
      if (seated >= plan.capacity)
        throw conflict(ErrorCode.TIFFIN_FULL, 'This plan is full.', {
          capacity: plan.capacity,
          subscribers: seated,
        });
      const [b] = await m.query(`SELECT timezone FROM branches WHERE id = $1`, [
        plan.branch_id,
      ]);
      const today = todayIn(b.timezone, now);
      const start = s.starts_on < today ? today : s.starts_on;
      await m.query(
        `UPDATE tiffin_subscriptions SET status = 'active', approved_at = now(), starts_on = $2,
                current_period_start = $2, current_period_end = $3, period_payment_status = 'due', updated_at = now()
          WHERE id = $1`,
        [id, start, periodEnd(start, plan.period)],
      );
      return {
        userId: s.user_id as string,
        planName: plan.name as string,
        start,
      };
    });
    await this.tell(
      sub.userId,
      'food.tiffin.approved',
      'Tiffin approved',
      `${sub.planName} starts ${sub.start}.`,
    );
    return this.subFor(v, id);
  }

  async decline(v: VendorRef, id: string, reason: string) {
    const s = await this.vendorMove(v, id, ['requested'], 'declined', reason);
    await this.tell(
      s.user_id,
      'food.tiffin.declined',
      'Tiffin request declined',
      reason,
    );
    return this.subFor(v, id);
  }

  async vendorPause(v: VendorRef, id: string, until: string, now = new Date()) {
    await this.dataSource.transaction(async (m) => {
      const [s] = await m.query(
        `SELECT s.*, p.skip_cutoff_hour, p.days_mask, br.timezone FROM tiffin_subscriptions s
           JOIN tiffin_plans p ON p.id = s.plan_id JOIN branches br ON br.id = p.branch_id
          WHERE s.id = $1 AND p.brand_id = $2 FOR UPDATE OF s`,
        [id, v.brandId],
      );
      if (!s) throw kitchenNotFound('Subscription');
      if (s.status !== 'active')
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This subscription is ${s.status}.`,
        );
      await this.pauseDays(m, s, until, now);
    });
    return this.subFor(v, id);
  }

  async end(v: VendorRef, id: string, reason: string) {
    const s = await this.vendorMove(
      v,
      id,
      ['active', 'paused'],
      'ended',
      reason,
    );
    await this.tell(s.user_id, 'food.tiffin.ended', 'Tiffin ended', reason);
    return this.subFor(v, id);
  }

  async confirmPayment(v: VendorRef, id: string) {
    await this.dataSource.transaction(async (m) => {
      const s = await this.ownSub(m, v, id);
      if (!['active', 'paused'].includes(s.status))
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This subscription is ${s.status}.`,
        );
      if (s.period_payment_status === 'paid')
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          'This period is already paid.',
        );
      await m.query(
        `UPDATE tiffin_subscriptions SET period_payment_status = 'paid', updated_at = now() WHERE id = $1`,
        [id],
      );
    });
    return this.subFor(v, id);
  }

  async rejectPayment(v: VendorRef, id: string, reason: string) {
    const s = await this.dataSource.transaction(async (m) => {
      const s = await this.ownSub(m, v, id);
      if (s.period_payment_status !== 'proof_submitted')
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          'There is no transfer proof to reject.',
        );
      await m.query(
        `UPDATE tiffin_subscriptions SET period_payment_status = 'due', reason = $2, updated_at = now() WHERE id = $1`,
        [id, reason],
      );
      return s;
    });
    await this.tell(
      s.user_id,
      'food.tiffin.payment_rejected',
      'Tiffin transfer not confirmed',
      reason,
    );
    return this.subFor(v, id);
  }

  /** Tomorrow (or a date): who eats, what to cook. */
  async tomorrow(v: VendorRef, date?: string) {
    const [b] = await this.dataSource.query(
      `SELECT timezone FROM branches WHERE id = $1`,
      [v.branchId],
    );
    const day = date ?? addDays(todayIn(b.timezone), 1);
    const plans = await this.dataSource.query(
      `SELECT * FROM tiffin_plans WHERE brand_id = $1 AND is_active`,
      [v.brandId],
    );
    const out = [];
    let total = 0;
    for (const p of plans) {
      if (!serves(p.days_mask, day)) continue;
      const subs = await this.servingOn(this.dataSource.manager, p.id, day);
      const skipped = subs.filter((s) => s.skipped).length;
      const eating = subs.length - skipped;
      const rot = (
        p.rotation as Array<{
          weekday: number;
          menuItemIds: string[];
          note?: string;
        }>
      ).find((r) => r.weekday === weekdayOf(day));
      const items: Array<{ id: string; name: string }> = rot?.menuItemIds.length
        ? await this.dataSource.query(
            `SELECT id, name FROM menu_items WHERE id = ANY($1::uuid[])`,
            [rot.menuItemIds],
          )
        : [];
      total += eating;
      out.push({
        planId: p.id,
        name: p.name,
        meal: p.meal,
        window: {
          from: String(p.delivery_window_from).slice(0, 5),
          to: String(p.delivery_window_to).slice(0, 5),
        },
        meals: eating,
        skipped,
        dishes: (rot?.menuItemIds ?? []).map((id) => ({
          itemId: id,
          name: items.find((i) => i.id === id)?.name ?? null,
          quantity: eating,
        })),
        note: rot?.note ?? null,
        cutoffAt: cutoffFor(day, p.skip_cutoff_hour, b.timezone),
      });
    }
    return { date: day, meals: total, plans: out };
  }

  // ── customers ──
  async vendorPlans(idOrSlug: string) {
    const rows = await this.dataSource.query(
      `SELECT p.*, (SELECT count(*)::int FROM tiffin_subscriptions s WHERE s.plan_id = p.id AND s.status IN ${SEATED}) AS seated
         FROM tiffin_plans p JOIN food_brands fb ON fb.id = p.brand_id
        WHERE p.is_active AND (fb.slug = $1 OR fb.id::text = $1) ORDER BY p.price_per_period`,
      [idOrSlug],
    );
    return rows.map((r: any) => {
      const v = this.planView(r);
      return { ...v, full: v.seatsLeft === 0 };
    });
  }

  async subscribe(
    user: AuthenticatedUser,
    dto: SubscribeDto,
    now = new Date(),
  ) {
    const id = await this.dataSource.transaction(async (m) => {
      const [p] = await m.query(
        `SELECT p.*, br.timezone, br.status AS branch_status FROM tiffin_plans p JOIN branches br ON br.id = p.branch_id
          WHERE p.id = $1 AND p.is_active FOR UPDATE OF p`,
        [dto.planId],
      );
      if (!p || p.branch_status !== 'active')
        throw kitchenNotFound('Tiffin plan');
      if (dto.fulfilment === 'delivery' && p.delivery_mode === 'pickup')
        throw invalid('fulfilment', 'This plan is pickup only.');
      if (dto.fulfilment === 'pickup' && p.delivery_mode === 'delivery')
        throw invalid('fulfilment', 'This plan is delivered only.');
      if (dto.startsOn < todayIn(p.timezone, now))
        throw invalid('startsOn', 'Choose today or a later date.');
      const [{ seated }] = await m.query(
        `SELECT count(*)::int AS seated FROM tiffin_subscriptions WHERE plan_id = $1 AND status IN ${SEATED}`,
        [p.id],
      );
      if (seated >= p.capacity)
        throw conflict(ErrorCode.TIFFIN_FULL, 'This plan is full.', {
          capacity: p.capacity,
        });
      const [dup] = await m.query(
        `SELECT id FROM tiffin_subscriptions WHERE plan_id = $1 AND user_id = $2 AND status IN ${LIVE}`,
        [p.id, user.id],
      );
      if (dup)
        throw conflict(ErrorCode.CONFLICT, 'You already have this tiffin.', {
          subscriptionId: dup.id,
        });
      let address = null;
      if (dto.fulfilment === 'delivery') {
        if (!dto.addressId)
          throw invalid('addressId', 'Choose the delivery address.');
        const [a] = await m.query(
          `SELECT * FROM addresses WHERE id = $1 AND user_id = $2`,
          [dto.addressId, user.id],
        );
        if (!a) throw kitchenNotFound('Address');
        if (a.lat === null || a.lng === null)
          throw invalid('addressId', 'Drop a pin on the map for this address.');
        address = {
          label: a.label,
          fullName: a.full_name,
          phone: a.phone,
          city: a.city,
          area: a.area,
          line1: a.line1,
          landmark: a.landmark,
          building: null,
          floor: null,
          riderInstructions: null,
          lat: Number(a.lat),
          lng: Number(a.lng),
        };
      }
      const [row] = await m.query(
        `INSERT INTO tiffin_subscriptions (plan_id, user_id, fulfilment, address_snapshot, starts_on, payment_method)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          p.id,
          user.id,
          dto.fulfilment,
          address ? JSON.stringify(address) : null,
          dto.startsOn,
          dto.paymentMethod,
        ],
      );
      const [owner] = await m.query(
        `SELECT b.owner_user_id FROM branches br JOIN businesses b ON b.id = br.business_id WHERE br.id = $1`,
        [p.branch_id],
      );
      return {
        id: row.id as string,
        owner: owner.owner_user_id as string,
        plan: p.name as string,
      };
    });
    await this.tell(
      id.owner,
      'kitchen.tiffin.requested',
      'New tiffin request',
      `${id.plan}: approve it while there is room.`,
    );
    return (await this.mine(user)).find((s: { id: string }) => s.id === id.id);
  }

  async mine(user: AuthenticatedUser) {
    const rows = await this.dataSource.query(
      `SELECT s.*, p.name AS plan_name, p.skip_cutoff_hour, p.days_mask, p.meal, fb.name AS vendor_name, fb.slug, br.timezone
         FROM tiffin_subscriptions s JOIN tiffin_plans p ON p.id = s.plan_id JOIN food_brands fb ON fb.id = p.brand_id
         JOIN branches br ON br.id = p.branch_id
        WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 50`,
      [user.id],
    );
    return rows.map((r: any) => {
      const next = this.nextServed(
        r.days_mask,
        todayIn(r.timezone),
        r.starts_on,
      );
      return {
        ...this.subView(r),
        vendor: { name: r.vendor_name, slug: r.slug },
        nextMeal: next,
        nextCutoffAt: next
          ? cutoffFor(next, r.skip_cutoff_hour, r.timezone)
          : null,
      };
    });
  }

  async skip(
    user: AuthenticatedUser,
    id: string,
    date: string,
    on: boolean,
    now = new Date(),
  ) {
    await this.dataSource.transaction(async (m) => {
      const s = await this.mySub(m, user, id);
      if (!['active', 'paused', 'requested'].includes(s.status))
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This subscription is ${s.status}.`,
        );
      if (!serves(s.days_mask, date))
        throw invalid('date', 'The plan doesn’t serve that day.');
      if (now >= cutoffFor(date, s.skip_cutoff_hour, s.timezone))
        throw conflict(
          ErrorCode.TIFFIN_SKIP_CUTOFF_PASSED,
          `Changes for ${date} closed at ${String(s.skip_cutoff_hour).padStart(2, '0')}:00 the day before.`,
          {
            date,
            cutoffAt: cutoffFor(date, s.skip_cutoff_hour, s.timezone),
          },
        );
      const skips = new Set<string>(
        (s.skips ?? []).map((d: string | Date) => pgDate(d)!),
      );
      if (on) skips.add(date);
      else skips.delete(date);
      await m.query(
        `UPDATE tiffin_subscriptions SET skips = $2::date[], updated_at = now() WHERE id = $1`,
        [id, [...skips].sort()],
      );
    });
    return (await this.mine(user)).find((x: { id: string }) => x.id === id);
  }

  async pause(
    user: AuthenticatedUser,
    id: string,
    until: string,
    now = new Date(),
  ) {
    await this.dataSource.transaction(async (m) => {
      const s = await this.mySub(m, user, id);
      if (s.status !== 'active')
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This subscription is ${s.status}.`,
        );
      await this.pauseDays(m, s, until, now);
    });
    return (await this.mine(user)).find((x: { id: string }) => x.id === id);
  }

  async cancel(user: AuthenticatedUser, id: string) {
    await this.dataSource.transaction(async (m) => {
      const s = await this.mySub(m, user, id);
      if (!['requested', 'active', 'paused'].includes(s.status))
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This subscription is ${s.status}.`,
        );
      await m.query(
        `UPDATE tiffin_subscriptions SET status = 'cancelled', updated_at = now() WHERE id = $1`,
        [id],
      );
    });
    return (await this.mine(user)).find((x: { id: string }) => x.id === id);
  }

  async paymentProof(user: AuthenticatedUser, id: string, dto: TiffinProofDto) {
    this.media.assertOwnedAsset(
      user.id,
      'payment_proof',
      dto.proofUrl,
      dto.publicId,
      'proofUrl',
    );
    const owner = await this.dataSource.transaction(async (m) => {
      const s = await this.mySub(m, user, id);
      if (s.payment_method !== 'transfer_per_period')
        throw invalid('proofUrl', 'This tiffin is paid in cash.');
      if (!['active', 'paused'].includes(s.status))
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This subscription is ${s.status}.`,
        );
      if (s.period_payment_status === 'paid')
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          'This period is already paid.',
        );
      await m.query(
        `UPDATE tiffin_subscriptions SET period_payment_status = 'proof_submitted', payment_proof_url = $2, payment_ref = $3, updated_at = now()
          WHERE id = $1`,
        [id, dto.proofUrl, dto.ref ?? null],
      );
      const [o] = await m.query(
        `SELECT b.owner_user_id FROM tiffin_plans p JOIN branches br ON br.id = p.branch_id JOIN businesses b ON b.id = br.business_id WHERE p.id = $1`,
        [s.plan_id],
      );
      return o.owner_user_id as string;
    });
    await this.tell(
      owner,
      'kitchen.tiffin.payment_proof',
      'Tiffin transfer to confirm',
      'A subscriber uploaded this period’s transfer.',
    );
    return (await this.mine(user)).find((x: { id: string }) => x.id === id);
  }

  // ── the daily orders ──
  /**
   * For today and tomorrow (branch time), every plan whose cut-off has
   * passed: one delivery row per serving subscription (skipped or with its
   * board order). Inserting the row is the claim, so a second run writes
   * nothing. Returns the order ids to announce after commit.
   */
  async generate(
    m: EntityManager,
    now: Date,
  ): Promise<{
    orders: string[];
    skipped: number;
    plans: Array<{ owner: string; name: string; date: string; meals: number }>;
  }> {
    const plans: Array<any> = await m.query(
      `SELECT p.*, br.timezone, br.business_id, br.status AS branch_status, b.owner_user_id
         FROM tiffin_plans p JOIN branches br ON br.id = p.branch_id JOIN businesses b ON b.id = br.business_id
        WHERE p.is_active AND br.status = 'active' AND b.status = 'approved'`,
    );
    const orders: string[] = [];
    const summary: Array<{
      owner: string;
      name: string;
      date: string;
      meals: number;
    }> = [];
    let skipped = 0;
    for (const p of plans) {
      const today = todayIn(p.timezone, now);
      for (const day of [today, addDays(today, 1)]) {
        if (
          !serves(p.days_mask, day) ||
          cutoffFor(day, p.skip_cutoff_hour, p.timezone) > now
        )
          continue;
        const rot = (
          p.rotation as Array<{ weekday: number; menuItemIds: string[] }>
        ).find((r) => r.weekday === weekdayOf(day));
        if (!rot?.menuItemIds.length) continue;
        const items: Array<{ id: string; name: string }> = await m.query(
          `SELECT id, name FROM menu_items WHERE id = ANY($1::uuid[]) AND brand_id = $2`,
          [rot.menuItemIds, p.brand_id],
        );
        let meals = 0;
        for (const s of await this.servingOn(m, p.id, day)) {
          const [claim] = await m.query(
            `INSERT INTO tiffin_deliveries (subscription_id, date, status) VALUES ($1, $2, $3)
             ON CONFLICT (subscription_id, date) DO NOTHING RETURNING id`,
            [s.id, day, s.skipped ? 'skipped' : 'scheduled'],
          );
          if (!claim) continue;
          if (s.skipped) {
            skipped++;
            continue;
          }
          const at = wallTimeToInstant(
            day,
            parseTime(String(p.delivery_window_from).slice(0, 5)),
            p.timezone,
          )!;
          const value = mealValue({
            pricePerPeriod: p.price_per_period,
            period: p.period,
            daysMask: p.days_mask,
          });
          const order = await this.writer.write(
            m,
            {
              userId: s.user_id,
              brandId: p.brand_id,
              branchId: p.branch_id,
              fulfilment: s.fulfilment,
              scheduledFor: at,
              paymentMethod: 'subscription',
              paymentStatus: 'paid',
              paidAt: now,
              addressSnapshot: s.address_snapshot,
              subtotal: value,
              discount: 0,
              deliveryFee: 0,
              total: value,
              source: 'tiffin',
              customerNote: `Tiffin: ${p.name}`,
              etaMinutes: null,
              promisedAt: at,
              acceptBy: new Date(now.getTime() + 10 * 60_000),
            },
            rot.menuItemIds.map((id, i) => ({
              itemId: id,
              variantId: null,
              itemName: items.find((x) => x.id === id)?.name ?? 'Tiffin meal',
              variantName: null,
              options: [],
              unitPrice: i === 0 ? value : 0,
              quantity: 1,
            })),
            SYSTEM,
            { tiffinSubscriptionId: s.id, date: day },
          );
          await this.transitions.moveStatus(m, order, 'accepted', SYSTEM, {
            note: 'Tiffin subscription',
          });
          await m.query(
            `UPDATE tiffin_deliveries SET food_order_id = $2, updated_at = now() WHERE id = $1`,
            [claim.id, order.id],
          );
          orders.push(order.id);
          meals++;
        }
        if (meals)
          summary.push({
            owner: p.owner_user_id,
            name: p.name,
            date: day,
            meals,
          });
      }
    }
    return { orders, skipped, plans: summary };
  }

  /** Daily: a new period for subscriptions whose period ended; pauses that ended resume. */
  async rollover(m: EntityManager, now: Date) {
    const subs: Array<any> = await m.query(
      `SELECT s.id, to_char(s.current_period_end, 'YYYY-MM-DD') AS current_period_end, s.status,
              to_char(s.paused_until, 'YYYY-MM-DD') AS paused_until, p.period, br.timezone
         FROM tiffin_subscriptions s JOIN tiffin_plans p ON p.id = s.plan_id JOIN branches br ON br.id = p.branch_id
        WHERE s.status IN ${SEATED} FOR UPDATE OF s SKIP LOCKED`,
    );
    let periods = 0;
    let resumed = 0;
    for (const s of subs) {
      const today = todayIn(s.timezone, now);
      const end = s.current_period_end
        ? String(s.current_period_end).slice(0, 10)
        : null;
      if (end && end < today) {
        let start = addDays(end, 1);
        while (periodEnd(start, s.period) < today)
          start = addDays(periodEnd(start, s.period), 1);
        await m.query(
          `UPDATE tiffin_subscriptions SET current_period_start = $2, current_period_end = $3, period_payment_status = 'due',
                  payment_proof_url = NULL, payment_ref = NULL, updated_at = now() WHERE id = $1`,
          [s.id, start, periodEnd(start, s.period)],
        );
        periods++;
      }
      const until = s.paused_until ? String(s.paused_until).slice(0, 10) : null;
      if (s.status === 'paused' && until && until < today) {
        await m.query(
          `UPDATE tiffin_subscriptions SET status = 'active', paused_until = NULL, updated_at = now() WHERE id = $1`,
          [s.id],
        );
        resumed++;
      }
    }
    return { periods, resumed };
  }

  /** Subscriptions that eat on a day: active or paused (a pause is skips), not skipped that day. */
  private async servingOn(m: EntityManager, planId: string, day: string) {
    const rows: Array<any> = await m.query(
      `SELECT id, user_id, fulfilment, address_snapshot, $2::date = ANY(skips) AS skipped
         FROM tiffin_subscriptions
        WHERE plan_id = $1 AND starts_on <= $2::date AND status IN ('active', 'paused')
        ORDER BY created_at`,
      [planId, day],
    );
    return rows;
  }

  /**
   * A pause is a run of skips: every served day through `until` whose
   * cut-off hasn't passed. A day already being prepared keeps its meal.
   */
  private async pauseDays(m: EntityManager, s: any, until: string, now: Date) {
    const today = todayIn(s.timezone, now);
    const days: string[] = [];
    for (let d = today; d <= until && days.length < 120; d = addDays(d, 1))
      if (
        serves(s.days_mask, d) &&
        now < cutoffFor(d, s.skip_cutoff_hour, s.timezone)
      )
        days.push(d);
    if (!days.length)
      throw conflict(
        ErrorCode.TIFFIN_SKIP_CUTOFF_PASSED,
        'Those meals are already being prepared.',
        { until },
      );
    const skips = new Set<string>(
      (s.skips ?? []).map((d: string | Date) => pgDate(d)!),
    );
    for (const d of days) skips.add(d);
    await m.query(
      `UPDATE tiffin_subscriptions SET status = 'paused', paused_until = $2, skips = $3::date[], updated_at = now() WHERE id = $1`,
      [s.id, until, [...skips].sort()],
    );
    return days;
  }

  private async demand(
    m: EntityManager,
    branchId: string,
    date: string,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const plans = await m.query(
      `SELECT id, days_mask, rotation FROM tiffin_plans WHERE branch_id = $1 AND is_active`,
      [branchId],
    );
    for (const p of plans) {
      if (!serves(p.days_mask, date)) continue;
      const rot = (
        p.rotation as Array<{ weekday: number; menuItemIds: string[] }>
      ).find((r) => r.weekday === weekdayOf(date));
      if (!rot) continue;
      const eating = (await this.servingOn(m, p.id, date)).filter(
        (s) => !s.skipped,
      ).length;
      for (const id of rot.menuItemIds)
        out.set(id, (out.get(id) ?? 0) + eating);
    }
    return out;
  }

  private nextServed(
    mask: number,
    today: string,
    startsOn: string | Date,
  ): string | null {
    const start = pgDate(startsOn)!;
    let d = start > today ? start : today;
    for (let i = 0; i < 8; i++, d = addDays(d, 1))
      if (serves(mask, d)) return d;
    return null;
  }

  private subView(r: any) {
    const day = pgDate;
    return {
      id: r.id,
      planId: r.plan_id,
      planName: r.plan_name,
      status: r.status,
      fulfilment: r.fulfilment,
      startsOn: day(r.starts_on),
      period: {
        start: day(r.current_period_start),
        end: day(r.current_period_end),
        paymentStatus: r.period_payment_status,
      },
      paymentMethod: r.payment_method,
      paymentRef: r.payment_ref,
      hasProof: !!r.payment_proof_url,
      skips: (r.skips ?? []).map(day),
      pausedUntil: day(r.paused_until),
      reason: r.reason,
      approvedAt: r.approved_at,
    };
  }

  private async ownSub(m: EntityManager, v: VendorRef, id: string) {
    const [s] = await m.query(
      `SELECT s.* FROM tiffin_subscriptions s JOIN tiffin_plans p ON p.id = s.plan_id WHERE s.id = $1 AND p.brand_id = $2 FOR UPDATE OF s`,
      [id, v.brandId],
    );
    if (!s) throw kitchenNotFound('Subscription');
    return s;
  }

  private async mySub(m: EntityManager, user: AuthenticatedUser, id: string) {
    const [s] = await m.query(
      `SELECT s.*, p.skip_cutoff_hour, p.days_mask, br.timezone FROM tiffin_subscriptions s
         JOIN tiffin_plans p ON p.id = s.plan_id JOIN branches br ON br.id = p.branch_id
        WHERE s.id = $1 AND s.user_id = $2 FOR UPDATE OF s`,
      [id, user.id],
    );
    if (!s) throw kitchenNotFound('Subscription');
    return s;
  }

  private async vendorMove(
    v: VendorRef,
    id: string,
    from: string[],
    to: string,
    reason: string,
  ) {
    return this.dataSource.transaction(async (m) => {
      const s = await this.ownSub(m, v, id);
      if (!from.includes(s.status))
        throw conflict(
          ErrorCode.INVALID_TRANSITION,
          `This subscription is ${s.status}.`,
        );
      await m.query(
        `UPDATE tiffin_subscriptions SET status = $2, reason = $3, updated_at = now() WHERE id = $1`,
        [id, to, reason],
      );
      return s;
    });
  }

  private async subFor(v: VendorRef, id: string) {
    return (await this.subscriptions(v, {})).find(
      (s: { id: string }) => s.id === id,
    );
  }

  async tell(userId: string, type: string, title: string, body: string) {
    try {
      await this.notifications.notify(userId, {
        type,
        title,
        body,
        data: {
          screen: type.startsWith('kitchen') ? 'kitchen.tiffin' : 'food.tiffin',
        },
      });
    } catch {
      /* the change stands */
    }
  }

  async announce(result: Awaited<ReturnType<TiffinService['generate']>>) {
    for (const id of result.orders) await this.notifier.changed(id, 'new');
    for (const p of result.plans)
      await this.tell(
        p.owner,
        'kitchen.tiffin.orders',
        `Tiffin for ${p.date}: ${p.meals} meals`,
        `${p.name} — on your board as scheduled orders.`,
      );
  }
}
