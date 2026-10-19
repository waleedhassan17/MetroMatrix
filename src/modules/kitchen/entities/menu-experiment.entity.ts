import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { MenuItem } from '../../food/menu/entities/menu-item.entity';
import { Branch } from '../../food/vendor/entities/branch.entity';

export const EXPERIMENT_STATUSES = [
  'active',
  'completed',
  'cancelled',
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

/**
 * A dish on trial for N days. The result compares its daily sales and margin
 * with the median dish of its category and with the forecast, and says
 * keep / adjust / drop (menu-engineering.ts). `active` shows as planned or
 * running by date; the nightly job completes it and stores the result.
 */
@Entity('menu_experiments')
@Index('UQ_menu_experiments_active_item', ['menuItemId'], {
  unique: true,
  where: `"status" = 'active'`,
})
@Index(['branchId', 'status'])
@Check('CHK_menu_experiments_dates', '"ends_on" >= "starts_on"')
export class MenuExperiment extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'uuid', name: 'menu_item_id' })
  menuItemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'menu_item_id' })
  item?: MenuItem;

  @Column({ type: 'date', name: 'starts_on' })
  startsOn!: string;

  @Column({ type: 'date', name: 'ends_on' })
  endsOn!: string;

  @Column({
    type: 'enum',
    enum: EXPERIMENT_STATUSES,
    enumName: 'experiment_status',
    default: 'active',
  })
  status!: ExperimentStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  result!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt!: Date | null;
}
