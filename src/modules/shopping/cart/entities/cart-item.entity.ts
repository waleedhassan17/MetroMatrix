import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Cart } from './cart.entity';
import { ProductVariant } from '../../products/entities/product-variant.entity';

export const MAX_LINE_QUANTITY = 20;

/**
 * A cart line, one per variant. `price_at_add` is the unit price the customer
 * last saw; when the live price differs the cart flags PRICE_CHANGED (and
 * checkout charges the live price).
 */
@Entity('cart_items')
@Check('CHK_cart_items_quantity', '"quantity" BETWEEN 1 AND 20')
@Index(['cartId', 'variantId'], { unique: true })
@Index(['variantId'])
export class CartItem extends BaseEntity {
  @Column({ type: 'uuid', name: 'cart_id' })
  cartId!: string;

  @ManyToOne(() => Cart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart?: Cart;

  @Column({ type: 'uuid', name: 'variant_id' })
  variantId!: string;

  @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'variant_id' })
  variant?: ProductVariant;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'int', name: 'price_at_add' })
  priceAtAdd!: number;
}
