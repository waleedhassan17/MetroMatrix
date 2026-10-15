import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { StoreOrder } from './entities/store-order.entity';
import { Actor, OrderTransitionsService } from './order-transitions.service';
import { OrderViewsService } from './order-views.service';
import { PaymentProofDto, RefundDto, ShipOrderDto } from './dto/order.dto';
import { invalidTransition } from '../common/transitions';
import { assertOrderTransition } from './order-status';
import { ErrorCode } from '../../../common/errors/codes';
import {
  NotificationsService,
  NotifyPayload,
} from '../../notifications/notifications.service';
import { MediaService } from '../../media/media.service';

/** A rejected transfer proof gives the customer at least this long to try again. */
export const RESUBMIT_GRACE_MS = 12 * 60 * 60 * 1000;

type Notice = { userId: string; payload: NotifyPayload };

/**
 * Every customer and store action on a store order. Each runs in one
 * transaction that locks the order row, moves it through
 * OrderTransitionsService, and queues notifications that go out only after
 * the commit.
 */
@Injectable()
export class OrderActionsService {
  private readonly logger = new Logger(OrderActionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: OrderTransitionsService,
    private readonly views: OrderViewsService,
    private readonly notifications: NotificationsService,
    private readonly media: MediaService,
  ) {}

  private async storeOwner(m: EntityManager, storeId: string): Promise<string> {
    const [row] = await m.query(
      `SELECT b.owner_user_id FROM stores s JOIN businesses b ON b.id = s.business_id WHERE s.id = $1`,
      [storeId],
    );
    return row.owner_user_id;
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

  private toStore = (
    o: StoreOrder,
    ownerId: string,
    type: string,
    title: string,
    body: string,
  ): Notice => ({
    userId: ownerId,
    payload: { type, title, body, data: { storeOrderId: o.id, code: o.code } },
  });

  private toCustomer = (
    o: StoreOrder,
    type: string,
    title: string,
    body: string,
  ): Notice => ({
    userId: o.userId,
    payload: { type, title, body, data: { storeOrderId: o.id, code: o.code } },
  });

  // ── Customer ──────────────────────────────────────────────────────────────

  private async asCustomer(
    userId: string,
    id: string,
    work: (m: EntityManager, o: StoreOrder, actor: Actor) => Promise<Notice[]>,
  ) {
    const notices = await this.dataSource.transaction(async (m) => {
      const o = await this.transitions.lock(m, { id, userId });
      return work(m, o, { role: 'customer', userId });
    });
    await this.send(notices);
    return this.views.customerStoreOrder(userId, id);
  }

  /** Only while `placed`; afterwards the customer can only request it. */
  customerCancel(userId: string, id: string, reason: string) {
    return this.asCustomer(userId, id, async (m, o, actor) => {
      await this.transitions.moveStatus(m, o, 'cancelled', actor, {
        note: reason,
        patch: { cancelReason: reason, cancelledBy: 'customer' },
        message:
          o.status === 'confirmed' || o.status === 'packed'
            ? 'The store has already confirmed this order — request a cancellation instead.'
            : undefined,
      });
      const owner = await this.storeOwner(m, o.storeId);
      return [
        this.toStore(
          o,
          owner,
          'shop.order.cancelled',
          `${o.code} cancelled`,
          `The customer cancelled: ${reason}`,
        ),
      ];
    });
  }

  /** Confirmed or packed: records the request and tells the store, which decides. */
  requestCancel(userId: string, id: string, reason: string) {
    return this.asCustomer(userId, id, async (m, o, actor) => {
      if (o.status !== 'confirmed' && o.status !== 'packed') {
        throw invalidTransition(
          o.status,
          'cancelled',
          o.status === 'placed' ? ['cancelled'] : [],
          o.status === 'placed'
            ? 'This order is not confirmed yet — you can cancel it directly.'
            : 'This order can no longer be cancelled.',
        );
      }
      if (o.cancelRequestedAt) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: 'You have already asked the store to cancel this order.',
        });
      }
      await m.update(
        StoreOrder,
        { id: o.id },
        { cancelRequestedAt: new Date() },
      );
      await this.transitions.note(
        m,
        o.id,
        actor,
        `Cancellation requested: ${reason}`,
      );
      const owner = await this.storeOwner(m, o.storeId);
      return [
        this.toStore(
          o,
          owner,
          'shop.order.cancel_requested',
          `${o.code}: cancellation requested`,
          reason,
        ),
      ];
    });
  }

  submitPaymentProof(userId: string, id: string, dto: PaymentProofDto) {
    return this.asCustomer(userId, id, async (m, o, actor) => {
      if (o.paymentMethod !== 'transfer') {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'This is a cash-on-delivery order.',
        });
      }
      if (o.status === 'cancelled') {
        throw invalidTransition(
          o.paymentStatus,
          'proof_submitted',
          [],
          'This order was cancelled.',
        );
      }
      if (dto.proofUrl)
        this.media.assertOwnedAsset(
          userId,
          'payment_proof',
          dto.proofUrl,
          undefined,
          'proofUrl',
        );
      await this.transitions.movePayment(m, o, 'proof_submitted', actor, {
        note: dto.paymentRef,
        patch: {
          paymentRef: dto.paymentRef,
          paymentProofUrl: dto.proofUrl ?? null,
          paymentRejectedReason: null,
        },
      });
      const owner = await this.storeOwner(m, o.storeId);
      return [
        this.toStore(
          o,
          owner,
          'shop.payment.proof',
          `${o.code}: payment sent`,
          `Ref ${dto.paymentRef} · Rs ${o.total} — please confirm.`,
        ),
      ];
    });
  }

  received(userId: string, id: string) {
    return this.asCustomer(userId, id, async (m, o, actor) => {
      await this.transitions.moveStatus(m, o, 'delivered', actor);
      const owner = await this.storeOwner(m, o.storeId);
      return [
        this.toStore(
          o,
          owner,
          'shop.order.delivered',
          `${o.code} delivered`,
          'The customer confirmed delivery.',
        ),
      ];
    });
  }

  // ── Store partner ─────────────────────────────────────────────────────────

  private async asStore(
    storeId: string,
    ownerUserId: string,
    id: string,
    work: (m: EntityManager, o: StoreOrder, actor: Actor) => Promise<Notice[]>,
  ) {
    const notices = await this.dataSource.transaction(async (m) => {
      const o = await this.transitions.lock(m, { id, storeId });
      return work(m, o, { role: 'store', userId: ownerUserId });
    });
    await this.send(notices);
    return this.views.partnerOrder(storeId, id);
  }

  confirm(storeId: string, ownerId: string, id: string) {
    return this.asStore(storeId, ownerId, id, async (m, o, actor) => {
      await this.transitions.moveStatus(m, o, 'confirmed', actor);
      return [
        this.toCustomer(
          o,
          'shop.order.confirmed',
          `${o.code} confirmed`,
          'The store is preparing your order.',
        ),
      ];
    });
  }

  /** Decline a new order (placed only). */
  reject(storeId: string, ownerId: string, id: string, reason: string) {
    return this.asStore(storeId, ownerId, id, async (m, o, actor) => {
      if (o.status !== 'placed') {
        throw invalidTransition(
          o.status,
          'cancelled',
          [],
          'Only a new order can be rejected; cancel it instead.',
        );
      }
      await this.transitions.moveStatus(m, o, 'cancelled', actor, {
        note: reason,
        patch: { cancelReason: reason, cancelledBy: 'store' },
      });
      return [
        this.toCustomer(o, 'shop.order.rejected', `${o.code} declined`, reason),
      ];
    });
  }

  pack(storeId: string, ownerId: string, id: string) {
    return this.asStore(storeId, ownerId, id, async (m, o, actor) => {
      await this.transitions.moveStatus(m, o, 'packed', actor);
      return [];
    });
  }

  ship(storeId: string, ownerId: string, id: string, dto: ShipOrderDto) {
    return this.asStore(storeId, ownerId, id, async (m, o, actor) => {
      // Order of checks: is shipping possible at all, is it paid, is the body complete.
      assertOrderTransition(o.status, 'shipped', actor.role);
      if (o.paymentMethod === 'transfer' && o.paymentStatus !== 'paid') {
        throw new ConflictException({
          code: ErrorCode.PAYMENT_NOT_CONFIRMED,
          message: 'Confirm the transfer has arrived before shipping.',
          details: { paymentStatus: o.paymentStatus },
        });
      }
      const self = dto.courierName.trim().toLowerCase() === 'self';
      const missing = self
        ? (['riderName', 'riderPhone'] as const).filter((k) => !dto[k])
        : (['trackingRef'] as const).filter((k) => !dto[k]);
      if (missing.length) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: self
            ? 'Self-delivery needs the rider’s name and phone.'
            : 'Add the courier tracking number.',
          details: {
            fields: Object.fromEntries(
              missing.map((k) => [k, [`${k} is required`]]),
            ),
          },
        });
      }
      await this.transitions.moveStatus(m, o, 'shipped', actor, {
        patch: {
          courierName: self ? 'self' : dto.courierName,
          trackingRef: self ? null : dto.trackingRef!,
          riderName: self ? dto.riderName! : null,
          riderPhone: self ? dto.riderPhone! : null,
        },
      });
      const how = self
        ? `with ${dto.riderName} (${dto.riderPhone})`
        : `${dto.courierName} · ${dto.trackingRef}`;
      return [
        this.toCustomer(
          o,
          'shop.order.shipped',
          `${o.code} is on its way`,
          how,
        ),
      ];
    });
  }

  deliver(storeId: string, ownerId: string, id: string) {
    return this.asStore(storeId, ownerId, id, async (m, o, actor) => {
      await this.transitions.moveStatus(m, o, 'delivered', actor);
      return [
        this.toCustomer(
          o,
          'shop.order.delivered',
          `${o.code} delivered`,
          'Enjoy! You can review your items now.',
        ),
      ];
    });
  }

  /** Placed, confirmed or packed; a reason is required. */
  storeCancel(storeId: string, ownerId: string, id: string, reason: string) {
    return this.asStore(storeId, ownerId, id, async (m, o, actor) => {
      await this.transitions.moveStatus(m, o, 'cancelled', actor, {
        note: reason,
        patch: { cancelReason: reason, cancelledBy: 'store' },
      });
      return [
        this.toCustomer(
          o,
          'shop.order.cancelled',
          `${o.code} cancelled by the store`,
          reason,
        ),
      ];
    });
  }

  confirmPayment(storeId: string, ownerId: string, id: string) {
    return this.asStore(storeId, ownerId, id, async (m, o, actor) => {
      if (o.status === 'cancelled') {
        throw invalidTransition(
          o.paymentStatus,
          'paid',
          [],
          'This order was cancelled.',
        );
      }
      if (o.paymentMethod === 'cod') {
        throw invalidTransition(
          o.paymentStatus,
          'paid',
          [],
          'Use cash-collected for a cash-on-delivery order.',
        );
      }
      await this.transitions.movePayment(m, o, 'paid', actor);
      return [
        this.toCustomer(
          o,
          'shop.payment.confirmed',
          `${o.code}: payment received`,
          `The store confirmed Rs ${o.total}.`,
        ),
      ];
    });
  }

  /** "Not received": back to awaiting_transfer, with time to try again. */
  rejectPayment(storeId: string, ownerId: string, id: string, reason: string) {
    return this.asStore(storeId, ownerId, id, async (m, o, actor) => {
      const floor = new Date(Date.now() + RESUBMIT_GRACE_MS);
      await this.transitions.movePayment(m, o, 'awaiting_transfer', actor, {
        note: reason,
        patch: {
          paymentRejectedReason: reason,
          payBy: o.payBy && o.payBy > floor ? o.payBy : floor,
        },
      });
      return [
        this.toCustomer(
          o,
          'shop.payment.rejected',
          `${o.code}: payment not received`,
          `${reason} — please check and resubmit.`,
        ),
      ];
    });
  }

  /** COD: the cash is in hand — at or after delivery. */
  cashCollected(storeId: string, ownerId: string, id: string) {
    return this.asStore(storeId, ownerId, id, async (m, o, actor) => {
      if (o.paymentMethod !== 'cod') {
        throw invalidTransition(
          o.paymentStatus,
          'paid',
          [],
          'This is a transfer order — confirm the payment instead.',
        );
      }
      if (o.status !== 'delivered' && o.status !== 'completed') {
        throw invalidTransition(
          o.paymentStatus,
          'paid',
          [],
          'Mark the order delivered first.',
        );
      }
      await this.transitions.movePayment(m, o, 'paid', actor);
      return [];
    });
  }

  /** A cancelled, paid order: record the refund sent off-platform. */
  refund(storeId: string, ownerId: string, id: string, dto: RefundDto) {
    return this.asStore(storeId, ownerId, id, async (m, o, actor) => {
      if (dto.amount > o.total) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: `The refund cannot exceed the order total (Rs ${o.total}).`,
          details: { fields: { amount: [`at most ${o.total}`] } },
        });
      }
      await this.transitions.movePayment(m, o, 'refunded', actor, {
        note: dto.refundRef,
        patch: { refundAmount: dto.amount, refundRef: dto.refundRef },
      });
      return [
        this.toCustomer(
          o,
          'shop.payment.refunded',
          `${o.code}: refund sent`,
          `Rs ${dto.amount} · ref ${dto.refundRef}`,
        ),
      ];
    });
  }
}
