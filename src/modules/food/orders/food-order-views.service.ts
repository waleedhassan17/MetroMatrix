import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FoodOrder } from './entities/food-order.entity';
import { FoodOrderItem } from './entities/food-order-item.entity';
import { FoodOrderEvent } from './entities/food-order-event.entity';
import { ACTIVE_STATUSES, STATUS_LABEL, TERMINAL } from './food-order-status';
import { orderNotFound } from './food-order-transitions.service';
import { CustomerFoodOrdersQueryDto } from './dto/order-query.dto';
import { paged } from '../../../common/pagination/pagination';
import { formatTime12, toZonedIso } from '../../../common/time/time.util';

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

/** What to do to pay, in words. */
export function paymentInstructions(o: FoodOrder, tz: string): string | null {
  if (o.paymentStatus === 'paid') return null;
  switch (o.paymentMethod) {
    case 'cod':
      return `Pay ${rs(o.total)} in cash when your order arrives.`;
    case 'pay_at_pickup':
      return `Pay ${rs(o.total)} at the counter when you collect.`;
    case 'transfer':
      return o.paymentStatus === 'proof_submitted'
        ? 'Waiting for the vendor to confirm your transfer.'
        : `Transfer ${rs(o.total)} to one of the vendor’s accounts${o.payBy ? ` by ${formatTime12(o.payBy, tz)}` : ''}, then upload the receipt.`;
  }
}

/**
 * Order views for each side. Every money line is shown; the only fee is the
 * vendor's delivery fee.
 */
@Injectable()
export class FoodOrderViewsService {
  /** Filled in by reviews (P7). */
  canReview: (order: FoodOrder) => Promise<boolean> = async () => false;
  /** Filled in by riders (P6): the rider card on an order. */
  riderCard: (order: FoodOrder) => Promise<unknown> = async () => null;

  constructor(private readonly dataSource: DataSource) {}

  async customer(userId: string, code: string) {
    const o = await this.dataSource.manager.findOne(FoodOrder, {
      where: { code, userId },
    });
    if (!o) throw orderNotFound();
    return this.detail(o, 'customer');
  }

