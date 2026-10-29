import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';
import { FoodBrand } from '../../vendor/entities/food-brand.entity';
import { Branch, GeoPoint } from '../../vendor/entities/branch.entity';
import { Rider } from '../../riders/entities/rider.entity';
import { FoodPromotion } from '../../promotions/entities/food-promotion.entity';
import { PreorderSlot } from '../../menu/entities/preorder-slot.entity';
import { RIDER_STEPS, RiderStep } from '../../riders/rider-steps';
import {
  ORDER_PAYMENT_METHODS,
  ORDER_SOURCES,
  OrderSource,
  FULFILMENTS,
  FoodPaymentMethod,
  Fulfilment,
} from '../../common/food-types';
import {
  FOOD_ACTORS,
  FOOD_ORDER_STATUSES,
  FoodActorRole,
  FoodOrderStatus,
} from '../food-order-status';
import {
  FOOD_PAYMENT_STATUSES,
  FoodPaymentStatus,
} from '../food-payment-status';

export interface FoodAddressSnapshot {
  label: string;
  fullName: string;
  phone: string;
  city: string;
  area: string;
  line1: string;
  landmark: string | null;
  building: string | null;
  floor: string | null;
  riderInstructions: string | null;
  lat: number;
  lng: number;
}

export interface PaymentAccountSnapshot {
  kind: string;
  accountTitle: string;
  accountNumber: string;
  bankName: string | null;
}

export interface PromotionSnapshot {
  id: string;
  title: string;
  kind: string;
  code: string | null;
}

/**
 * One food order. Money is integer rupees computed by the server; the only
 * fee is the vendor's own delivery fee — the CHECK makes any other line
 * impossible (total = subtotal − discount + delivery_fee).
 * Status and payment status change only through FoodOrderTransitionsService.
 */
@Check(
  'CHK_food_orders_prepaid',
  '"prepaid_amount" >= 0 AND "prepaid_amount" <= "total"',
)
@Entity('food_orders')
@Index(['code'], { unique: true })
// Platform-wide counts by period (admin overview, analytics).
@Index('IDX_food_orders_created_at', ['createdAt'])
@Index('IDX_food_orders_branch_status', ['branchId', 'status', 'createdAt'])
@Index(['riderId', 'status'])
@Index(['userId', 'createdAt'])
@Index('IDX_food_orders_accept_by', ['acceptBy'], {
  where: `"status" = 'placed'`,
})
@Index('IDX_food_orders_pay_by', ['payBy'], {
  where: `"payment_status" = 'awaiting_transfer'`,
})
@Check(
  'CHK_food_orders_money',
  '"subtotal" >= 0 AND "discount" >= 0 AND "delivery_fee" >= 0 AND "total" >= 0 AND "total" = "subtotal" - "discount" + "delivery_fee"',
)
@Check(
  'CHK_food_orders_cod_collected',
  '"cod_collected" IS NULL OR ("cod_collected" >= 0 AND "cod_collected" <= "total")',
)
export class FoodOrder extends BaseEntity {
  @Column({ type: 'varchar', length: 16 })
  code!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({
    type: 'enum',
    enum: FULFILMENTS,
    enumName: 'food_order_fulfilment',
  })
  fulfilment!: Fulfilment;

  @Column({ type: 'timestamptz', name: 'scheduled_for', nullable: true })
  scheduledFor!: Date | null;

  /** The pre-order slot it takes a place in (home kitchens). */
  @Column({ type: 'uuid', name: 'slot_id', nullable: true })
  slotId!: string | null;

