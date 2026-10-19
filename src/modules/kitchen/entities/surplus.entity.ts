import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { Branch } from '../../food/vendor/entities/branch.entity';
import { User } from '../../users/entities/user.entity';

export const SURPLUS_STATUSES = [
  'live',
  'sold_out',
  'expired',
  'cancelled',
] as const;
export type SurplusStatus = (typeof SURPLUS_STATUSES)[number];

/**
 * A Bachat Box: today's surplus at a discount, collected in a same-day
 * pickup window. `remaining` is decremented atomically on reserve.
 * Rupees; zero commission (the customer pays the vendor at pickup or by
 * transfer to the vendor's own account).
 */
@Entity('surplus_boxes')
@Index(['branchId', 'status'])
@Index('IDX_surplus_boxes_live', ['pickupTo'], {
  where: `"status" IN ('live', 'sold_out')`,
})
@Check(
  'CHK_surplus_boxes_numbers',
  '"price" >= 0 AND "price" <= "original_value" AND "quantity" BETWEEN 1 AND 200 AND "remaining" BETWEEN 0 AND "quantity" AND "pickup_to" > "pickup_from"',
)
export class SurplusBox extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'varchar', length: 80 })
  title!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description!: string | null;

  /** "Usually biryani, naan and a salad" — never a promise of exact dishes. */
  @Column({
    type: 'varchar',
    length: 200,
    name: 'contents_hint',
    nullable: true,
  })
  contentsHint!: string | null;

  @Column({ type: 'int', name: 'original_value' })
  originalValue!: number;

  @Column({ type: 'int' })
  price!: number;

  @Column({ type: 'smallint' })
  quantity!: number;

  @Column({ type: 'smallint' })
  remaining!: number;

  @Column({ type: 'timestamptz', name: 'pickup_from' })
  pickupFrom!: Date;

  @Column({ type: 'timestamptz', name: 'pickup_to' })
  pickupTo!: Date;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: string[];

  @Column({
    type: 'enum',
    enum: SURPLUS_STATUSES,
    enumName: 'surplus_status',
    default: 'live',
  })
  status!: SurplusStatus;
}

export const RESERVATION_STATUSES = [
  'reserved',
  'collected',
  'no_show',
  'cancelled',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

@Entity('surplus_reservations')
@Index(['boxId', 'status'])
@Index(['userId', 'createdAt'])
@Index(['code'], { unique: true })
@Check('CHK_surplus_reservations_qty', '"quantity" BETWEEN 1 AND 10')
export class SurplusReservation extends BaseEntity {
  @Column({ type: 'uuid', name: 'box_id' })
  boxId!: string;

  @ManyToOne(() => SurplusBox, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'box_id' })
  box?: SurplusBox;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'smallint' })
  quantity!: number;

  /** Shown at the counter: BB-7KQ2PX. */
  @Column({ type: 'varchar', length: 12 })
  code!: string;

  @Column({
    type: 'enum',
    enum: RESERVATION_STATUSES,
    enumName: 'surplus_reservation_status',
    default: 'reserved',
  })
  status!: ReservationStatus;

  @Column({
    type: 'enum',
    enum: ['pay_at_pickup', 'transfer'],
    enumName: 'surplus_payment_method',
    name: 'payment_method',
    default: 'pay_at_pickup',
  })
  paymentMethod!: 'pay_at_pickup' | 'transfer';

  /** Rupees: price × quantity at the time of reserving. */
  @Column({ type: 'int' })
  total!: number;

  @Column({ type: 'timestamptz', name: 'collected_at', nullable: true })
  collectedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt!: Date | null;
}

/** Food given away (to an NGO, a masjid, a shelter): counted in "meals rescued". */
@Entity('surplus_donations')
@Index(['branchId', 'createdAt'])
@Check('CHK_surplus_donations_meals', '"meals" BETWEEN 1 AND 10000')
export class SurplusDonation extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'varchar', length: 120 })
  organisation!: string;

  @Column({ type: 'int' })
  meals!: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'photo_url', nullable: true })
  photoUrl!: string | null;
}

/**
 * A customer's Bachat Box standing: three no-shows block reserving for 14
 * days (then the count starts again).
 */
@Entity('surplus_customer_status')
export class SurplusCustomerStatus {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'smallint', name: 'no_shows', default: 0 })
  noShows!: number;

  @Column({ type: 'timestamptz', name: 'blocked_until', nullable: true })
  blockedUntil!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
