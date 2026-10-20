import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Product } from './product.entity';

/**
 * A purchasable variant (e.g. size M / colour Maroon). Every product has at
 * least one; a product without options has a single "default" variant with
 * both options null. Stock lives here and only here, and can never go below
 * zero (CHECK) — checkout decrements it under a row lock.
 *
 * (product, option1, option2) is unique with NULLS NOT DISTINCT, so two
 * "default" variants cannot exist either (migration-defined index).
 */
@Entity('product_variants')
@Check('CHK_product_variants_stock', '"stock" >= 0')
@Check(
  'CHK_product_variants_pack',
  '("pack_qty" IS NULL) = ("pack_unit" IS NULL) AND ("pack_qty" IS NULL OR "pack_qty" > 0) AND ("pack_unit" IS NULL OR "pack_unit" IN (\'g\', \'kg\', \'ml\', \'l\', \'piece\', \'dozen\'))',
)
// (product_id, option1, option2) UNIQUE NULLS NOT DISTINCT — defined in the
// ShopProducts migration; declared here so schema sync leaves it alone.
@Index('UQ_product_variants_options', { synchronize: false })
@Index(['productId'])
export class ProductVariant extends BaseEntity {
  @Column({ type: 'uuid', name: 'product_id' })
  productId!: string;

  @ManyToOne(() => Product, (p) => p.variants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  /** e.g. size. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  option1!: string | null;

  /** e.g. colour. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  option2!: string | null;

  @Column({ type: 'varchar', length: 7, name: 'color_hex', nullable: true })
  colorHex!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sku!: string | null;

  /** Added to the product's effective price for this variant (may be negative). */
  @Column({ type: 'int', name: 'price_delta', default: 0 })
  priceDelta!: number;

  @Column({ type: 'int', default: 0 })
  stock!: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  /** Display order, as the partner listed the variants. */
  @Column({ type: 'int', default: 0 })
  sort!: number;

  /** This size's pack, overriding the product's (a 5 kg bag next to the 1 kg one). */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 3,
    name: 'pack_qty',
    nullable: true,
    transformer: {
      to: (v: number | null | undefined) => v,
      from: (v: string | null) =>
        v === null || v === undefined ? null : Number(v),
    },
  })
  packQty!: number | null;

  @Column({ type: 'varchar', length: 8, name: 'pack_unit', nullable: true })
  packUnit!: string | null;
}
