import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { ReturnRequest } from './entities/return-request.entity';
import { ReturnRequestItem } from './entities/return-request-item.entity';
import {
  OPEN_RETURN_STATUSES,
  ReturnStatus,
  assertTransition,
} from './return-status';
import {
  ApproveReturnDto,
  CreateReturnDto,
  ReceiveReturnDto,
  ReturnQueryDto,
  ReturnRefundDto,
} from './dto/return.dto';
import { StoreOrder } from '../orders/entities/store-order.entity';
import { StoreOrderItem } from '../orders/entities/store-order-item.entity';
import { OrderTransitionsService } from '../orders/order-transitions.service';
import { InventoryService } from '../inventory/inventory.service';
import { invalidTransition } from '../common/transitions';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { MediaService } from '../../media/media.service';
import {
  NotificationsService,
  NotifyPayload,
} from '../../notifications/notifications.service';

const DAY_MS = 86_400_000;

const notFound = (what = 'Return') =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

const invalid = (message: string, details?: Record<string, unknown>) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details,
  });

type Notice = { userId: string; payload: NotifyPayload };

/**
 * Returns: a customer asks (delivered, inside the store's return window, one
 * open request per order); the store approves or rejects, receives the goods
 * — restocking line by line through InventoryService (`return_restock`) — and
 * records the refund it sent. Stock goes back exactly once: at receive.
 */
