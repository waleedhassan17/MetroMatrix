import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { FoodBrand } from '../../vendor/entities/food-brand.entity';

export const PROMOTION_KINDS = [
  'percent_off_order',
  'percent_off_items',
  'flat_off',
  'free_delivery',
] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

/**
 * A vendor-funded deal. `code` null = an automatic deal shown on cards;
 * otherwise the customer types it. One promotion per order: the best for
 * the customer (promotions/best-promotion.ts).
 */
@Entity('food_promotions')
@Index(['brandId', 'isActive'])
@Index('UQ_food_promotions_code', ['brandId', 'code'], {
  unique: true,
  where: '"code" IS NOT NULL',
})
@Check(
  'CHK_food_promotions_value',
  `"value" >= 0 AND ("kind" NOT IN ('percent_off_order', 'percent_off_items') OR "value" BETWEEN 1 AND 100)`,
)
@Check(
  'CHK_food_promotions_counts',
  '"used_count" >= 0 AND "min_order" >= 0 AND ("usage_limit" IS NULL OR "usage_limit" >= 1) AND ("per_user_limit" IS NULL OR "per_user_limit" >= 1)',
)
export class FoodPromotion extends BaseEntity {
  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'varchar', length: 80 })
  title!: string;

  @Column({
    type: 'enum',
    enum: PROMOTION_KINDS,
    enumName: 'food_promotion_kind',
  })
  kind!: PromotionKind;

  /** Percent (1–100) or rupees; ignored for free_delivery. */
  @Column({ type: 'int', default: 0 })
  value!: number;

  /** percent_off_items: the items it applies to. */
  @Column({ type: 'uuid', array: true, name: 'item_ids', default: '{}' })
  itemIds!: string[];

  @Column({ type: 'int', name: 'min_order', default: 0 })
  minOrder!: number;

  @Column({ type: 'int', name: 'max_discount', nullable: true })
  maxDiscount!: number | null;

  @Column({ type: 'citext', nullable: true })
  code!: string | null;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  @Column({ type: 'timestamptz', name: 'ends_at', nullable: true })
  endsAt!: Date | null;

  /** Bit 0 = Sunday … bit 6 = Saturday, in the branch's timezone. */
  @Column({ type: 'smallint', name: 'weekdays_mask', default: 127 })
  weekdaysMask!: number;

  /** Happy hour: a daily window (may wrap midnight). */
  @Column({ type: 'time', name: 'time_from', nullable: true })
  timeFrom!: string | null;

  @Column({ type: 'time', name: 'time_to', nullable: true })
  timeTo!: string | null;

  @Column({ type: 'int', name: 'usage_limit', nullable: true })
  usageLimit!: number | null;

  @Column({ type: 'int', name: 'per_user_limit', nullable: true })
  perUserLimit!: number | null;

  @Column({ type: 'int', name: 'used_count', default: 0 })
  usedCount!: number;

  /** Only for a customer's first order from this vendor. */
  @Column({ type: 'boolean', name: 'first_order_only', default: false })
  firstOrderOnly!: boolean;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
