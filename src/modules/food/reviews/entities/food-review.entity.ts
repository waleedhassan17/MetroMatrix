import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';
import { FoodBrand } from '../../vendor/entities/food-brand.entity';
import { FoodOrder } from '../../orders/entities/food-order.entity';

export const FOOD_REVIEW_TAGS = [
  'tasty',
  'hot_and_fresh',
  'good_portion',
  'well_packed',
  'on_time',
  'polite_rider',
  'value_for_money',
] as const;
export type FoodReviewTag = (typeof FOOD_REVIEW_TAGS)[number];

/** One review per order, after it was delivered or collected. */
@Entity('food_reviews')
@Index(['orderId'], { unique: true })
@Index(['brandId', 'createdAt'])
@Check(
  'CHK_food_reviews_ratings',
  '"food_rating" BETWEEN 1 AND 5 AND ("delivery_rating" IS NULL OR "delivery_rating" BETWEEN 1 AND 5)',
)
export class FoodReview extends BaseEntity {
  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @ManyToOne(() => FoodOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: FoodOrder;

  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'smallint', name: 'food_rating' })
  foodRating!: number;

  /** Delivery orders only. */
  @Column({ type: 'smallint', name: 'delivery_rating', nullable: true })
  deliveryRating!: number | null;

  @Column({ type: 'text', array: true, default: '{}' })
  tags!: FoodReviewTag[];

  @Column({ type: 'varchar', length: 1000, nullable: true })
  text!: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  photos!: string[];

  @Column({
    type: 'varchar',
    length: 1000,
    name: 'vendor_reply',
    nullable: true,
  })
  vendorReply!: string | null;

  @Column({ type: 'timestamptz', name: 'replied_at', nullable: true })
  repliedAt!: Date | null;

  /** Hidden by staff (moderation): out of every rating and list. */
  @Column({ type: 'boolean', name: 'is_hidden', default: false })
  isHidden!: boolean;

  @Column({
    type: 'varchar',
    length: 300,
    name: 'hidden_reason',
    nullable: true,
  })
  hiddenReason!: string | null;
}
