import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { Branch } from '../../food/vendor/entities/branch.entity';

export const KITCHEN_ALERT_KINDS = [
  'sold_out_stock',
  'back_in_stock',
  'stock_negative',
  'expiring',
  'expired',
  'food_cost_high',
  'price_above_reference',
] as const;
export type KitchenAlertKind = (typeof KITCHEN_ALERT_KINDS)[number];

/**
 * An outbox for kitchen notifications: written in the same transaction as
 * the stock change, sent to the owner right after commit (and by a job as a
 * safety net), so a rolled-back accept never notifies.
 */
@Entity('kitchen_alerts')
@Index('IDX_kitchen_alerts_pending', ['createdAt'], {
  where: '"sent_at" IS NULL',
})
@Index(['branchId', 'createdAt'])
export class KitchenAlert extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({
    type: 'enum',
    enum: KITCHEN_ALERT_KINDS,
    enumName: 'kitchen_alert_kind',
  })
  kind!: KitchenAlertKind;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'varchar', length: 300 })
  body!: string;

  /** { itemId?, ingredientId?, batchId?, screen } for the app's deep link. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  data!: Record<string, unknown>;

  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt!: Date | null;
}