  @ManyToOne(() => PreorderSlot, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'slot_id' })
  slot?: PreorderSlot;

  @Column({
    type: 'enum',
    enum: FOOD_ORDER_STATUSES,
    enumName: 'food_order_status',
    default: 'placed',
  })
  status!: FoodOrderStatus;

  @Column({
    type: 'enum',
    enum: ORDER_PAYMENT_METHODS,
    enumName: 'food_payment_method',
    name: 'payment_method',
  })
  paymentMethod!: FoodPaymentMethod;

  @Column({
    type: 'enum',
    enum: FOOD_PAYMENT_STATUSES,
    enumName: 'food_payment_status',
    name: 'payment_status',
  })
  paymentStatus!: FoodPaymentStatus;

  /** The vendor's accounts at checkout (transfer orders). */
  @Column({ type: 'jsonb', name: 'payment_account_snapshot', nullable: true })
  paymentAccountSnapshot!: PaymentAccountSnapshot[] | null;

  @Column({ type: 'varchar', length: 60, name: 'payment_ref', nullable: true })
  paymentRef!: string | null;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'payment_proof_url',
    nullable: true,
  })
  paymentProofUrl!: string | null;

  @Column({
    type: 'varchar',
    length: 200,
    name: 'payment_rejected_reason',
    nullable: true,
  })
  paymentRejectedReason!: string | null;

  @Column({ type: 'timestamptz', name: 'pay_by', nullable: true })
  payBy!: Date | null;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'jsonb', name: 'address_snapshot', nullable: true })
  addressSnapshot!: FoodAddressSnapshot | null;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    name: 'drop_geo',
    nullable: true,
  })
  dropGeo!: GeoPoint | null;

  @Column({ type: 'int', name: 'distance_m', nullable: true })
  distanceM!: number | null;

  @Column({ type: 'int' })
  subtotal!: number;

  @Column({ type: 'int', default: 0 })
  discount!: number;

  @Column({ type: 'uuid', name: 'promotion_id', nullable: true })
  promotionId!: string | null;

  @ManyToOne(() => FoodPromotion, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'promotion_id' })
  promotion?: FoodPromotion;

  @Column({ type: 'jsonb', name: 'promotion_snapshot', nullable: true })
  promotionSnapshot!: PromotionSnapshot | null;

  @Column({ type: 'int', name: 'delivery_fee', default: 0 })
  deliveryFee!: number;

  @Column({ type: 'int' })
  total!: number;

  @Column({ type: 'boolean', default: false })
  cutlery!: boolean;

  @Column({
    type: 'varchar',
    length: 300,
    name: 'customer_note',
    nullable: true,
  })
  customerNote!: string | null;

  /** The estimate at checkout; the vendor's promise once accepted. */
  @Column({ type: 'int', name: 'eta_minutes', nullable: true })
  etaMinutes!: number | null;

  @Column({ type: 'timestamptz', name: 'promised_at', nullable: true })
  promisedAt!: Date | null;

  /** No answer by then → auto_rejected (jobs). */
  @Column({ type: 'timestamptz', name: 'accept_by' })
  acceptBy!: Date;

  /** Branch-local date today's portions were taken from (restored on cancel the same day). */
  @Column({ type: 'date', name: 'portion_date', nullable: true })
  portionDate!: string | null;

  @Column({ type: 'uuid', name: 'rider_id', nullable: true })
  riderId!: string | null;

  @ManyToOne(() => Rider, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rider_id' })
  rider?: Rider;

  /** Where the assigned rider is (rider-steps.ts); each step is also an event. */
  @Column({
    type: 'enum',
    enum: RIDER_STEPS,
    enumName: 'food_rider_step',
    name: 'rider_step',
    nullable: true,
  })
  riderStep!: RiderStep | null;

  /** "Handed to own rider": a rider without an account. */
  @Column({ type: 'boolean', name: 'handed_to_external', default: false })
  handedToExternal!: boolean;

  @Column({ type: 'int', name: 'cod_collected', nullable: true })
  codCollected!: number | null;

  @Column({ type: 'timestamptz', name: 'accepted_at', nullable: true })
  acceptedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'preparing_at', nullable: true })
  preparingAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'ready_at', nullable: true })
  readyAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'picked_up_at', nullable: true })
  pickedUpAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'delivered_at', nullable: true })
  deliveredAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt!: Date | null;

  @Column({
    type: 'enum',
    enum: FOOD_ACTORS,
    enumName: 'food_order_cancelled_by',
    name: 'cancelled_by',
    nullable: true,
  })
  cancelledBy!: FoodActorRole | null;

  @Column({
    type: 'varchar',
    length: 300,
    name: 'cancel_reason',
    nullable: true,
  })
  cancelReason!: string | null;

  /** Scheduled orders: the kitchen was reminded (jobs). */
  @Column({ type: 'timestamptz', name: 'kitchen_reminded_at', nullable: true })
  kitchenRemindedAt!: Date | null;

  /** Second nudge before accept_by (jobs). */
  @Column({
    type: 'enum',
    enum: ORDER_SOURCES,
    enumName: 'food_order_source',
    default: 'app',
  })
  source!: OrderSource;

  /** `?c=` from a storefront / QR link (Chunk 5): "Orders you brought". */
  @Column({ type: 'varchar', length: 40, nullable: true })
  campaign!: string | null;

  /** Rupees already paid to the vendor before the day (a catering advance). */
  @Column({ type: 'int', name: 'prepaid_amount', default: 0 })
  prepaidAmount!: number;

  /** Kitchen stock taken for this order (on accept), once. */
  @Column({ type: 'timestamptz', name: 'stock_deducted_at', nullable: true })
  stockDeductedAt!: Date | null;

  /** …and put back when it was cancelled after that, once. */
  @Column({ type: 'timestamptz', name: 'stock_restored_at', nullable: true })
  stockRestoredAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'accept_nudged_at', nullable: true })
  acceptNudgedAt!: Date | null;
}
