import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { FoodBrand } from '../../../food/vendor/entities/food-brand.entity';
import { Branch } from '../../../food/vendor/entities/branch.entity';
import { User } from '../../../users/entities/user.entity';
import {
  FoodOrder,
  FoodAddressSnapshot,
} from '../../../food/orders/entities/food-order.entity';

export const TIFFIN_MEALS = ['breakfast', 'lunch', 'dinner'] as const;
export const TIFFIN_PERIODS = ['weekly', 'monthly'] as const;
export const TIFFIN_DELIVERY_MODES = ['delivery', 'pickup', 'both'] as const;

export interface RotationDay {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  menuItemIds: string[];
  note?: string | null;
}

/**
 * A tiffin plan: the same meal on set days, paid per week or month straight
 * to the vendor. `rotation` says what is cooked on each weekday; the order
 * for a day is written at the skip cut-off (8 PM the evening before, by
 * default) so it reaches the board like any scheduled order.
 */
@Entity('tiffin_plans')
@Index(['brandId', 'isActive'])
@Check(
  'CHK_tiffin_plans_numbers',
  '"days_mask" BETWEEN 1 AND 127 AND "price_per_period" > 0 AND "capacity" BETWEEN 1 AND 1000 AND "skip_cutoff_hour" BETWEEN 0 AND 23',
)
export class TiffinPlan extends BaseEntity {
  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: TIFFIN_MEALS, enumName: 'tiffin_meal' })
  meal!: (typeof TIFFIN_MEALS)[number];

  @Column({ type: 'smallint', name: 'days_mask' })
  daysMask!: number;

  @Column({ type: 'enum', enum: TIFFIN_PERIODS, enumName: 'tiffin_period' })
  period!: (typeof TIFFIN_PERIODS)[number];

  /** Rupees per week or month. */
  @Column({ type: 'int', name: 'price_per_period' })
  pricePerPeriod!: number;

  @Column({
    type: 'enum',
    enum: TIFFIN_DELIVERY_MODES,
    enumName: 'tiffin_delivery_mode',
    name: 'delivery_mode',
  })
  deliveryMode!: (typeof TIFFIN_DELIVERY_MODES)[number];

  @Column({ type: 'time', name: 'delivery_window_from' })
  deliveryWindowFrom!: string;

  @Column({ type: 'time', name: 'delivery_window_to' })
  deliveryWindowTo!: string;

  /** Subscribers (active or paused) the kitchen takes. */
  @Column({ type: 'smallint' })
  capacity!: number;

  /** Skips and pauses close at this hour (branch time) the day before. */
  @Column({ type: 'smallint', name: 'skip_cutoff_hour', default: 20 })
  skipCutoffHour!: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  rotation!: RotationDay[];

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}

export const TIFFIN_STATUSES = [
  'requested',
  'active',
  'paused',
  'cancelled',
  'ended',
  'declined',
] as const;
export type TiffinStatus = (typeof TIFFIN_STATUSES)[number];
export const TIFFIN_PAYMENT_METHODS = [
  'cash_weekly',
  'transfer_per_period',
] as const;
export const PERIOD_PAYMENT_STATUSES = [
  'due',
  'proof_submitted',
  'paid',
] as const;

/**
 * A customer's tiffin. `requested` until the vendor approves (when there is
 * room); `skips` are dates without a meal. One live subscription per plan
 * and customer.
 */
@Entity('tiffin_subscriptions')
@Index('UQ_tiffin_subscriptions_live', ['planId', 'userId'], {
  unique: true,
  where: `"status" IN ('requested', 'active', 'paused')`,
})
@Index(['userId', 'createdAt'])
@Index(['planId', 'status'])
export class TiffinSubscription extends BaseEntity {
  @Column({ type: 'uuid', name: 'plan_id' })
  planId!: string;

  @ManyToOne(() => TiffinPlan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan?: TiffinPlan;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({
    type: 'enum',
    enum: ['delivery', 'pickup'],
    enumName: 'tiffin_fulfilment',
  })
  fulfilment!: 'delivery' | 'pickup';

  @Column({ type: 'jsonb', name: 'address_snapshot', nullable: true })
  addressSnapshot!: FoodAddressSnapshot | null;

  @Column({ type: 'date', name: 'starts_on' })
  startsOn!: string;

  @Column({
    type: 'enum',
    enum: TIFFIN_STATUSES,
    enumName: 'tiffin_status',
    default: 'requested',
  })
  status!: TiffinStatus;

  @Column({ type: 'date', name: 'current_period_start', nullable: true })
  currentPeriodStart!: string | null;

  @Column({ type: 'date', name: 'current_period_end', nullable: true })
  currentPeriodEnd!: string | null;

  @Column({
    type: 'enum',
    enum: TIFFIN_PAYMENT_METHODS,
    enumName: 'tiffin_payment_method',
    name: 'payment_method',
  })
  paymentMethod!: (typeof TIFFIN_PAYMENT_METHODS)[number];

  @Column({
    type: 'enum',
    enum: PERIOD_PAYMENT_STATUSES,
    enumName: 'tiffin_period_payment_status',
    name: 'period_payment_status',
    default: 'due',
  })
  periodPaymentStatus!: (typeof PERIOD_PAYMENT_STATUSES)[number];

  @Column({ type: 'varchar', length: 60, name: 'payment_ref', nullable: true })
  paymentRef!: string | null;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'payment_proof_url',
    nullable: true,
  })
  paymentProofUrl!: string | null;

  @Column({ type: 'date', array: true, default: () => "'{}'" })
  skips!: string[];

  @Column({ type: 'date', name: 'paused_until', nullable: true })
  pausedUntil!: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason!: string | null;

  @Column({ type: 'timestamptz', name: 'approved_at', nullable: true })
  approvedAt!: Date | null;
}

export const TIFFIN_DELIVERY_STATUSES = [
  'scheduled',
  'skipped',
  'prepared',
  'delivered',
  'missed',
] as const;

/** One day of one subscription: written once (unique), with its board order. */
@Entity('tiffin_deliveries')
@Index(['subscriptionId', 'date'], { unique: true })
@Index(['foodOrderId'])
export class TiffinDelivery extends BaseEntity {
  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId!: string;

  @ManyToOne(() => TiffinSubscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: TiffinSubscription;

  @Column({ type: 'date' })
  date!: string;

  @Column({
    type: 'enum',
    enum: TIFFIN_DELIVERY_STATUSES,
    enumName: 'tiffin_delivery_status',
  })
  status!: (typeof TIFFIN_DELIVERY_STATUSES)[number];

  @Column({ type: 'uuid', name: 'food_order_id', nullable: true })
  foodOrderId!: string | null;

  @ManyToOne(() => FoodOrder, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'food_order_id' })
  order?: FoodOrder;
}
