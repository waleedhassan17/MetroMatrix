import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { OrderGroup } from './order-group.entity';
import { Store } from '../../stores/entities/store.entity';
import { User } from '../../../users/entities/user.entity';
import {
  ACTOR_ROLES,
  ActorRole,
  ORDER_STATUSES,
  OrderStatus,
} from '../order-status';
import { PAYMENT_STATUSES, PaymentStatus } from '../payment-status';
import {
  PAYMENT_METHODS,
  PaymentMethod,
} from '../../checkout/dto/checkout.dto';
import { PaymentAccountKind } from '../../../../common/payments/payment-account.validation';

/** A store's payment account as it was at checkout. */
export interface PaymentAccountSnapshot {
  kind: PaymentAccountKind;
  accountTitle: string;
  accountNumber: string;
  bankName: string | null;
}

/**
 * One store's part of a checkout — the unit a store fulfils and a customer
 * pays. Status and payment move only through OrderTransitionsService, which
 * writes a store_order_events row with every change.
 *
 * Arithmetic is checked by the database: total = subtotal − discount +
 * shipping_fee, all non-negative.
 */
@Entity('store_orders')
@Index(['code'], { unique: true })
@Index(['groupId'])
// Platform-wide counts by period (admin overview, analytics).
@Index('IDX_store_orders_created_at', ['createdAt'])
@Index('IDX_store_orders_store_status_created', { synchronize: false })
@Index(['userId', 'createdAt'])
@Index(['paymentStatus', 'payBy'])
@Check(
  'CHK_store_orders_totals',
  '"total" = "subtotal" - "discount" + "shipping_fee" AND "discount" >= 0 AND "discount" <= "subtotal" AND "shipping_fee" >= 0',
)
export class StoreOrder extends BaseEntity {
  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @ManyToOne(() => OrderGroup, (g) => g.storeOrders)
  @JoinColumn({ name: 'group_id' })
  group?: OrderGroup;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  /** The customer (copied from the group for direct lookups). */
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** MM-XXXXXX-1 */
  @Column({ type: 'varchar', length: 16 })
  code!: string;

  @Column({
    type: 'enum',
    enum: ORDER_STATUSES,
    enumName: 'store_order_status',
    default: 'placed',
  })
  status!: OrderStatus;

  @Column({
    type: 'enum',
    enum: PAYMENT_METHODS,
    enumName: 'store_order_payment_method',
    name: 'payment_method',
  })
  paymentMethod!: PaymentMethod;

  @Column({
    type: 'enum',
    enum: PAYMENT_STATUSES,
    enumName: 'store_order_payment_status',
    name: 'payment_status',
  })
  paymentStatus!: PaymentStatus;

  /** Transfer orders: the store's active accounts at checkout. */
  @Column({ type: 'jsonb', name: 'payment_account_snapshot', nullable: true })
  paymentAccountSnapshot!: PaymentAccountSnapshot[] | null;

  @Column({ type: 'varchar', length: 100, name: 'payment_ref', nullable: true })
  paymentRef!: string | null;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'payment_proof_url',
    nullable: true,
  })
  paymentProofUrl!: string | null;

  @Column({ type: 'text', name: 'payment_rejected_reason', nullable: true })
  paymentRejectedReason!: string | null;

  /** Transfer deadline: unpaid after this, the order is cancelled. */
  @Column({ type: 'timestamptz', name: 'pay_by', nullable: true })
  payBy!: Date | null;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'int' })
  subtotal!: number;

  @Column({ type: 'int' })
  discount!: number;

  @Column({ type: 'varchar', length: 20, name: 'coupon_code', nullable: true })
  couponCode!: string | null;

  @Column({ type: 'int', name: 'shipping_fee' })
  shippingFee!: number;

  @Column({ type: 'int' })
  total!: number;

  /** The store's return window when the order was placed. */
  @Column({ type: 'int', name: 'return_window_days' })
  returnWindowDays!: number;

  @Column({ type: 'text', name: 'customer_note', nullable: true })
  customerNote!: string | null;

  @Column({ type: 'varchar', length: 80, name: 'courier_name', nullable: true })
  courierName!: string | null;

  @Column({ type: 'varchar', length: 80, name: 'tracking_ref', nullable: true })
  trackingRef!: string | null;

  /** Self-delivery: who is bringing it. */
  @Column({ type: 'varchar', length: 80, name: 'rider_name', nullable: true })
  riderName!: string | null;

  @Column({ type: 'varchar', length: 16, name: 'rider_phone', nullable: true })
  riderPhone!: string | null;

  @Column({ type: 'text', name: 'cancel_reason', nullable: true })
  cancelReason!: string | null;

  @Column({
    type: 'enum',
    enum: ACTOR_ROLES,
    enumName: 'store_order_actor',
    name: 'cancelled_by',
    nullable: true,
  })
  cancelledBy!: ActorRole | null;

  @Column({ type: 'timestamptz', name: 'cancel_requested_at', nullable: true })
  cancelRequestedAt!: Date | null;

  /** Cancelled after payment: what the store sent back (off-platform). */
  @Column({ type: 'int', name: 'refund_amount', nullable: true })
  refundAmount!: number | null;

  @Column({ type: 'varchar', length: 100, name: 'refund_ref', nullable: true })
  refundRef!: string | null;

  @Column({ type: 'timestamptz', name: 'refunded_at', nullable: true })
  refundedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'confirmed_at', nullable: true })
  confirmedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'packed_at', nullable: true })
  packedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'shipped_at', nullable: true })
  shippedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'delivered_at', nullable: true })
  deliveredAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt!: Date | null;

  /** Job bookkeeping: each reminder goes out once. */
  @Column({ type: 'timestamptz', name: 'store_reminded_at', nullable: true })
  storeRemindedAt!: Date | null;

  @Column({
    type: 'timestamptz',
    name: 'customer_cancel_hint_at',
    nullable: true,
  })
  customerCancelHintAt!: Date | null;
}
