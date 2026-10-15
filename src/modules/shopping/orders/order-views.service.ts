import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrderGroup } from './entities/order-group.entity';
import { StoreOrder } from './entities/store-order.entity';
import { StoreOrderItem } from './entities/store-order-item.entity';
import { StoreOrderEvent } from './entities/store-order-event.entity';
import { ORDER_BUCKETS, allowedOrderMoves } from './order-status';
import { CustomerOrderQueryDto, PartnerOrderQueryDto } from './dto/order.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { SqlParams, likeEscape } from '../common/catalog-sql';

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Order not found.',
  });

export interface StoreBrief {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
}

const itemView = (i: StoreOrderItem) => ({
  id: i.id,
  productId: i.productId,
  variantId: i.variantId,
  productName: i.productName,
  variantLabel: i.variantLabel,
  imageUrl: i.imageUrl,
  unitPrice: i.unitPrice,
  quantity: i.quantity,
  lineTotal: i.lineTotal,
  returnedQty: i.returnedQty,
});

const eventView = (e: StoreOrderEvent) => ({
  kind: e.kind,
  from: e.from,
  to: e.to,
  actorRole: e.actorRole,
  note: e.note,
  at: e.at,
});

const DAY_MS = 86_400_000;

/** Fields both audiences see on a store order. */
function storeOrderCore(
  o: StoreOrder,
  items: StoreOrderItem[],
  events: StoreOrderEvent[],
) {
  return {
    id: o.id,
    code: o.code,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    subtotal: o.subtotal,
    discount: o.discount,
    couponCode: o.couponCode,
    shippingFee: o.shippingFee,
    total: o.total,
    customerNote: o.customerNote,
    items: items.map(itemView),
    payment: {
      method: o.paymentMethod,
      status: o.paymentStatus,
      payBy: o.payBy,
      paidAt: o.paidAt,
      paymentRef: o.paymentRef,
      proofUrl: o.paymentProofUrl,
      rejectedReason: o.paymentRejectedReason,
      // Where to send the money: the store's own accounts, as at checkout.
      accounts: o.paymentAccountSnapshot,
      refundAmount: o.refundAmount,
      refundRef: o.refundRef,
      refundedAt: o.refundedAt,
    },
    shipping: {
      courierName: o.courierName,
      trackingRef: o.trackingRef,
      riderName: o.riderName,
      riderPhone: o.riderPhone,
    },
    cancelReason: o.cancelReason,
    cancelledBy: o.cancelledBy,
    cancelRequestedAt: o.cancelRequestedAt,
    returnWindowDays: o.returnWindowDays,
    returnDeadline: o.deliveredAt
      ? new Date(o.deliveredAt.getTime() + o.returnWindowDays * DAY_MS)
      : null,
    placedAt: o.createdAt,
    confirmedAt: o.confirmedAt,
    packedAt: o.packedAt,
    shippedAt: o.shippedAt,
    deliveredAt: o.deliveredAt,
    completedAt: o.completedAt,
    cancelledAt: o.cancelledAt,
    events: events.map(eventView),
  };
}

/**
 * Read models for orders. Customers see their groups with payment
 * instructions; stores see their own store orders with the customer's
 * delivery contact (from the address snapshot) — never other stores' parts.
 */
@Injectable()
export class OrderViewsService {
  constructor(private readonly dataSource: DataSource) {}

  private async details(orderIds: string[]) {
    const m = this.dataSource.manager;
    const [items, events] = await Promise.all([
      orderIds.length
        ? m.find(StoreOrderItem, {
            where: { storeOrderId: In(orderIds) },
            order: { createdAt: 'ASC', id: 'ASC' },
          })
        : [],
      orderIds.length
        ? m.find(StoreOrderEvent, {
            where: { storeOrderId: In(orderIds) },
            order: { at: 'ASC', id: 'ASC' },
          })
        : [],
    ]);
    const by = <T extends { storeOrderId: string }>(rows: T[], id: string) =>
      rows.filter((r) => r.storeOrderId === id);
    return {
      items: (id: string) => by(items, id),
      events: (id: string) => by(events, id),
    };
  }

