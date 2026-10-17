import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { MenuItem } from '../../menu/entities/menu-item.entity';
import { FoodCart } from './food-cart.entity';

/**
 * A line: an item, its variant and options, a quantity. Variant and option
 * ids are not foreign keys — a menu edit leaves the line in place and the
 * cart reports it (warnings), instead of silently dropping it.
 */
@Entity('food_cart_items')
@Index(['cartId'])
@Check('CHK_food_cart_items_quantity', '"quantity" BETWEEN 1 AND 50')
export class FoodCartItem extends BaseEntity {
  @Column({ type: 'uuid', name: 'cart_id' })
  cartId!: string;

  @ManyToOne(() => FoodCart, (c) => c.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart?: FoodCart;

  @Column({ type: 'uuid', name: 'item_id' })
  itemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: MenuItem;

  @Column({ type: 'uuid', name: 'variant_id', nullable: true })
  variantId!: string | null;

  @Column({ type: 'uuid', array: true, name: 'option_ids', default: '{}' })
  optionIds!: string[];

  @Column({ type: 'smallint' })
  quantity!: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  notes!: string | null;

  /** The unit price when added, so the cart can say "price changed". */
  @Column({ type: 'int', name: 'unit_price_seen' })
  unitPriceSeen!: number;
}
