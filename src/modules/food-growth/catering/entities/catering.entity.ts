import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { FoodBrand } from '../../../food/vendor/entities/food-brand.entity';
import { User } from '../../../users/entities/user.entity';
import {
  FoodAddressSnapshot,
  FoodOrder,
} from '../../../food/orders/entities/food-order.entity';

export const EVENT_TYPES = [
  'dawat',
  'wedding',
  'office',
  'birthday',
  'milad',
  'other',
] as const;
export const CATERING_FULFILMENTS = ['delivery', 'pickup', 'on_site'] as const;
export const CATERING_STATUSES = [
  'requested',
  'quoted',
  'accepted',
  'advance_proof',
  'confirmed',
  'completed',
  'declined',
  'expired',
  'cancelled',
] as const;
export type CateringStatus = (typeof CATERING_STATUSES)[number];

export interface RequestedItem {
  menuItemId?: string | null;
  name: string;
  qty?: number | null;
}

/**
 * A dawat / catering booking. The vendor quotes (versioned); the customer
 * accepts the latest valid quote, sends the advance straight to the vendor
 * with proof, the vendor confirms, and on the event day one scheduled order
 * is written from the quote (`food_order_id`, `prepaid_amount` = advance).
 */
@Entity('catering_requests')
@Index(['code'], { unique: true })
@Index(['brandId', 'status'])
@Index(['userId', 'createdAt'])
@Check('CHK_catering_requests_guests', '"guests" BETWEEN 1 AND 5000')
export class CateringRequest extends BaseEntity {
  @Column({ type: 'varchar', length: 12 })
  code!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'date', name: 'event_date' })
  eventDate!: string;

  @Column({ type: 'time', name: 'event_time' })
  eventTime!: string;

  @Column({ type: 'smallint' })
  guests!: number;

  @Column({
    type: 'enum',
    enum: EVENT_TYPES,
    enumName: 'catering_event_type',
    name: 'event_type',
  })
  eventType!: (typeof EVENT_TYPES)[number];

  @Column({ type: 'jsonb', name: 'requested_items', default: () => "'[]'" })
  requestedItems!: RequestedItem[];

  /** Rupees, the customer's idea of the whole event. */
  @Column({ type: 'int', nullable: true })
  budget!: number | null;

  @Column({
    type: 'enum',
    enum: CATERING_FULFILMENTS,
    enumName: 'catering_fulfilment',
  })
  fulfilment!: (typeof CATERING_FULFILMENTS)[number];

  @Column({ type: 'jsonb', name: 'address_snapshot', nullable: true })
  addressSnapshot!: FoodAddressSnapshot | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({
    type: 'enum',
    enum: CATERING_STATUSES,
    enumName: 'catering_status',
    default: 'requested',
  })
  status!: CateringStatus;

  /** The accepted quote version. */
  @Column({ type: 'smallint', name: 'accepted_version', nullable: true })
  acceptedVersion!: number | null;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'advance_proof_url',
    nullable: true,
  })
  advanceProofUrl!: string | null;

  @Column({ type: 'varchar', length: 60, name: 'advance_ref', nullable: true })
  advanceRef!: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason!: string | null;

  @Column({ type: 'uuid', name: 'food_order_id', nullable: true })
  foodOrderId!: string | null;

  @ManyToOne(() => FoodOrder, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'food_order_id' })
  order?: FoodOrder;
}

export interface QuoteLine {
  menuItemId?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
}

/** One version of the vendor's quote. Only the newest unexpired one can be accepted. */
@Entity('catering_quotes')
@Index(['requestId', 'version'], { unique: true })
@Check(
  'CHK_catering_quotes_numbers',
  '"total" >= 0 AND "delivery_fee" >= 0 AND "advance_pct" BETWEEN 0 AND 100 AND "version" >= 1',
)
export class CateringQuote extends BaseEntity {
  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @ManyToOne(() => CateringRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request?: CateringRequest;

  @Column({ type: 'jsonb' })
  lines!: QuoteLine[];

  @Column({ type: 'int', name: 'delivery_fee', default: 0 })
  deliveryFee!: number;

  /** Rupees: Σ qty × unit price + delivery fee. */
  @Column({ type: 'int' })
  total!: number;

  @Column({ type: 'smallint', name: 'advance_pct' })
  advancePct!: number;

  @Column({ type: 'timestamptz', name: 'valid_until' })
  validUntil!: Date;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'smallint' })
  version!: number;
}
