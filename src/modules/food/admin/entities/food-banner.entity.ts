import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';

export const FOOD_BANNER_TARGETS = ['vendor', 'cuisine', 'search'] as const;
export type FoodBannerTarget = (typeof FOOD_BANNER_TARGETS)[number];

/**
 * A staff-curated banner on the Food home, live between its dates, for one
 * city or everywhere. A banner whose vendor or cuisine is gone is skipped.
 */
@Entity('food_banners')
@Index(['isActive', 'startsAt'])
export class FoodBanner extends BaseEntity {
  @Column({ type: 'varchar', length: 500, name: 'image_url' })
  imageUrl!: string;

  @Column({ type: 'varchar', length: 80 })
  title!: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  subtitle!: string | null;

  @Column({
    type: 'enum',
    enum: FOOD_BANNER_TARGETS,
    enumName: 'food_banner_target',
    name: 'target_type',
  })
  targetType!: FoodBannerTarget;

  /** vendor (brand) or cuisine id. */
  @Column({ type: 'uuid', name: 'target_id', nullable: true })
  targetId!: string | null;

  /** search: the query the banner opens. */
  @Column({ type: 'varchar', length: 80, name: 'target_query', nullable: true })
  targetQuery!: string | null;

  /** null = every city. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  city!: string | null;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  @Column({ type: 'timestamptz', name: 'ends_at', nullable: true })
  endsAt!: Date | null;

  @Column({ type: 'smallint', default: 0 })
  sort!: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
