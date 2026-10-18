import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { FoodBrand } from '../../vendor/entities/food-brand.entity';
import { MenuCategory } from './menu-category.entity';

export const ITEM_TAGS = [
  'spicy',
  'veg',
  'bestseller',
  'new',
  'contains_nuts',
] as const;
export type ItemTag = (typeof ITEM_TAGS)[number];

/** Every day of the week (bit 0 = Sunday … bit 6 = Saturday). */
export const EVERY_DAY_MASK = 127;

@Entity('menu_items')
@Index(['brandId', 'categoryId', 'sort'])
@Index('IDX_menu_items_search', { synchronize: false })
@Index('IDX_menu_items_name_trgm', { synchronize: false })
@Check(
  'CHK_menu_items_numbers',
  '"base_price" >= 0 AND "days_mask" BETWEEN 1 AND 127 AND ("serves" IS NULL OR "serves" BETWEEN 1 AND 50)',
)
export class MenuItem extends BaseEntity {
  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'uuid', name: 'category_id' })
  categoryId!: string;

  @ManyToOne(() => MenuCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category?: MenuCategory;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** The name in Urdu script ("چکن بریانی"): shown to Urdu readers, matched by voice. */
  @Column({ type: 'varchar', length: 120, name: 'name_ur', nullable: true })
  nameUr!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'photo_url', nullable: true })
  photoUrl!: string | null;

  /** Rupees. With variants, each variant's own (absolute) price applies instead. */
  @Column({ type: 'int', name: 'base_price' })
  basePrice!: number;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: ItemTag[];

  @Column({ type: 'boolean', name: 'is_deal', default: false })
  isDeal!: boolean;

  @Column({ type: 'smallint', nullable: true })
  serves!: number | null;

  /** Weekdays it is on the menu (weekly menus, "Friday special"). */
  @Column({ type: 'smallint', name: 'days_mask', default: EVERY_DAY_MASK })
  daysMask!: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sort!: number;

  @Column({ type: 'int', name: 'sold_30d', default: 0 })
  sold30d!: number;

  @Column({
    type: 'tsvector',
    select: false,
    insert: false,
    update: false,
    nullable: true,
  })
  search?: string;
}
