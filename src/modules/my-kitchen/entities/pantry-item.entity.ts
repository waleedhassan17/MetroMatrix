import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';
import { numeric } from '../../kitchen/common/numeric';

export const PANTRY_STATUSES = [
  'active',
  'used',
  'expired',
  'discarded',
] as const;
export type PantryStatus = (typeof PANTRY_STATUSES)[number];
export const PANTRY_SOURCES = ['manual', 'order', 'voice'] as const;
export const PANTRY_UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'dozen',
  'pack',
] as const;
export type PantryUnit = (typeof PANTRY_UNITS)[number];

/**
 * What a customer has at home (Chunk 5, P11): name, how much, when it
 * expires. `canonical` (through ingredient_aliases) lets recipes and the
 * grocery compare match it. Reminders go out 2 days before and on the day
 * (`reminded` bits 1 and 2), and the day after it turns `expired`.
 */
@Entity('pantry_items')
@Index(['userId', 'status', 'expiresOn'])
@Index('UQ_pantry_items_order_item', ['storeOrderItemId'], {
  unique: true,
  where: '"store_order_item_id" IS NOT NULL',
})
@Check('CHK_pantry_items_qty', '"qty" > 0')
export class PantryItem extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  canonical!: string | null;

  @Column({ ...numeric(10, 3) })
  qty!: number;

  @Column({ type: 'varchar', length: 8 })
  unit!: PantryUnit;

  @Column({ type: 'date', name: 'expires_on', nullable: true })
  expiresOn!: string | null;

  @Column({
    type: 'enum',
    enum: PANTRY_STATUSES,
    enumName: 'pantry_status',
    default: 'active',
  })
  status!: PantryStatus;

  @Column({
    type: 'enum',
    enum: PANTRY_SOURCES,
    enumName: 'pantry_source',
    default: 'manual',
  })
  source!: (typeof PANTRY_SOURCES)[number];

  /** Added from a delivered grocery order (once per line). */
  @Column({ type: 'uuid', name: 'store_order_item_id', nullable: true })
  storeOrderItemId!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  notes!: string | null;

  @Column({ type: 'smallint', default: 0 })
  reminded!: number;

  @Column({ type: 'timestamptz', name: 'closed_at', nullable: true })
  closedAt!: Date | null;
}