  private async stores(storeIds: string[]): Promise<Map<string, StoreBrief>> {
    if (!storeIds.length) return new Map();
    const rows = await this.dataSource.query(
      `SELECT s.id, s.slug, b.name, s.logo_url FROM stores s JOIN businesses b ON b.id = s.business_id
        WHERE s.id = ANY($1::uuid[])`,
      [storeIds],
    );
    return new Map(
      rows.map((r: any) => [
        r.id,
        { id: r.id, slug: r.slug, name: r.name, logoUrl: r.logo_url },
      ]),
    );
  }

  // ── Customer ──────────────────────────────────────────────────────────────

  private customerActions(o: StoreOrder) {
    return {
      cancel: allowedOrderMoves(o.status, 'customer').includes('cancelled'),
      requestCancel:
        (o.status === 'confirmed' || o.status === 'packed') &&
        !o.cancelRequestedAt,
      submitPaymentProof:
        o.paymentMethod === 'transfer' &&
        o.paymentStatus === 'awaiting_transfer' &&
        o.status !== 'cancelled',
      markReceived: o.status === 'shipped',
    };
  }

  async customerGroup(userId: string, code: string) {
    const group = await this.dataSource.manager.findOne(OrderGroup, {
      where: { code: code.toUpperCase(), userId },
    });
    if (!group) throw notFound();
    const orders = await this.dataSource.manager.find(StoreOrder, {
      where: { groupId: group.id },
      order: { code: 'ASC' },
    });
    const [d, stores] = await Promise.all([
      this.details(orders.map((o) => o.id)),
      this.stores(orders.map((o) => o.storeId)),
    ]);
    return {
      id: group.id,
      code: group.code,
      placedAt: group.placedAt,
      address: group.addressSnapshot,
      itemsTotal: group.itemsTotal,
      discountTotal: group.discountTotal,
      shippingTotal: group.shippingTotal,
      grandTotal: group.grandTotal,
      storeOrders: orders.map((o) => ({
        ...storeOrderCore(o, d.items(o.id), d.events(o.id)),
        store: stores.get(o.storeId),
        can: this.customerActions(o),
      })),
    };
  }

  async customerStoreOrder(userId: string, id: string) {
    const o = await this.dataSource.manager.findOne(StoreOrder, {
      where: { id, userId },
    });
    if (!o) throw notFound();
    const group = await this.dataSource.manager.findOneByOrFail(OrderGroup, {
      id: o.groupId,
    });
    const [d, stores] = await Promise.all([
      this.details([o.id]),
      this.stores([o.storeId]),
    ]);
    return {
      ...storeOrderCore(o, d.items(o.id), d.events(o.id)),
      groupCode: group.code,
      store: stores.get(o.storeId),
      can: this.customerActions(o),
    };
  }