  async customerList(userId: string, q: CustomerFoodOrdersQueryDto) {
    const qb = this.dataSource
      .getRepository(FoodOrder)
      .createQueryBuilder('o')
      .where('o.user_id = :userId', { userId });
    if (q.status === 'active')
      qb.andWhere('o.status IN (:...s)', { s: ACTIVE_STATUSES });
    if (q.status === 'past')
      qb.andWhere('o.status IN (:...s)', { s: TERMINAL });
    const [rows, total] = await qb
      .orderBy('o.createdAt', 'DESC')
      .addOrderBy('o.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    const brands = await this.brands(rows.map((r) => r.brandId));
    const counts = rows.length
      ? await this.dataSource.query(
          `SELECT order_id, sum(quantity)::int AS n FROM food_order_items WHERE order_id = ANY($1::uuid[]) GROUP BY order_id`,
          [rows.map((r) => r.id)],
        )
      : [];
    return paged(
      rows.map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        statusLabel: STATUS_LABEL[o.status],
        fulfilment: o.fulfilment,
        vendor: brands.get(o.brandId) ?? null,
        itemCount: counts.find((c: any) => c.order_id === o.id)?.n ?? 0,
        total: o.total,
        placedAt: o.createdAt,
        scheduledFor: o.scheduledFor,
      })),
      total,
      q,
    );
  }

  /** The full order: lines, money, payment, events, and what the viewer may do next. */
  async detail(
    o: FoodOrder,
    viewer: 'customer' | 'vendor' | 'rider' | 'admin',
  ) {
    const [items, events, [branch]] = await Promise.all([
      this.dataSource.manager.find(FoodOrderItem, {
        where: { orderId: o.id },
        order: { lineNo: 'ASC' },
      }),
      this.dataSource.manager.find(FoodOrderEvent, {
        where: { orderId: o.id },
        order: { seq: 'ASC' },
      }),
      this.dataSource.query(
        `SELECT br.timezone, br.phone, br.address_line, br.area, br.city,
                ST_Y(br.geo::geometry) AS lat, ST_X(br.geo::geometry) AS lng
           FROM branches br WHERE br.id = $1`,
        [o.branchId],
      ),
    ]);
    const vendor = (await this.brands([o.brandId])).get(o.brandId);
    const tz = branch.timezone;
    const ended = TERMINAL.includes(o.status);
    return {
      id: o.id,
      code: o.code,
      status: o.status,
      statusLabel: STATUS_LABEL[o.status],
      fulfilment: o.fulfilment,
      scheduledFor: o.scheduledFor ? toZonedIso(o.scheduledFor, tz) : null,
      placedAt: o.createdAt,
      acceptBy: o.status === 'placed' ? o.acceptBy : null,
      vendor: {
        ...vendor,
        phone: branch.phone,
        location: {
          addressLine: branch.address_line,
          area: branch.area,
          city: branch.city,
          lat: branch.lat,
          lng: branch.lng,
        },
      },
      items: items.map((i) => ({
        id: i.id,
        itemId: i.itemId,
        name: i.itemName,
        variant: i.variantName,
        options: i.options.map((x) => ({
          name: x.name,
          group: x.group,
          priceDelta: x.priceDelta,
        })),
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
        notes: i.notes,
      })),
      totals: {
        subtotal: o.subtotal,
        discount: o.discount,
        deliveryFee: o.deliveryFee,
        total: o.total,
      },
      deal: o.promotionSnapshot,
      payment: {
        method: o.paymentMethod,
        status: o.paymentStatus,
        payBy: o.paymentStatus === 'awaiting_transfer' ? o.payBy : null,
        accounts:
          o.paymentMethod === 'transfer' ? o.paymentAccountSnapshot : null,
        reference: o.paymentRef,
        proofUrl: o.paymentProofUrl,
        rejectedReason: o.paymentRejectedReason,
        instructions:
          ended && o.status !== 'delivered' && o.status !== 'picked_up'
            ? null
            : paymentInstructions(o, tz),
      },
      address: o.addressSnapshot,
      distanceKm:
        o.distanceM === null ? null : Math.round(o.distanceM / 100) / 10,
      cutlery: o.cutlery,
      note: o.customerNote,
      eta: {
        minutes: o.etaMinutes,
        promisedAt: o.promisedAt,
      },
      rider: await this.riderCard(o),
      handedToExternal: o.handedToExternal,
      codCollected: viewer === 'customer' ? undefined : o.codCollected,
      cancelledBy: o.cancelledBy,
      cancelReason: o.cancelReason,
      timestamps: {
        acceptedAt: o.acceptedAt,
        preparingAt: o.preparingAt,
        readyAt: o.readyAt,
        pickedUpAt: o.pickedUpAt,
        deliveredAt: o.deliveredAt,
        cancelledAt: o.cancelledAt,
      },
      events: events.map((e) => ({
        kind: e.kind,
        from: e.from,
        to: e.to,
        actorRole: e.actorRole,
        note: e.note,
        at: e.createdAt,
      })),
      canCancel: viewer === 'customer' && o.status === 'placed',
      canReview: viewer === 'customer' && (await this.canReview(o)),
      canReorder: viewer === 'customer' && ended,
    };
  }

  private async brands(ids: string[]) {
    const out = new Map<
      string,
      { id: string; name: string; slug: string; logoUrl: string | null }
    >();
    if (!ids.length) return out;
    const rows = await this.dataSource.query(
      `SELECT id, name, slug, logo_url FROM food_brands WHERE id = ANY($1::uuid[])`,
      [[...new Set(ids)]],
    );
    for (const r of rows)
      out.set(r.id, {
        id: r.id,
        name: r.name,
        slug: r.slug,
        logoUrl: r.logo_url,
      });
    return out;
  }
}
