import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { Branch } from '../../food/vendor/entities/branch.entity';
import { numeric } from '../common/numeric';

/**
 * A dish's cost and food cost % at the start of a week (written weekly, and
 * on first look), so costing shows a trend and alerts on a rise of more than
 * 5 points week on week. Variant null = the dish's own price.
 */
@Entity('item_cost_snapshots')
@Index('UQ_item_cost_snapshots', ['menuItemId', 'variantKey', 'weekStart'], {
  unique: true,
})
@Index(['branchId', 'weekStart'])
export class ItemCostSnapshot extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'uuid', name: 'menu_item_id' })
  menuItemId!: string;

  /** The variant id, or '-' for the dish's own price (keeps the unique key simple). */
  @Column({ type: 'varchar', length: 36, name: 'variant_key', default: '-' })
  variantKey!: string;

  @Column({ type: 'date', name: 'week_start' })
  weekStart!: string;

  /** Rupees per serving at average cost. */
  @Column({ ...numeric(10, 2) })
  cost!: number;

  @Column({ type: 'int' })
  price!: number;

  @Column({ ...numeric(5, 1), name: 'food_cost_pct' })
  foodCostPct!: number;
}
