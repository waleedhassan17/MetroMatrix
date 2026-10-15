import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { StoreOrder } from './store-order.entity';
import { Product } from '../../products/entities/product.entity';
import { ProductVariant } from '../../products/entities/product-variant.entity';

/**
 * A snapshotted order line: name, label, image and price as they were at
 * checkout. The product and variant FKs block hard-deleting anything that
 * was ever ordered (the product is archived instead).
 */
@Entity('store_order_items')
@Index(['storeOrderId'])
@Index(['productId'])
@Index(['variantId'])
@Check(
  'CHK_store_order_items_amounts',
  '"quantity" > 0 AND "unit_price" > 0 AND "line_total" = "unit_price" * "quantity" AND "returned_qty" BETWEEN 0 AND "quantity"',
)
export class StoreOrderItem extends BaseEntity {
  @Column({ type: 'uuid', name: 'store_order_id' })
  storeOrderId!: string;

  @ManyToOne(() => StoreOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_order_id' })
  storeOrder?: StoreOrder;

  @Column({ type: 'uuid', name: 'product_id' })
  productId!: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ type: 'uuid', name: 'variant_id' })
  variantId!: string;

  @ManyToOne(() => ProductVariant)
  @JoinColumn({ name: 'variant_id' })
  variant?: ProductVariant;

  @Column({ type: 'varchar', length: 140, name: 'product_name' })
  productName!: string;

  @Column({ type: 'varchar', length: 90, name: 'variant_label' })
  variantLabel!: string;

  @Column({ type: 'varchar', length: 500, name: 'image_url', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'int', name: 'unit_price' })
  unitPrice!: number;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'int', name: 'line_total' })
  lineTotal!: number;

  @Column({ type: 'int', name: 'returned_qty', default: 0 })
  returnedQty!: number;
}
