import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Branch } from '../../vendor/entities/branch.entity';
import { MenuItem } from './menu-item.entity';

/**
 * A branch's say on an item: off ("86'd", optionally until a time) and,
 * for home kitchens, today's portions (`remaining_today`, decremented
 * atomically at checkout, reset nightly from `daily_limit`). No price
 * overrides at launch.
 */
@Entity('branch_item_overrides')
@Index(['branchId', 'itemId'], { unique: true })
@Check(
  'CHK_branch_item_overrides_portions',
  '("daily_limit" IS NULL OR "daily_limit" >= 0) AND ("remaining_today" IS NULL OR "remaining_today" >= 0)',
)
export class BranchItemOverride extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'uuid', name: 'item_id' })
  itemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: MenuItem;

  @Column({ type: 'boolean', name: 'is_available', default: true })
  isAvailable!: boolean;

  @Column({ type: 'timestamptz', name: 'unavailable_until', nullable: true })
  unavailableUntil!: Date | null;

  @Column({ type: 'int', name: 'daily_limit', nullable: true })
  dailyLimit!: number | null;

  @Column({ type: 'int', name: 'remaining_today', nullable: true })
  remainingToday!: number | null;
}
