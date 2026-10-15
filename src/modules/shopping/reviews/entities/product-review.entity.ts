import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { StoreOrderItem } from '../../orders/entities/store-order-item.entity';
import { Product } from '../../products/entities/product.entity';
import { Store } from '../../stores/entities/store.entity';
import { User } from '../../../users/entities/user.entity';

/**
 * A verified-purchase review: one per order line (unique), only once the
 * line was delivered. Product and store rating aggregates are recomputed in
 * the same transaction whenever a review is created, hidden or unhidden.
 */
@Entity('product_reviews')
@Index(['storeOrderItemId'], { unique: true })
@Index(['productId', 'isHidden', 'createdAt'])
@Index(['storeId', 'createdAt'])
@Check('CHK_product_reviews_rating', '"rating" BETWEEN 1 AND 5')
export class ProductReview extends BaseEntity {
  @Column({ type: 'uuid', name: 'store_order_item_id' })
  storeOrderItemId!: string;

  @ManyToOne(() => StoreOrderItem)
  @JoinColumn({ name: 'store_order_item_id' })
  storeOrderItem?: StoreOrderItem;

  @Column({ type: 'uuid', name: 'product_id' })
  productId!: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'smallint' })
  rating!: number;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ type: 'text', array: true })
  photos!: string[];

  @Column({ type: 'text', name: 'store_reply', nullable: true })
  storeReply!: string | null;

  @Column({ type: 'timestamptz', name: 'replied_at', nullable: true })
  repliedAt!: Date | null;

  @Column({ type: 'boolean', name: 'is_hidden', default: false })
  isHidden!: boolean;

  @Column({ type: 'text', name: 'hidden_reason', nullable: true })
  hiddenReason!: string | null;
}
