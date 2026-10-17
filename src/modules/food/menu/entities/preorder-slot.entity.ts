import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Branch } from '../../vendor/entities/branch.entity';

/**
 * Home kitchens: a weekly pre-order slot (Friday 13:00) taking at most
 * `max_orders`, closing `cutoff_minutes_before` the slot.
 */
@Entity('preorder_slots')
@Index(['branchId', 'weekday', 'slotStart'], { unique: true })
@Check(
  'CHK_preorder_slots',
  '"weekday" BETWEEN 0 AND 6 AND "max_orders" >= 1 AND "cutoff_minutes_before" >= 0',
)
export class PreorderSlot extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'smallint' })
  weekday!: number;

  @Column({ type: 'time', name: 'slot_start' })
  slotStart!: string;

  @Column({ type: 'int', name: 'cutoff_minutes_before', default: 120 })
  cutoffMinutesBefore!: number;

  @Column({ type: 'int', name: 'max_orders' })
  maxOrders!: number;
}
