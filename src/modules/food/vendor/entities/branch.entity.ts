import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Business } from '../../../businesses/entities/business.entity';
import { FoodBrand } from './food-brand.entity';

export const BRANCH_STATUSES = ['draft', 'active', 'suspended'] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

const decimal = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : parseFloat(v)),
};

export interface GeoPoint {
  type: 'Point';
  /** [lng, lat] */
  coordinates: [number, number];
}

/**
 * Where a vendor cooks and dispatches from: location, hours, fulfilment and
 * payment rules. One per food business today — `business_id` is unique.
 * DROP that unique index when chains launch; orders and menus already point
 * at the brand/branch, so nothing else moves.
 */
@Entity('branches')
@Index(['businessId'], { unique: true })
@Index(['brandId'])
@Check('CHK_branches_auto_reject', '"auto_reject_minutes" BETWEEN 3 AND 10')
@Check(
  'CHK_branches_numbers',
  '"prep_minutes" BETWEEN 5 AND 180 AND "cod_limit" >= 0 AND "max_radius_km" > 0 AND "busy_extra_minutes" >= 0',
)
export class Branch extends BaseEntity {
  @Column({ type: 'uuid', name: 'business_id' })
  businessId!: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business?: Business;

  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'address_line',
    nullable: true,
  })
  addressLine!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  area!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  city!: string | null;

  /** Required to go live. */
  @Index({ spatial: true })
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  geo!: GeoPoint | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 60, default: 'Asia/Karachi' })
  timezone!: string;

  @Column({ type: 'smallint', name: 'prep_minutes', default: 20 })
  prepMinutes!: number;

  @Column({ type: 'timestamptz', name: 'busy_until', nullable: true })
  busyUntil!: Date | null;

  @Column({ type: 'smallint', name: 'busy_extra_minutes', default: 0 })
  busyExtraMinutes!: number;

  @Column({ type: 'boolean', name: 'is_paused', default: false })
  isPaused!: boolean;

  @Column({
    type: 'varchar',
    length: 200,
    name: 'pause_message',
    nullable: true,
  })
  pauseMessage!: string | null;

  @Column({ type: 'boolean', name: 'accepts_delivery', default: true })
  acceptsDelivery!: boolean;

  @Column({ type: 'boolean', name: 'accepts_pickup', default: true })
  acceptsPickup!: boolean;

  @Column({ type: 'boolean', name: 'accepts_cod', default: true })
  acceptsCod!: boolean;

  @Column({ type: 'int', name: 'cod_limit', default: 10000 })
  codLimit!: number;

  /** Transfer orders can't go to `preparing` until the payment is confirmed. */
  @Column({
    type: 'boolean',
    name: 'transfer_confirm_before_prep',
    default: true,
  })
  transferConfirmBeforePrep!: boolean;

  @Column({ type: 'smallint', name: 'auto_reject_minutes', default: 5 })
  autoRejectMinutes!: number;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'max_radius_km',
    default: 5,
    transformer: decimal,
  })
  maxRadiusKm!: number;

  @Column({ type: 'int', name: 'free_delivery_over', nullable: true })
  freeDeliveryOver!: number | null;

  /** Home kitchens that cook only to order: scheduled orders only. */
  @Column({ type: 'boolean', name: 'preorder_only', default: false })
  preorderOnly!: boolean;

  @Column({
    type: 'enum',
    enum: BRANCH_STATUSES,
    enumName: 'food_branch_status',
    default: 'draft',
  })
  status!: BranchStatus;

  @Column({ type: 'timestamptz', name: 'went_live_at', nullable: true })
  wentLiveAt!: Date | null;

  /** Home kitchens: set by MetroMatrix after a test order; required to go live. */
  @Column({
    type: 'timestamptz',
    name: 'food_safety_checked_at',
    nullable: true,
  })
  foodSafetyCheckedAt!: Date | null;

  @Column({ type: 'text', name: 'food_safety_note', nullable: true })
  foodSafetyNote!: string | null;
}
