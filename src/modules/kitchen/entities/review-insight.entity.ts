import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { FoodBrand } from '../../food/vendor/entities/food-brand.entity';

export const INSIGHT_METHODS = ['ai', 'lexicon'] as const;

/**
 * What a kitchen's recent reviews keep saying: themes with counts and up to
 * two anonymised quotes each. Written nightly once 5 new reviews are in
 * (review_themes@1, or the keyword lexicon without AI); one row a day at most.
 */
@Entity('review_insights')
@Index('UQ_review_insights_brand_day', ['brandId', 'periodEnd'], {
  unique: true,
})
export class ReviewInsight extends BaseEntity {
  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'date', name: 'period_start' })
  periodStart!: string;

  @Column({ type: 'date', name: 'period_end' })
  periodEnd!: string;

  @Column({ type: 'int', name: 'review_count' })
  reviewCount!: number;

  /** [{ theme, sentiment, count, examples }] */
  @Column({ type: 'jsonb' })
  themes!: Array<{
    theme: string;
    sentiment: 'positive' | 'negative';
    count: number;
    examples: string[];
  }>;

  @Column({
    type: 'enum',
    enum: INSIGHT_METHODS,
    enumName: 'review_insight_method',
  })
  method!: (typeof INSIGHT_METHODS)[number];

  @Column({ type: 'varchar', length: 160, nullable: true })
  headline!: string | null;

  /** The latest review it covers, to the millisecond (the next run starts after it). */
  @Column({ type: 'timestamptz', name: 'covered_until' })
  coveredUntil!: Date;

  @Column({ type: 'timestamptz', name: 'pushed_at', nullable: true })
  pushedAt!: Date | null;
}
