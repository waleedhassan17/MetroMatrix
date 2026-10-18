import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { numeric } from '../common/numeric';
import { KitchenIngredient } from './kitchen-ingredient.entity';

/**
 * A lot received (a purchase line, an opening stock, a count that found
 * more), consumed oldest first. `qty_remaining` never goes below zero: a
 * shortfall is a movement without a batch.
 */
@Entity('stock_batches')
@Index('IDX_stock_batches_fifo', ['ingredientId', 'receivedAt'], {
  where: '"qty_remaining" > 0',
})
@Index('IDX_stock_batches_expiry', ['expiresOn'], {
  where: '"qty_remaining" > 0 AND "expires_on" IS NOT NULL',
})
@Check(
  'CHK_stock_batches_numbers',
  '"qty_remaining" >= 0 AND "qty_received" > 0 AND "unit_cost" >= 0',
)
export class StockBatch extends BaseEntity {
  @Column({ type: 'uuid', name: 'ingredient_id' })
  ingredientId!: string;

  @ManyToOne(() => KitchenIngredient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ingredient_id' })
  ingredient?: KitchenIngredient;

  @Column({ ...numeric(14, 3), name: 'qty_received' })
  qtyReceived!: number;

  @Column({ ...numeric(14, 3), name: 'qty_remaining' })
  qtyRemaining!: number;

  /** Rupees per base unit. */
  @Column({ ...numeric(12, 4), name: 'unit_cost' })
  unitCost!: number;

  @Column({ type: 'timestamptz', name: 'received_at', default: () => 'now()' })
  receivedAt!: Date;

  @Column({ type: 'date', name: 'expires_on', nullable: true })
  expiresOn!: string | null;

  /** The purchase line that brought it (P2). */
  @Column({ type: 'uuid', name: 'purchase_line_id', nullable: true })
  purchaseLineId!: string | null;

  /** The expiry alert already sent: 3 (three days before), 1 (the day before), 0 (none). */
  @Column({ type: 'smallint', name: 'expiry_alerted', default: 0 })
  expiryAlerted!: number;
}
