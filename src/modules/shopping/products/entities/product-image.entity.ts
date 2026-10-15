import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Product } from './product.entity';

/** 1–8 per product; the lowest `sort` is the cover. */
@Entity('product_images')
@Index(['productId', 'sort'])
export class ProductImage extends BaseEntity {
  @Column({ type: 'uuid', name: 'product_id' })
  productId!: string;

  @ManyToOne(() => Product, (p) => p.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ type: 'varchar', length: 500 })
  url!: string;

  @Column({ type: 'varchar', length: 255, name: 'public_id' })
  publicId!: string;

  @Column({ type: 'int', default: 0 })
  sort!: number;
}