@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: OrderTransitionsService,
    private readonly inventory: InventoryService,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Customer ──────────────────────────────────────────────────────────────

  async create(userId: string, storeOrderId: string, dto: CreateReturnDto) {
    const { id, notices } = await this.dataSource.transaction(async (m) => {
      const order = await this.transitions.lock(m, {
        id: storeOrderId,
        userId,
      });
      if (order.status !== 'delivered' && order.status !== 'completed') {
        throw invalidTransition(
          order.status,
          'return_requested',
          [],
          'You can return items once the order is delivered.',
        );
      }
      const closesAt = order.deliveredAt
        ? new Date(
            order.deliveredAt.getTime() + order.returnWindowDays * DAY_MS,
          )
        : null;
      if (order.status === 'completed' || !closesAt || closesAt <= new Date()) {
        throw new BadRequestException({
          code: ErrorCode.RETURN_WINDOW_CLOSED,
          message:
            order.returnWindowDays === 0
              ? 'This store does not accept returns.'
              : `Returns for this order closed on ${closesAt?.toISOString().slice(0, 10)}.`,
          details: {
            deliveredAt: order.deliveredAt,
            returnWindowDays: order.returnWindowDays,
            closedAt: closesAt,
          },
        });
      }
      const open = await m.exists(ReturnRequest, {
        where: { storeOrderId, status: In([...OPEN_RETURN_STATUSES]) },
      });
      if (open) throw this.alreadyOpen();

      const ids = dto.items.map((i) => i.orderItemId);
      if (new Set(ids).size !== ids.length)
        throw invalid('List each item once.');
      const lines = await m.find(StoreOrderItem, {
        where: { id: In(ids), storeOrderId },
      });
      if (lines.length !== ids.length) throw notFound('Order item');
      const byId = new Map(lines.map((l) => [l.id, l]));
      for (const i of dto.items) {
        const line = byId.get(i.orderItemId)!;
        const left = line.quantity - line.returnedQty;
        if (i.quantity > left) {
          throw invalid(
            `Only ${left} of "${line.productName}" can still be returned.`,
            {
              orderItemId: line.id,
              returnable: left,
            },
          );
        }
      }
      const photos = dto.photos ?? [];
      photos.forEach((url, n) =>
        this.media.assertOwnedAsset(
          userId,
          'return_photo',
          url,
          undefined,
          `photos.${n}`,
        ),
      );

      let saved: ReturnRequest;
      try {
        saved = await m.save(
          m.create(ReturnRequest, {
            storeOrderId,
            storeId: order.storeId,
            userId,
            reason: dto.reason,
            details: dto.details ?? null,
            photos,
          }),
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw this.alreadyOpen();
        throw err;
      }
      await m.insert(
        ReturnRequestItem,
        dto.items.map((i) => ({
          returnRequestId: saved.id,
          storeOrderItemId: i.orderItemId,
          quantity: i.quantity,
        })),
      );
      const units = dto.items.reduce((n, i) => n + i.quantity, 0);
      await this.transitions.note(
        m,
        order.id,
        { role: 'customer', userId },
        `Return requested: ${units} item(s), ${dto.reason}`,
      );
      return {
        id: saved.id,
        notices: [
          await this.toStore(
            m,
            order,
            'shop.return.requested',
            `${order.code}: return requested`,
            `${units} item(s) · ${dto.reason.replace(/_/g, ' ')}`,
          ),
        ],
      };
    });
    await this.send(notices);
    return this.customerGet(userId, id);
  }

  async customerList(userId: string, q: ReturnQueryDto) {
    return this.list({ userId, ...(q.status ? { status: q.status } : {}) }, q);
  }

  async customerGet(userId: string, id: string) {
    const r = await this.dataSource.manager.findOne(ReturnRequest, {
      where: { id, userId },
    });
    if (!r) throw notFound();
    return (await this.views([r]))[0];
  }

  // ── Store partner ─────────────────────────────────────────────────────────

  async partnerList(storeId: string, q: ReturnQueryDto) {
    return this.list({ storeId, ...(q.status ? { status: q.status } : {}) }, q);
  }

  async partnerGet(storeId: string, id: string) {
    const r = await this.dataSource.manager.findOne(ReturnRequest, {
      where: { id, storeId },
    });
    if (!r) throw notFound();
    return (await this.views([r], true))[0];
  }

  approve(storeId: string, ownerId: string, id: string, dto: ApproveReturnDto) {
    return this.asStore(storeId, ownerId, id, async (m, r, order) => {
      await this.move(m, r, 'approved', {
        storeNote: dto.note ?? null,
        decidedAt: new Date(),
      });
      return [
        this.toCustomer(
          r,
          order,
          'shop.return.approved',
          `${order.code}: return approved`,
          dto.note ?? 'Send the items back to the store.',
        ),
      ];
    });
  }

  reject(storeId: string, ownerId: string, id: string, note: string) {
    return this.asStore(storeId, ownerId, id, async (m, r, order) => {
      await this.move(m, r, 'rejected', {
        storeNote: note,
        decidedAt: new Date(),
      });
      return [
        this.toCustomer(
          r,
          order,
          'shop.return.rejected',
          `${order.code}: return declined`,
          note,
        ),
      ];
    });
  }

  /** The goods are back: count them as returned and restock the flagged lines. */
  receive(storeId: string, ownerId: string, id: string, dto: ReceiveReturnDto) {
    return this.asStore(storeId, ownerId, id, async (m, r, order) => {
      assertTransition(r.status, 'received');
      const items = await m.find(ReturnRequestItem, {
        where: { returnRequestId: r.id },
      });
      const flags = new Map(
        (dto.items ?? []).map((i) => [i.returnItemId, i.restock]),
      );
      for (const key of flags.keys()) {
        if (!items.some((i) => i.id === key)) throw notFound('Return item');
      }
      const lines = await m.find(StoreOrderItem, {
        where: { id: In(items.map((i) => i.storeOrderItemId)) },
      });
      const lineOf = new Map(lines.map((l) => [l.id, l]));
      const restock: Array<{ variantId: string; delta: number }> = [];
      for (const item of items) {
        const restocked = flags.get(item.id) ?? false;
        await m.update(ReturnRequestItem, { id: item.id }, { restocked });
        await m.query(
          `UPDATE store_order_items SET returned_qty = returned_qty + $2, updated_at = now() WHERE id = $1`,
          [item.storeOrderItemId, item.quantity],
        );
        if (restocked)
          restock.push({
            variantId: lineOf.get(item.storeOrderItemId)!.variantId,
            delta: item.quantity,
          });
      }
      if (restock.length) {
        await this.inventory.apply(m, restock, {
          reason: 'return_restock',
          refType: 'return_request',
          refId: r.id,
          actorUserId: ownerId,
        });
      }
      await this.move(m, r, 'received', { receivedAt: new Date() });
      await this.transitions.note(
        m,
        order.id,
        { role: 'store', userId: ownerId },
        'Returned items received',
      );
      return [];
    });
  }

  /** Record the refund the store sent (off-platform), capped at the returned lines' value. */
  refund(storeId: string, ownerId: string, id: string, dto: ReturnRefundDto) {
    return this.asStore(storeId, ownerId, id, async (m, r, order) => {
      assertTransition(r.status, 'refunded');
      const [{ value }] = await m.query(
        `SELECT coalesce(sum(i.unit_price * ri.quantity), 0)::int AS value
           FROM return_request_items ri JOIN store_order_items i ON i.id = ri.store_order_item_id
          WHERE ri.return_request_id = $1`,
        [r.id],
      );
      if (dto.amount > value) {
        throw invalid(
          `The refund cannot exceed the returned items' value (Rs ${value}).`,
          {
            fields: { amount: [`at most ${value}`] },
          },
        );
      }
      await this.move(m, r, 'refunded', {
        refundAmount: dto.amount,
        refundRef: dto.refundRef,
        refundedAt: new Date(),
      });
      await this.transitions.note(
        m,
        order.id,
        { role: 'store', userId: ownerId },
        `Return refunded: Rs ${dto.amount} (${dto.refundRef})`,
      );
      return [
        this.toCustomer(
          r,
          order,
          'shop.return.refunded',
          `${order.code}: refund sent`,
          `Rs ${dto.amount} · ref ${dto.refundRef}`,
        ),
      ];
    });
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private alreadyOpen() {
    return new ConflictException({
      code: ErrorCode.RETURN_ALREADY_OPEN,
      message: 'There is already a return in progress for this order.',
    });
  }

  private async move(
    m: EntityManager,
    r: ReturnRequest,
    to: ReturnStatus,
    patch: Partial<ReturnRequest>,
  ) {
    assertTransition(r.status, to);
    const res = await m
      .createQueryBuilder()
      .update(ReturnRequest)
      .set({ ...patch, status: to })
      .where({ id: r.id, status: r.status })
      .execute();
    if (res.affected !== 1)
      throw invalidTransition(
        r.status,
        to,
        [],
        'This return just changed — refresh and try again.',
      );
    Object.assign(r, patch, { status: to });
  }

  private async asStore(
    storeId: string,
    ownerId: string,
    id: string,
    work: (
      m: EntityManager,
      r: ReturnRequest,
      order: StoreOrder,
    ) => Promise<Notice[]>,
  ) {
    const notices = await this.dataSource.transaction(async (m) => {
      const r = await m.findOne(ReturnRequest, {
        where: { id, storeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!r) throw notFound();
      const order = await m.findOneByOrFail(StoreOrder, { id: r.storeOrderId });
      return work(m, r, order);
    });
    await this.send(notices);
    return this.partnerGet(storeId, id);
  }

  private async list(
    where: Partial<Pick<ReturnRequest, 'userId' | 'storeId' | 'status'>>,
    q: ReturnQueryDto,
  ) {
    const [rows, total] = await this.dataSource.manager.findAndCount(
      ReturnRequest,
      {
        where,
        order: { createdAt: 'DESC', id: 'ASC' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      },
    );
    return paged(await this.views(rows, where.storeId !== undefined), total, q);
  }

  private async views(rows: ReturnRequest[], forStore = false) {
    if (!rows.length) return [];
    const m = this.dataSource.manager;
    const items = await m.find(ReturnRequestItem, {
      where: { returnRequestId: In(rows.map((r) => r.id)) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const lines = items.length
      ? await m.find(StoreOrderItem, {
          where: { id: In(items.map((i) => i.storeOrderItemId)) },
        })
      : [];
    const lineOf = new Map(lines.map((l) => [l.id, l]));
    const orders = await m.find(StoreOrder, {
      where: { id: In(rows.map((r) => r.storeOrderId)) },
    });
    const orderOf = new Map(orders.map((o) => [o.id, o]));
    const meta: Array<{
      id: string;
      store_name: string;
      customer_name: string | null;
    }> = await m.query(
      `SELECT r.id, b.name AS store_name, g.address_snapshot->>'fullName' AS customer_name
         FROM return_requests r
         JOIN stores s ON s.id = r.store_id JOIN businesses b ON b.id = s.business_id
         JOIN store_orders so ON so.id = r.store_order_id JOIN order_groups g ON g.id = so.group_id
        WHERE r.id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)],
    );
    const metaOf = new Map(meta.map((x) => [x.id, x]));
    return rows.map((r) => {
      const mine = items
        .filter((i) => i.returnRequestId === r.id)
        .sort(
          (x, y) =>
            lineOf.get(x.storeOrderItemId)!.lineNo -
            lineOf.get(y.storeOrderItemId)!.lineNo,
        )
        .map((i) => {
          const l = lineOf.get(i.storeOrderItemId)!;
          return {
            id: i.id,
            orderItemId: l.id,
            productName: l.productName,
            variantLabel: l.variantLabel,
            imageUrl: l.imageUrl,
            unitPrice: l.unitPrice,
            quantity: i.quantity,
            restocked: i.restocked,
          };
        });
      return {
        id: r.id,
        storeOrderId: r.storeOrderId,
        storeOrderCode: orderOf.get(r.storeOrderId)?.code,
        store: { id: r.storeId, name: metaOf.get(r.id)?.store_name },
        ...(forStore ? { customerName: metaOf.get(r.id)?.customer_name } : {}),
        status: r.status,
        reason: r.reason,
        details: r.details,
        photos: r.photos,
        storeNote: r.storeNote,
        items: mine,
        value: mine.reduce((n, i) => n + i.unitPrice * i.quantity, 0),
        refundAmount: r.refundAmount,
        refundRef: r.refundRef,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        receivedAt: r.receivedAt,
        refundedAt: r.refundedAt,
      };
    });
  }

  private async toStore(
    m: EntityManager,
    order: StoreOrder,
    type: string,
    title: string,
    body: string,
  ): Promise<Notice> {
    const [row] = await m.query(
      `SELECT b.owner_user_id FROM stores s JOIN businesses b ON b.id = s.business_id WHERE s.id = $1`,
      [order.storeId],
    );
    return {
      userId: row.owner_user_id,
      payload: {
        type,
        title,
        body,
        data: { storeOrderId: order.id, code: order.code },
      },
    };
  }

  private toCustomer(
    r: ReturnRequest,
    order: StoreOrder,
    type: string,
    title: string,
    body: string,
  ): Notice {
    return {
      userId: r.userId,
      payload: {
        type,
        title,
        body,
        data: { returnId: r.id, storeOrderId: order.id, code: order.code },
      },
    };
  }

  private async send(notices: Notice[]) {
    for (const n of notices) {
      try {
        await this.notifications.notify(n.userId, n.payload);
      } catch (err) {
        this.logger.warn(`notification failed: ${(err as Error).message}`);
      }
    }
  }
}
