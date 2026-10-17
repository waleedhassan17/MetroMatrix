import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { FoodOrder } from './food-order.entity';

export interface OrderedOption {
  id: string;
  name: string;
  group: string;
  priceDelta: number;
}

/** A line as it was sold: names and prices copied, so menu edits never change it. */
@Entity('food_order_items')
@Index(['orderId', 'lineNo'], { unique: true })
@Check(
  'CHK_food_order_items',
  '"quantity" BETWEEN 1 AND 50 AND "unit_price" >= 0 AND "line_total" = "unit_price" * "quantity" AND "portions_taken" >= 0',
)
export class FoodOrderItem extends BaseEntity {
  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @ManyToOne(() => FoodOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: FoodOrder;

  @Column({ type: 'smallint', name: 'line_no' })
  lineNo!: number;

  /** Not a foreign key: the item may be deleted later; the snapshot stays. */
  @Column({ type: 'uuid', name: 'item_id', nullable: true })
  itemId!: string | null;

  @Column({ type: 'uuid', name: 'variant_id', nullable: true })
  variantId!: string | null;

  @Column({ type: 'varchar', length: 120, name: 'item_name' })
  itemName!: string;

  @Column({
    type: 'varchar',
    length: 60,
    name: 'variant_name',
    nullable: true,
  })
  variantName!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  options!: OrderedOption[];

  @Column({ type: 'int', name: 'unit_price' })
  unitPrice!: number;

  @Column({ type: 'smallint' })
  quantity!: number;

  @Column({ type: 'int', name: 'line_total' })
  lineTotal!: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  notes!: string | null;

  /** Portions taken from today's count (given back if the order is cancelled that day). */
  @Column({ type: 'smallint', name: 'portions_taken', default: 0 })
  portionsTaken!: number;
}
