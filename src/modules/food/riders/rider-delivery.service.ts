import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FoodOrder } from '../orders/entities/food-order.entity';
import { FoodOrderItem } from '../orders/entities/food-order-item.entity';
import {
  FoodActor,
  FoodOrderTransitionsService,
} from '../orders/food-order-transitions.service';
import { FoodOrderActionsService } from '../orders/food-order-actions.service';
import { FoodOrderViewsService } from '../orders/food-order-views.service';
import { FoodNotice, FoodNotifier } from '../orders/food-notifier.service';
import { STATUS_LABEL } from '../orders/food-order-status';
import { RIDER_STEP, RiderStep } from './rider-steps';
import { isLocationLive } from './presence';
import { HandoverDto, RiderOrdersQueryDto } from './dto/delivery.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { invalidTransition } from '../../../common/state/transitions';
import { paged } from '../../../common/pagination/pagination';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import type { VendorRef } from '../vendor/food-vendor.service';
import type { RiderRef } from '../common/rider.guard';

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;
const ASSIGNABLE = ['accepted', 'preparing', 'ready'];
const RIDER_ACTIVE = ['accepted', 'preparing', 'ready', 'on_the_way'];

const riderNotFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Rider not found.',
  });

/**
 * A vendor's riders on its orders. The vendor assigns (MetroMatrix never
 * dispatches); the rider moves through rider-steps.ts, picks up (ready →
 * on_the_way) and delivers (→ delivered, COD cash onto their ledger); the
 * vendor takes the cash back with a handover. Every rider query is scoped to
 * the rider's own orders and every vendor query to its own riders — anything
 * else is 404.
 */
