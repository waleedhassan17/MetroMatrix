import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Business } from '../../../businesses/entities/business.entity';

export const BRAND_STATUSES = ['active', 'paused'] as const;
export type BrandStatus = (typeof BRAND_STATUSES)[number];

const decimal = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : parseFloat(v)),
};

/**
 * A vendor's customer-facing brand: name, logo, cuisines, rating. Exactly one
 * per food business at launch (`business_id` unique); chains later add
 * branches, not brands. Created on approval.
 */
@Entity('food_brands')
@Index(['businessId'], { unique: true })
@Check('CHK_food_brands_price_level', '"price_level" BETWEEN 1 AND 3')
export class FoodBrand extends BaseEntity {
  @Column({ type: 'uuid', name: 'business_id' })
  businessId!: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business?: Business;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'citext' })
  slug!: string;

  @Column({ type: 'varchar', length: 140, nullable: true })
  tagline!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'logo_url', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'cover_url', nullable: true })
  coverUrl!: string | null;

  @Column({
    type: 'varchar',
    length: 7,
    name: 'brand_color',
    default: '#B4532A',
  })
  brandColor!: string;

  @Column({
    type: 'varchar',
    length: 7,
    name: 'on_brand_color',
    default: '#FFFFFF',
  })
  onBrandColor!: string;

  @Column({
    type: 'uuid',
    array: true,
    name: 'cuisine_ids',
    default: () => "'{}'",
  })
  cuisineIds!: string[];

  /** 1 = budget, 2 = mid, 3 = premium ("Rs", "Rs Rs", "Rs Rs Rs"). */
  @Column({ type: 'smallint', name: 'price_level', default: 2 })
  priceLevel!: number;

  @Column({ type: 'boolean', name: 'is_home_kitchen', default: false })
  isHomeKitchen!: boolean;

  @Column({
    type: 'enum',
    enum: BRAND_STATUSES,
    enumName: 'food_brand_status',
    default: 'active',
  })
  status!: BrandStatus;

  @Column({ type: 'boolean', name: 'is_featured', default: false })
  isFeatured!: boolean;

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

  @Column({
    type: 'tsvector',
    select: false,
    insert: false,
    update: false,
    nullable: true,
  })
  search?: string;
}