  /** Order groups, newest first; ?status matches a group by any of its store orders. */
  async customerGroups(userId: string, q: CustomerOrderQueryDto) {
    const params = new SqlParams();
    const where = [`g.user_id = ${params.add(userId)}`];
    if (q.status) {
      where.push(
        `EXISTS (SELECT 1 FROM store_orders so WHERE so.group_id = g.id AND so.status = ANY(${params.add(
          [...ORDER_BUCKETS[q.status]],
        )}::store_order_status[]))`,
      );
    }
    const whereSql = where.join(' AND ');
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM order_groups g WHERE ${whereSql}`,
      params.values,
    );
    const ids: Array<{ id: string }> = await this.dataSource.query(
      `SELECT g.id FROM order_groups g WHERE ${whereSql}
        ORDER BY g.placed_at DESC, g.id
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    const loaded = ids.length
      ? await this.dataSource.manager.find(OrderGroup, {
          where: { id: In(ids.map((r) => r.id)) },
        })
      : [];
    const byId = new Map(loaded.map((g) => [g.id, g]));
    const groups = ids.map((r) => byId.get(r.id)!);
    const orders = groups.length
      ? await this.dataSource.manager.find(StoreOrder, {
          where: { groupId: In(groups.map((g) => g.id)) },
          order: { code: 'ASC' },
        })
      : [];
    const [d, stores] = await Promise.all([
      this.details(orders.map((o) => o.id)),
      this.stores(orders.map((o) => o.storeId)),
    ]);
    return paged(
      groups.map((g) => ({
        id: g.id,
        code: g.code,
        placedAt: g.placedAt,
        grandTotal: g.grandTotal,
        storeOrders: orders
          .filter((o) => o.groupId === g.id)
          .map((o) => {
            const items = d.items(o.id);
            return {
              id: o.id,
              code: o.code,
              store: stores.get(o.storeId),
              status: o.status,
              paymentMethod: o.paymentMethod,
              paymentStatus: o.paymentStatus,
              total: o.total,
              itemCount: items.reduce((n, i) => n + i.quantity, 0),
              coverImageUrl: items[0]?.imageUrl ?? null,
            };
          }),
      })),
      total,
      q,
    );
  }

  // ── Store partner ─────────────────────────────────────────────────────────

  async partnerList(storeId: string, q: PartnerOrderQueryDto) {
    const params = new SqlParams();
    const where = [`so.store_id = ${params.add(storeId)}`];
    if (q.status) where.push(`so.status = ${params.add(q.status)}`);
    if (q.paymentStatus)
      where.push(`so.payment_status = ${params.add(q.paymentStatus)}`);
    if (q.q) {
      const like = params.add(`%${likeEscape(q.q)}%`);
      where.push(
        `(so.code ILIKE ${like} OR g.address_snapshot->>'fullName' ILIKE ${like} OR g.address_snapshot->>'phone' ILIKE ${like})`,
      );
    }
    const whereSql = where.join(' AND ');
    const from = `FROM store_orders so JOIN order_groups g ON g.id = so.group_id WHERE ${whereSql}`;
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total ${from}`,
      params.values,
    );
    const rows = await this.dataSource.query(
      `SELECT so.id, so.code, so.status, so.payment_method, so.payment_status, so.total, so.pay_by,
              so.created_at, so.cancel_requested_at,
              g.address_snapshot->>'fullName' AS customer_name, g.address_snapshot->>'city' AS city,
              (SELECT coalesce(sum(i.quantity), 0)::int FROM store_order_items i WHERE i.store_order_id = so.id) AS item_count
         ${from}
        ORDER BY so.created_at DESC, so.id
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    return paged(
      rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        paymentMethod: r.payment_method,
        paymentStatus: r.payment_status,
        total: r.total,
        itemCount: r.item_count,
        customerName: r.customer_name,
        city: r.city,
        payBy: r.pay_by,
        cancelRequested: r.cancel_requested_at !== null,
        placedAt: r.created_at,
      })),
      total,
      q,
    );
  }

  async partnerOrder(storeId: string, id: string) {
    const o = await this.dataSource.manager.findOne(StoreOrder, {
      where: { id, storeId },
    });
    if (!o) throw notFound();
    const group = await this.dataSource.manager.findOneByOrFail(OrderGroup, {
      id: o.groupId,
    });
    const d = await this.details([o.id]);
    const a = group.addressSnapshot;
    return {
      ...storeOrderCore(o, d.items(o.id), d.events(o.id)),
      groupCode: group.code,
      // What the store needs to deliver — nothing more about the customer.
      customer: {
        name: a.fullName,
        phone: a.phone,
        address: {
          city: a.city,
          area: a.area,
          line1: a.line1,
          landmark: a.landmark,
          lat: a.lat,
          lng: a.lng,
        },
      },
      can: {
        moveTo: allowedOrderMoves(o.status, 'store'),
      },
    };
  }
}
