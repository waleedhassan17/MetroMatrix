import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FoodOrder } from './entities/food-order.entity';
import {
  FoodActor,
  FoodOrderTransitionsService,
} from './food-order-transitions.service';
import { FoodNotice, FoodNotifier } from './food-notifier.service';
import { FoodOrderViewsService } from './food-order-views.service';
import {
  AcceptOrderDto,
  DeliveredDto,
  FoodPaymentProofDto,
} from './dto/order-action.dto';
import { TRANSFER_WINDOW_MINUTES } from './food-payment-status';
import { MediaService } from '../../media/media.service';
import { ErrorCode } from '../../../common/errors/codes';
import { invalidTransition } from '../../../common/state/transitions';
import { formatTime12 } from '../../../common/time/time.util';
import type { VendorRef } from '../vendor/food-vendor.service';

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

type Change = {
  order: FoodOrder;
  notices: FoodNotice[];
  kind?: 'updated' | 'payment';
};

/**
 * Everything a vendor or a customer does to an order. Each action runs in
 * one transaction: lock the order (scoped to the vendor's branch or the
 * customer — anyone else's order is 404), move it through
 * FoodOrderTransitionsService, commit, then tell people (push + socket).
 */
@Injectable()
export class FoodOrderActionsService {
  /** Filled in by riders (P6): a delivered order's cash goes on the rider's ledger. */
  onDelivered: (
    m: EntityManager,
    order: FoodOrder,
    actor: FoodActor,
  ) => Promise<void> = async () => undefined;

  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: FoodOrderTransitionsService,
    private readonly notifier: FoodNotifier,
    private readonly views: FoodOrderViewsService,
    private readonly media: MediaService,
  ) {}

  // ── vendor ────────────────────────────────────────────────────────────────

  accept(v: VendorRef, id: string, dto: AcceptOrderDto) {
    return this.vendorAct(v, id, async (m, o, actor) => {
      const minutes = dto.etaMinutes ?? o.etaMinutes ?? 30;
      const promisedAt =
        o.scheduledFor ?? new Date(Date.now() + minutes * 60_000);
      await this.transitions.moveStatus(m, o, 'accepted', actor, {
        patch: { etaMinutes: o.scheduledFor ? null : minutes, promisedAt },
        data: { etaMinutes: minutes },
      });
      const tz = await this.tz(m, o);
      return this.tell(o, [
        this.toCustomer(
          o,
          'food.order.accepted',
          `${o.code} accepted`,
          o.scheduledFor
            ? `Confirmed for ${formatTime12(o.scheduledFor, tz)}.`
            : o.fulfilment === 'pickup'
              ? `Ready for pickup in about ${minutes} minutes.`
              : `On its way in about ${minutes} minutes.`,
        ),
      ]);
    });
  }

  reject(v: VendorRef, id: string, reason: string) {
    return this.vendorAct(v, id, async (m, o, actor) => {
      await this.transitions.moveStatus(m, o, 'rejected', actor, {
        note: reason,
        patch: { cancelReason: reason },
      });
      return this.tell(o, [
        this.toCustomer(
          o,
          'food.order.rejected',
          `${o.code} declined`,
          `The restaurant couldn’t take your order: ${reason}`,
        ),
      ]);
    });
  }

  /** A transfer order waits for the money when the vendor asked for that (transfer_confirm_before_prep). */
  preparing(v: VendorRef, id: string) {
    return this.vendorAct(v, id, async (m, o, actor) => {
      if (o.paymentMethod === 'transfer' && o.paymentStatus !== 'paid') {
        const [b] = await m.query(
          `SELECT transfer_confirm_before_prep FROM branches WHERE id = $1`,
          [o.branchId],
        );
        if (b.transfer_confirm_before_prep)
          throw new ConflictException({
            code: ErrorCode.PAYMENT_NOT_CONFIRMED,
            message: 'Confirm the transfer before you start cooking.',
            details: { paymentStatus: o.paymentStatus },
          });
      }
      await this.transitions.moveStatus(m, o, 'preparing', actor);
      return this.tell(o, [
        this.toCustomer(
          o,
          'food.order.preparing',
          `${o.code} is being prepared`,
          'The kitchen has started on your order.',
        ),
      ]);
    });
  }

  ready(v: VendorRef, id: string) {
    return this.vendorAct(v, id, async (m, o, actor) => {
      await this.transitions.moveStatus(m, o, 'ready', actor);
      return this.tell(o, [
        this.toCustomer(
          o,
          'food.order.ready',
          o.fulfilment === 'pickup'
            ? `${o.code} is ready to collect`
            : `${o.code} is packed`,
          o.fulfilment === 'pickup'
            ? `Show code ${o.code} at the counter${o.paymentStatus === 'unpaid' ? ` and pay ${rs(o.total)}` : ''}.`
            : 'Waiting for the rider to pick it up.',
        ),
      ]);
    });
  }

  /** "Handed to own rider": a rider without an account takes it; the vendor marks it delivered later. */
  handedExternal(v: VendorRef, id: string) {
    return this.vendorAct(v, id, async (m, o, actor) => {
      if (o.riderId)
        throw invalidTransition(
          o.status,
          'on_the_way',
          [],
          'A rider is assigned — they pick it up in the Rider app.',
        );
      await this.transitions.moveStatus(m, o, 'on_the_way', actor, {
        patch: { handedToExternal: true },
        note: 'Handed to own rider',
      });
      return this.tell(o, [
        this.toCustomer(
          o,
          'food.order.on_the_way',
          `${o.code} is on the way`,
          'The restaurant’s rider has your order.',
        ),
      ]);
    });
  }

  /** Pickup collected at the counter (pay at pickup is settled). */
  pickedUp(v: VendorRef, id: string) {
    return this.vendorAct(v, id, async (m, o, actor) => {
      await this.transitions.moveStatus(m, o, 'picked_up', actor);
      return this.tell(o, [
        this.toCustomer(
          o,
          'food.order.picked_up',
          `${o.code} collected`,
          'Enjoy your meal!',
        ),
      ]);
    });
  }

  delivered(v: VendorRef, id: string, dto: DeliveredDto) {
    return this.vendorAct(v, id, async (m, o, actor) => {
      await this.markDelivered(m, o, actor, dto.codCollected);
      return this.tell(o, [
        this.toCustomer(
          o,
          'food.order.delivered',
          `${o.code} delivered`,
          'Enjoy your meal!',
        ),
      ]);
    });
  }

  /** Shared with the rider's "delivered" step. */
  async markDelivered(
    m: EntityManager,
    o: FoodOrder,
    actor: FoodActor,
    codCollected?: number,
  ) {
    let cod: number | null = null;
    if (o.paymentMethod === 'cod') {
      cod = codCollected ?? o.total;
      if (cod > o.total)
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: `Cash collected can’t be more than the order total (${rs(o.total)}).`,
          details: { fields: { codCollected: [`at most ${o.total}`] } },
        });
    }
    await this.transitions.moveStatus(m, o, 'delivered', actor, {
      patch: { codCollected: cod },
      data: cod !== null ? { codCollected: cod } : undefined,
    });
    await this.onDelivered(m, o, actor);
  }

  cancel(v: VendorRef, id: string, reason: string) {
    return this.vendorAct(v, id, async (m, o, actor) => {
      await this.transitions.moveStatus(m, o, 'cancelled', actor, {
        note: reason,
        patch: { cancelReason: reason },
      });
      return this.tell(o, [
        this.toCustomer(
          o,
          'food.order.cancelled',
          `${o.code} cancelled`,
          `The restaurant cancelled your order: ${reason}${o.paymentStatus === 'refund_due' ? ' They will refund your transfer.' : ''}`,
        ),
      ]);
    });
  }

  confirmPayment(v: VendorRef, id: string) {
    return this.vendorAct(v, id, async (m, o, actor) => {
      if (['rejected', 'auto_rejected', 'cancelled'].includes(o.status))
        throw invalidTransition(
          o.paymentStatus,
          'paid',
          [],
          'This order was cancelled.',
        );
      await this.transitions.movePayment(m, o, 'paid', actor);
      return this.tell(
        o,
        [
          this.toCustomer(
            o,
            'food.order.payment_confirmed',
            `Payment received for ${o.code}`,
            'The restaurant confirmed your transfer.',
          ),
        ],
        'payment',
      );
    });
  }

  rejectPayment(v: VendorRef, id: string, reason: string) {
    return this.vendorAct(v, id, async (m, o, actor) => {
      await this.transitions.movePayment(m, o, 'awaiting_transfer', actor, {
        note: reason,
        patch: {
          paymentRejectedReason: reason,
          payBy: new Date(Date.now() + TRANSFER_WINDOW_MINUTES * 60_000),
        },
      });
      return this.tell(
        o,
        [
          this.toCustomer(
            o,
            'food.order.payment_rejected',
            `Transfer for ${o.code} not received`,
            `${reason} — send it again within ${TRANSFER_WINDOW_MINUTES} minutes or the order is cancelled.`,
          ),
        ],
        'payment',
      );
    });
  }

  // ── customer ──────────────────────────────────────────────────────────────

  /** Only while the restaurant hasn't accepted it. */
  async customerCancel(userId: string, code: string, reason?: string) {
    const change = await this.dataSource.transaction(async (m) => {
      const o = await this.transitions.lock(m, { code, userId });
      await this.transitions.moveStatus(
        m,
        o,
        'cancelled',
        { role: 'customer', userId },
        {
          note: reason ?? null,
          patch: { cancelReason: reason ?? 'Cancelled by the customer' },
          message:
            o.status === 'placed'
              ? undefined
              : 'The restaurant has already accepted this order — call them to cancel.',
        },
      );
      return this.tell(o, [
        {
          userId: await this.notifier.ownerOf(o.branchId),
          payload: {
            type: 'food.order.cancelled',
            title: `${o.code} cancelled by the customer`,
            body: reason
              ? `Reason: ${reason}`
              : 'Don’t start cooking this one.',
            data: { orderId: o.id, code: o.code },
          },
        },
      ]);
    });
    return this.after(change, () => this.views.customer(userId, code));
  }

  async paymentProof(userId: string, code: string, dto: FoodPaymentProofDto) {
    const change = await this.dataSource.transaction(async (m) => {
      const o = await this.transitions.lock(m, { code, userId });
      if (o.paymentMethod !== 'transfer')
        throw invalidTransition(
          o.paymentStatus,
          'proof_submitted',
          [],
          'This order isn’t paid by transfer.',
        );
      if (['rejected', 'auto_rejected', 'cancelled'].includes(o.status))
        throw invalidTransition(
          o.paymentStatus,
          'proof_submitted',
          [],
          'This order was cancelled.',
        );
      if (dto.proofUrl)
        this.media.assertOwnedAsset(
          userId,
          'payment_proof',
          dto.proofUrl,
          undefined,
          'proofUrl',
        );
      await this.transitions.movePayment(
        m,
        o,
        'proof_submitted',
        { role: 'customer', userId },
        {
          note: dto.paymentRef,
          patch: {
            paymentRef: dto.paymentRef,
            paymentProofUrl: dto.proofUrl ?? null,
            paymentRejectedReason: null,
          },
        },
      );
      return this.tell(
        o,
        [
          {
            userId: await this.notifier.ownerOf(o.branchId),
            payload: {
              type: 'food.order.payment_proof',
              title: `Transfer sent for ${o.code}`,
              body: `Reference ${dto.paymentRef} — check your account and confirm.`,
              data: { orderId: o.id, code: o.code },
            },
          },
        ],
        'payment',
      );
    });
    return this.after(change, () => this.views.customer(userId, code));
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private async vendorAct(
    v: VendorRef,
    id: string,
    work: (m: EntityManager, o: FoodOrder, actor: FoodActor) => Promise<Change>,
  ) {
    const change = await this.dataSource.transaction(async (m) => {
      const o = await this.transitions.lock(m, { id, branchId: v.branchId });
      return work(m, o, { role: 'vendor', userId: v.ownerUserId });
    });
    return this.after(change, () => this.views.vendorDetail(v, id));
  }

  private async after<T>(change: Change, view: () => Promise<T>): Promise<T> {
    await this.notifier.send(change.notices);
    await this.notifier.changed(change.order.id, change.kind ?? 'updated');
    return view();
  }

  private tell(
    order: FoodOrder,
    notices: FoodNotice[],
    kind?: Change['kind'],
  ): Change {
    return { order, notices, kind };
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

  private async tz(m: EntityManager, o: FoodOrder): Promise<string> {
    const [b] = await m.query(`SELECT timezone FROM branches WHERE id = $1`, [
      o.branchId,
    ]);
    return b.timezone;
  }
}
