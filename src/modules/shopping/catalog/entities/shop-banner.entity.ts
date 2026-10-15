import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';

export const BANNER_TARGETS = [
  'store',
  'category',
  'collection',
  'product',
  'none',
] as const;
export type BannerTarget = (typeof BANNER_TARGETS)[number];

/** Home-screen promo banners, managed by admins (/admin/shop/banners). */
@Entity('shop_banners')
@Index(['isActive', 'sort'])
export class ShopBanner extends BaseEntity {
  @Column({ type: 'varchar', length: 500, name: 'image_url' })
  imageUrl!: string;

  @Column({ type: 'varchar', length: 80 })
  title!: string;

  @Column({ type: 'varchar', length: 140, nullable: true })
  subtitle!: string | null;

  @Column({
    type: 'enum',
    enum: BANNER_TARGETS,
    enumName: 'shop_banner_target',
    name: 'target_type',
    default: 'none',
  })
  targetType!: BannerTarget;

  @Column({ type: 'uuid', name: 'target_id', nullable: true })
  targetId!: string | null;

  @Column({ type: 'timestamptz', name: 'starts_at', nullable: true })
  startsAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'ends_at', nullable: true })
  endsAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  sort!: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
