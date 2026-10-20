import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Store } from '../../stores/entities/store.entity';
import { StoreCollection } from '../../stores/entities/store-collection.entity';
import { ShopCategory } from '../../catalog/entities/shop-category.entity';
import { ProductImage } from './product-image.entity';
import { ProductVariant } from './product-variant.entity';

export const PRODUCT_STATUSES = [
  'draft',
  'active',
  'archived',
  'removed',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

const decimal = {
  to: (v?: number | null) => v,
  from: (v: string | null) => (v === null ? null : parseFloat(v)),
};

/**
 * A product a store sells. Prices are integer rupees; the price a customer
 * pays for a line is `(sale_price ?? base_price) + variant.price_delta`.
 *
 * `search` is a weighted tsvector (name A, tags B, description C) kept current
 * by a trigger (see the ShopProducts migration) — a generated column cannot
 * use array_to_string(), which is not IMMUTABLE. Typos fall back to trigram
 * similarity on `name`.
 *
 * `removed` is set by an admin only and hides the product everywhere.
 */
@Entity('products')
@Check(
  'CHK_products_prices',
  '"base_price" > 0 AND ("sale_price" IS NULL OR ("sale_price" > 0 AND "sale_price" < "base_price"))',
)
@Check(
  'CHK_products_pack',
  '("pack_qty" IS NULL) = ("pack_unit" IS NULL) AND ("pack_qty" IS NULL OR "pack_qty" > 0) AND ("pack_unit" IS NULL OR "pack_unit" IN (\'g\', \'kg\', \'ml\', \'l\', \'piece\', \'dozen\'))',
)
@Index(['storeId', 'slug'], { unique: true })
@Index(['storeId', 'status'])
@Index(['status', 'publishedAt'])
@Index(['categoryId'])
export class Product extends BaseEntity {
  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  /** Grocery pack size (Chunk 5): "500 g", "1 l", "12 piece". Both or neither. */
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

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  @Column({ type: 'uuid', name: 'category_id' })
  categoryId!: string;

  @ManyToOne(() => ShopCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category?: ShopCategory;

  @Column({ type: 'uuid', name: 'collection_id', nullable: true })
  collectionId!: string | null;

  @ManyToOne(() => StoreCollection, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'collection_id' })
  collection?: StoreCollection | null;

  @Index('IDX_products_name_trgm', { synchronize: false })
  @Column({ type: 'varchar', length: 140 })
  name!: string;

  /** Unique within the store. */
  @Column({ type: 'citext' })
  slug!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'int', name: 'base_price' })
  basePrice!: number;

  @Column({ type: 'int', name: 'sale_price', nullable: true })
  salePrice!: number | null;

  @Column({
    type: 'enum',
    enum: PRODUCT_STATUSES,
    enumName: 'product_status',
    default: 'draft',
  })
  status!: ProductStatus;

  @Column({ type: 'text', name: 'removed_reason', nullable: true })
  removedReason!: string | null;

  @Column({ type: 'text', array: true })
  tags!: string[];

  @Column({
    type: 'numeric',
    precision: 3,
    scale: 2,
    name: 'rating_avg',
    default: 0,
    transformer: decimal,
  })
  ratingAvg!: number;

  @Column({ type: 'int', name: 'rating_count', default: 0 })
  ratingCount!: number;

  /** Units sold (placed, not cancelled). */
  @Column({ type: 'int', name: 'sold_count', default: 0 })
  soldCount!: number;

  /** First time the product went live — "new arrivals" order by it. */
  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt!: Date | null;

  /** Maintained by the products_search_refresh trigger. Never written here. */
  @Index('IDX_products_search', { synchronize: false })
  @Column({
    type: 'tsvector',
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  search?: string | null;

  @OneToMany(() => ProductImage, (i) => i.product)
  images?: ProductImage[];

  @OneToMany(() => ProductVariant, (v) => v.product)
  variants?: ProductVariant[];
}
