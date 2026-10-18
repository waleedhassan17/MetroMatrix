import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';
import { numeric } from '../common/numeric';
import { KitchenIngredient } from './kitchen-ingredient.entity';
import { StockBatch } from './stock-batch.entity';

export const MOVEMENT_REASONS = [
  'purchase',
  'order',
  'order_cancel',
  'waste',
  'count_adjust',
  'manual',
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/**
 * Append-only ledger of every stock change: one row per batch touched (a
 * shortfall has no batch). `balance_after` is the ingredient's on-hand after
 * this row; `unit_cost` what the quantity was worth (for food cost and waste
 * cost). `created_at` is the spec's `at`.
 */
@Entity('stock_movements')
@Index(['ingredientId', 'createdAt'])
@Index(['refType', 'refId'])
export class StockMovement extends BaseEntity {
  @Column({ type: 'uuid', name: 'ingredient_id' })
  ingredientId!: string;

  @ManyToOne(() => KitchenIngredient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ingredient_id' })
  ingredient?: KitchenIngredient;

  @Column({ type: 'uuid', name: 'batch_id', nullable: true })
  batchId!: string | null;

  @ManyToOne(() => StockBatch, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'batch_id' })
  batch?: StockBatch;

  /** Base units; negative = out. */
  @Column({ ...numeric(14, 3) })
  delta!: number;

  @Column({
    type: 'enum',
    enum: MOVEMENT_REASONS,
    enumName: 'stock_movement_reason',
  })
  reason!: MovementReason;

  /** food_order | purchase | waste | count | manual */
  @Column({ type: 'varchar', length: 20, name: 'ref_type', nullable: true })
  refType!: string | null;

  @Column({ type: 'uuid', name: 'ref_id', nullable: true })
  refId!: string | null;

  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id' })
  actor?: User;

  @Column({ ...numeric(14, 3), name: 'balance_after' })
  balanceAfter!: number;

  @Column({ ...numeric(12, 4), name: 'unit_cost' })
  unitCost!: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note!: string | null;
}
