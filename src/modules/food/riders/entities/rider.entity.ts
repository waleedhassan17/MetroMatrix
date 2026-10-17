import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';
import { Business } from '../../../businesses/entities/business.entity';
import type { GeoPoint } from '../../vendor/entities/branch.entity';

export const RIDER_VEHICLES = ['bike', 'bicycle', 'car', 'on_foot'] as const;
export type RiderVehicle = (typeof RIDER_VEHICLES)[number];

/** `plan_locked` is the plan's doing (rider-seats.ts); the others are the vendor's. */
export const RIDER_STATUSES = [
  'active',
  'inactive',
  'on_leave',
  'plan_locked',
] as const;
export type RiderStatus = (typeof RIDER_STATUSES)[number];

/**
 * A vendor's own delivery rider, signing in with a vendor-issued username
 * (FinMatrix pattern). MetroMatrix never dispatches: the vendor assigns.
 */
@Entity('riders')
@Index(['userId'], { unique: true })
@Index(['businessId', 'status'])
export class Rider extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'uuid', name: 'business_id' })
  businessId!: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business?: Business;

  @Column({ type: 'varchar', length: 80, name: 'full_name' })
  fullName!: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  phone!: string | null;

  @Column({
    type: 'enum',
    enum: RIDER_VEHICLES,
    enumName: 'rider_vehicle',
    default: 'bike',
  })
  vehicle!: RiderVehicle;

  @Column({
    type: 'enum',
    enum: RIDER_STATUSES,
    enumName: 'rider_status',
    default: 'active',
  })
  status!: RiderStatus;

  /** Duty (the rider's toggle) — what assignment uses. Not the same as location-live. */
  @Column({ type: 'boolean', name: 'on_duty', default: false })
  onDuty!: boolean;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    name: 'last_geo',
    nullable: true,
  })
  lastGeo!: GeoPoint | null;

  @Column({ type: 'timestamptz', name: 'location_updated_at', nullable: true })
  locationUpdatedAt!: Date | null;

  @Column({ type: 'int', name: 'active_order_count', default: 0 })
  activeOrderCount!: number;
}