@Injectable()
export class RiderDeliveryService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: FoodOrderTransitionsService,
    private readonly actions: FoodOrderActionsService,
    private readonly views: FoodOrderViewsService,
    private readonly notifier: FoodNotifier,
    private readonly audit: OperationalAuditService,
  ) {}

  onModuleInit(): void {
    this.views.riderCard = (o) => this.riderCard(o);
    this.actions.onDelivered = (m, o, actor) => this.recordCod(m, o, actor);
  }

  // ── the rider ─────────────────────────────────────────────────────────────

  async duty(r: RiderRef, onDuty: boolean) {
    await this.dataSource.query(
      `UPDATE riders SET on_duty = $2, updated_at = now() WHERE id = $1`,
      [r.id, onDuty],
    );
    return { onDuty };
  }

  async orders(r: RiderRef, q: RiderOrdersQueryDto) {
    const qb = this.dataSource
      .getRepository(FoodOrder)
      .createQueryBuilder('o')
      .where('o.rider_id = :riderId', { riderId: r.id });
    if ((q.scope ?? 'active') === 'active')
      qb.andWhere('o.status IN (:...s)', { s: RIDER_ACTIVE });
    else qb.andWhere(`o.status IN ('delivered', 'cancelled')`);
    const [rows, total] = await qb
      .orderBy('o.createdAt', q.scope === 'history' ? 'DESC' : 'ASC')
      .addOrderBy('o.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    const out = [];
    for (const o of rows) out.push(await this.riderView(o));
    return paged(out, total, q);
  }

  async order(r: RiderRef, id: string) {
    const o = await this.dataSource.manager.findOne(FoodOrder, {
      where: { id, riderId: r.id },
    });
    if (!o) throw this.orderNotFound();
    return this.riderView(o);
  }

  accept(r: RiderRef, id: string) {
    return this.step(r, id, 'accepted_by_rider', async (m, o) => [
      await this.toVendor(
        o,
        `${o.code}: rider on the way to you`,
        'Your rider accepted the delivery.',
      ),
    ]);
  }

  decline(r: RiderRef, id: string, reason: string) {
    return this.step(
      r,
      id,
      'declined',
      async (m, o) => {
        await m.query(
          `UPDATE food_orders SET rider_id = NULL, rider_step = NULL, updated_at = now() WHERE id = $1`,
          [o.id],
        );
        await this.release(m, r.id);
        return [
          await this.toVendor(
            o,
            `${o.code}: rider declined`,
            `Reason: ${reason}. Assign another rider.`,
          ),
        ];
      },
      reason,
    );
  }

  arrivedBranch(r: RiderRef, id: string) {
    return this.step(r, id, 'arrived_at_branch', async () => []);
  }

  /** Food in hand: ready → on_the_way. */
  pickedUp(r: RiderRef, id: string) {
    return this.step(r, id, 'picked_up', async (m, o, actor) => {
      if (o.status !== 'ready')
        throw invalidTransition(
          o.status,
          'on_the_way',
          [],
          'The kitchen hasn’t marked this order ready yet.',
        );
      await this.transitions.moveStatus(m, o, 'on_the_way', actor);
      return [
        this.toCustomer(
          o,
          'food.order.on_the_way',
          `${o.code} is on the way`,
          'Your rider has picked up your order.',
        ),
      ];
    });
  }

  arrivedCustomer(r: RiderRef, id: string) {
    return this.step(r, id, 'arrived_at_customer', async (m, o) => [
      this.toCustomer(
        o,
        'food.order.rider_arrived',
        'Your rider is here',
        `Meet the rider for ${o.code}.`,
      ),
    ]);
  }

  delivered(r: RiderRef, id: string, codCollected?: number) {
    return this.step(r, id, 'delivered', async (m, o, actor) => {
      await this.actions.markDelivered(m, o, actor, codCollected);
      return [
        this.toCustomer(
          o,
          'food.order.delivered',
          `${o.code} delivered`,
          'Enjoy your meal!',
        ),
      ];
    });
  }

  async cash(riderId: string) {
    const [{ balance }] = await this.dataSource.query(
      `SELECT coalesce(sum(amount), 0)::int AS balance FROM rider_cash_ledger WHERE rider_id = $1`,
      [riderId],
    );
    const entries = await this.dataSource.query(
      `SELECT l.id, l.kind, l.amount, l.note, l.at, o.code AS order_code
         FROM rider_cash_ledger l LEFT JOIN food_orders o ON o.id = l.order_id
        WHERE l.rider_id = $1 ORDER BY l.at DESC, l.created_at DESC LIMIT 50`,
      [riderId],
    );
    return {
      riderId,
      /** Cash the rider still holds for the vendor. */
      balance,
      entries: entries.map((e: any) => ({
        id: e.id,
        kind: e.kind,
        amount: e.amount,
        orderCode: e.order_code,
        note: e.note,
        at: e.at,
      })),
    };
  }

  // ── the vendor ────────────────────────────────────────────────────────────

  /** Give a delivery order to one of your riders (active and on duty). */
  async assign(v: VendorRef, orderId: string, riderId: string) {
    const notices = await this.dataSource.transaction(async (m) => {
      const o = await this.transitions.lock(m, {
        id: orderId,
        branchId: v.branchId,
      });
      if (o.fulfilment !== 'delivery')
        throw invalidTransition(
          o.status,
          'assigned',
          [],
          'Pickup orders don’t need a rider.',
        );
      if (!ASSIGNABLE.includes(o.status) || o.handedToExternal)
        throw invalidTransition(
          o.status,
          'assigned',
          [],
          'Assign a rider after accepting the order and before it leaves.',
        );
      if (o.riderId === riderId) return [];
      const [rider] = await m.query(
        `SELECT id, user_id, full_name, status, on_duty FROM riders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [riderId, v.businessId],
      );
      if (!rider) throw riderNotFound();
      if (rider.status !== 'active' || !rider.on_duty)
        throw new ConflictException({
          code: ErrorCode.RIDER_NOT_AVAILABLE,
          message:
            rider.status !== 'active'
              ? `${rider.full_name} isn’t active.`
              : `${rider.full_name} is off duty.`,
          details: {
            reason: rider.status !== 'active' ? rider.status : 'off_duty',
          },
        });
      const out: FoodNotice[] = [];
      const actor: FoodActor = { role: 'vendor', userId: v.ownerUserId };
      if (o.riderId) {
        const [old] = await m.query(
          `SELECT user_id FROM riders WHERE id = $1`,
          [o.riderId],
        );
        await this.release(m, o.riderId);
        await this.transitions.riderEvent(m, o.id, 'unassigned', actor, null, {
          riderId: o.riderId,
        });
        if (old)
          out.push({
            userId: old.user_id,
            payload: {
              type: 'food.rider.unassigned',
              title: `${o.code} reassigned`,
              body: 'The vendor gave this delivery to another rider.',
              data: { orderId: o.id, code: o.code },
            },
          });
      }
      await m.query(
        `UPDATE food_orders SET rider_id = $2, rider_step = 'assigned', updated_at = now() WHERE id = $1`,
        [o.id, rider.id],
      );
      await m.query(
        `UPDATE riders SET active_order_count = active_order_count + 1, updated_at = now() WHERE id = $1`,
        [rider.id],
      );
      await this.transitions.riderEvent(m, o.id, 'assigned', actor, null, {
        riderId: rider.id,
        riderName: rider.full_name,
      });
      out.push({
        userId: rider.user_id,
        payload: {
          type: 'food.rider.assigned',
          title: `New delivery ${o.code}`,
          body: `${o.paymentMethod === 'cod' ? `Collect ${rs(o.total)} cash. ` : ''}Open the app for the pickup and drop-off.`,
          data: { orderId: o.id, code: o.code, screen: 'food.rider.order' },
          priority: 'high',
        },
      });
      return out;
    });
    await this.notifier.send(notices);
    await this.notifier.changed(orderId);
    return this.views.vendorDetail(v, orderId);
  }

  /** On-duty riders for an order: fewest active orders, then nearest (live locations only). */
  async suggest(v: VendorRef, orderId: string, now = new Date()) {
    const [o] = await this.dataSource.query(
      `SELECT id, fulfilment FROM food_orders WHERE id = $1 AND branch_id = $2`,
      [orderId, v.branchId],
    );
    if (!o) throw this.orderNotFound();
    const rows = await this.dataSource.query(
      `SELECT r.id, r.full_name, r.vehicle, r.phone, r.active_order_count, r.location_updated_at,
              CASE WHEN r.last_geo IS NOT NULL THEN ST_Distance(r.last_geo, br.geo) END AS distance_m
         FROM riders r JOIN branches br ON br.id = $2
        WHERE r.business_id = $1 AND r.status = 'active' AND r.on_duty`,
      [v.businessId, v.branchId],
    );
    const items = rows
      .map((r: any) => {
        const live = isLocationLive(r.location_updated_at, now);
        return {
          riderId: r.id,
          fullName: r.full_name,
          vehicle: r.vehicle,
          phone: r.phone,
          activeOrders: r.active_order_count,
          locationLive: live,
          distanceKm:
            live && r.distance_m !== null
              ? Math.round(r.distance_m / 100) / 10
              : null,
        };
      })
      .sort(
        (a: any, b: any) =>
          a.activeOrders - b.activeOrders ||
          (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
          a.fullName.localeCompare(b.fullName),
      );
    return { orderId, items };
  }

  /** Riders on the map: duty, live location, what they're carrying. */
  async live(v: VendorRef, now = new Date()) {
    const rows = await this.dataSource.query(
      `SELECT r.id, r.full_name, r.phone, r.vehicle, r.on_duty, r.location_updated_at,
              ST_Y(r.last_geo::geometry) AS lat, ST_X(r.last_geo::geometry) AS lng
         FROM riders r WHERE r.business_id = $1 AND r.status = 'active'
        ORDER BY r.on_duty DESC, r.full_name`,
      [v.businessId],
    );
    const orders = rows.length
      ? await this.dataSource.query(
          `SELECT id, code, status, rider_id, rider_step FROM food_orders
            WHERE rider_id = ANY($1::uuid[]) AND status IN ('accepted', 'preparing', 'ready', 'on_the_way')
            ORDER BY created_at`,
          [rows.map((r: any) => r.id)],
        )
      : [];
    return {
      items: rows.map((r: any) => {
        const live = isLocationLive(r.location_updated_at, now);
        return {
          id: r.id,
          fullName: r.full_name,
          phone: r.phone,
          vehicle: r.vehicle,
          onDuty: r.on_duty,
          locationLive: live,
          location: live
            ? { lat: r.lat, lng: r.lng, at: r.location_updated_at }
            : null,
          lastSeenAt: r.location_updated_at,
          activeOrders: orders
            .filter((o: any) => o.rider_id === r.id)
            .map((o: any) => ({
              id: o.id,
              code: o.code,
              status: o.status,
              riderStep: o.rider_step,
            })),
        };
      }),
    };
  }

  async riderCash(v: VendorRef, riderId: string) {
    await this.ownRider(this.dataSource.manager, v, riderId);
    return this.cash(riderId);
  }

  /** The rider hands cash to the vendor: a negative entry; never more than they hold. */
  async handover(v: VendorRef, riderId: string, dto: HandoverDto) {
    await this.dataSource.transaction(async (m) => {
      await this.ownRider(m, v, riderId, true);
      const [{ balance }] = await m.query(
        `SELECT coalesce(sum(amount), 0)::int AS balance FROM rider_cash_ledger WHERE rider_id = $1`,
        [riderId],
      );
      if (dto.amount > balance)
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: `The rider holds ${rs(balance)}.`,
          details: { fields: { amount: [`at most ${balance}`] }, balance },
        });
      await m.query(
        `INSERT INTO rider_cash_ledger (rider_id, kind, amount, note, recorded_by) VALUES ($1, 'handover', $2, $3, $4)`,
        [riderId, -dto.amount, dto.note ?? null, v.ownerUserId],
      );
    });
    await this.audit.record({
      action: 'food.rider.handover',
      targetType: 'rider',
      targetId: riderId,
      details: { amount: dto.amount },
    });
    return this.cash(riderId);
  }

  // ── hooks ─────────────────────────────────────────────────────────────────

  /** COD delivered by a rider: the cash goes on their ledger (≤ the order total, by CHECK). */
  private async recordCod(m: EntityManager, o: FoodOrder, actor: FoodActor) {
    if (!o.riderId || o.paymentMethod !== 'cod' || !o.codCollected) return;
    await m.query(
      `INSERT INTO rider_cash_ledger (rider_id, order_id, kind, amount, recorded_by) VALUES ($1, $2, 'cod_collected', $3, $4)`,
      [o.riderId, o.id, o.codCollected, actor.userId],
    );
  }

  /** The rider card customers and vendors see on an order. */
  private async riderCard(o: FoodOrder) {
    if (!o.riderId) return null;
    const [r] = await this.dataSource.query(
      `SELECT full_name, phone, vehicle, location_updated_at,
              ST_Y(last_geo::geometry) AS lat, ST_X(last_geo::geometry) AS lng
         FROM riders WHERE id = $1`,
      [o.riderId],
    );
    if (!r) return null;
    const live = isLocationLive(r.location_updated_at);
    return {
      name: r.full_name,
      phone: r.phone,
      vehicle: r.vehicle,
      step: o.riderStep,
      locationLive: live,
      lastGeo: live && r.lat !== null ? { lat: r.lat, lng: r.lng } : null,
      at: r.location_updated_at,
    };
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private async step(
    r: RiderRef,
    id: string,
    to: RiderStep,
    work: (
      m: EntityManager,
      o: FoodOrder,
      actor: FoodActor,
    ) => Promise<FoodNotice[]>,
    note: string | null = null,
  ) {
    const notices = await this.dataSource.transaction(async (m) => {
      const o = await this.transitions.lock(m, { id, riderId: r.id });
      const from = (o.riderStep ?? 'assigned') as RiderStep;
      RIDER_STEP.assert(from, to);
      const actor: FoodActor = { role: 'rider', userId: r.userId };
      const out = await work(m, o, actor);
      if (to !== 'declined')
        await m.query(
          `UPDATE food_orders SET rider_step = $2, updated_at = now() WHERE id = $1`,
          [o.id, to],
        );
      await this.transitions.riderEvent(m, o.id, to, actor, note);
      return out;
    });
    await this.notifier.send(notices);
    await this.notifier.changed(id);
    if (to === 'declined') return { declined: true, orderId: id };
    return this.order(r, id);
  }

  private async release(m: EntityManager, riderId: string) {
    await m.query(
      `UPDATE riders SET active_order_count = GREATEST(active_order_count - 1, 0), updated_at = now() WHERE id = $1`,
      [riderId],
    );
  }

  private async ownRider(
    m: EntityManager,
    v: VendorRef,
    riderId: string,
    lock = false,
  ) {
    const [r] = await m.query(
      `SELECT id FROM riders WHERE id = $1 AND business_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [riderId, v.businessId],
    );
    if (!r) throw riderNotFound();
  }

  private orderNotFound() {
    return new NotFoundException({
      code: ErrorCode.NOT_FOUND,
      message: 'Order not found.',
    });
  }

  /** What a rider needs: where to collect, where to drop, what to collect. */
  private async riderView(o: FoodOrder) {
    const [b] = await this.dataSource.query(
      `SELECT fb.name, br.phone, br.address_line, br.area, br.city,
              ST_Y(br.geo::geometry) AS lat, ST_X(br.geo::geometry) AS lng
         FROM branches br JOIN food_brands fb ON fb.id = br.brand_id WHERE br.id = $1`,
      [o.branchId],
    );
    const items = await this.dataSource.manager.find(FoodOrderItem, {
      where: { orderId: o.id },
      order: { lineNo: 'ASC' },
    });
    const a = o.addressSnapshot;
    const step = o.riderStep;
    return {
      id: o.id,
      code: o.code,
      status: o.status,
      statusLabel: STATUS_LABEL[o.status],
      riderStep: step,
      nextSteps:
        step && RIDER_ACTIVE.includes(o.status)
          ? RIDER_STEP.allowed(step).filter(
              (s) => s !== 'picked_up' || o.status === 'ready',
            )
          : [],
      pickup: {
        name: b.name,
        phone: b.phone,
        addressLine: b.address_line,
        area: b.area,
        city: b.city,
        lat: b.lat,
        lng: b.lng,
      },
      drop: a
        ? {
            name: a.fullName,
            phone: a.phone,
            line1: a.line1,
            area: a.area,
            city: a.city,
            landmark: a.landmark,
            building: a.building,
            floor: a.floor,
            riderInstructions: a.riderInstructions,
            lat: a.lat,
            lng: a.lng,
          }
        : null,
      items: items.map((i) => ({
        name: i.itemName,
        variant: i.variantName,
        options: i.options.map((x) => x.name),
        quantity: i.quantity,
      })),
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
      cutlery: o.cutlery,
      note: o.customerNote,
      payment: { method: o.paymentMethod, status: o.paymentStatus },
      total: o.total,
      cashToCollect:
        o.paymentMethod === 'cod' && o.paymentStatus === 'cod_pending'
          ? o.total
          : 0,
      codCollected: o.codCollected,
      readyAt: o.readyAt,
      promisedAt: o.promisedAt,
    };
  }

  private async toVendor(
    o: FoodOrder,
    title: string,
    body: string,
  ): Promise<FoodNotice> {
    return {
      userId: await this.notifier.ownerOf(o.branchId),
      payload: {
        type: 'food.rider.update',
        title,
        body,
        data: { orderId: o.id, code: o.code },
      },
    };
  }

  private toCustomer(
    o: FoodOrder,
    type: string,
    title: string,
    body: string,
  ): FoodNotice {
    return {
      userId: o.userId,
      payload: {
        type,
        title,
        body,
        data: { orderId: o.id, code: o.code, screen: 'food.order' },
      },
    };
  }
}
