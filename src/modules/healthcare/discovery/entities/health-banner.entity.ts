import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';

export const HEALTH_BANNER_TARGETS = [
  'specialty',
  'condition',
  'doctor',
  'screen',
  'none',
] as const;
export type HealthBannerTarget = (typeof HEALTH_BANNER_TARGETS)[number];

/** The app's Health screens a banner may open. */
export const HEALTH_BANNER_SCREENS = [
  'video_consultation',
  'symptom_checker',
  'emergency',
  'records',
  'available_today',
] as const;
export type HealthBannerScreen = (typeof HEALTH_BANNER_SCREENS)[number];

/**
 * Health home promotions, managed by staff (/admin/health/banners). A banner
 * opens a specialty, a condition, a doctor or one of the app's Health
 * screens, or nothing. `city` null shows it in every city.
 */
@Entity('health_banners')
@Index(['isActive', 'sort'])
@Check(
  'CHK_health_banners_target',
  `("target_type" = 'screen' AND "target_screen" IS NOT NULL AND "target_id" IS NULL) OR ("target_type" = 'none' AND "target_id" IS NULL AND "target_screen" IS NULL) OR ("target_type" IN ('specialty', 'condition', 'doctor') AND "target_id" IS NOT NULL AND "target_screen" IS NULL)`,
)
@Check(
  'CHK_health_banners_window',
  '"starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"',
)
export class HealthBanner extends BaseEntity {
  @Column({ type: 'varchar', length: 500, name: 'image_url' })
  imageUrl!: string;

  @Column({ type: 'varchar', length: 80 })
  title!: string;

  @Column({ type: 'varchar', length: 140, nullable: true })
  subtitle!: string | null;

  @Column({
    type: 'enum',
    enum: HEALTH_BANNER_TARGETS,
    enumName: 'health_banner_target',
    name: 'target_type',
    default: 'none',
  })
  targetType!: HealthBannerTarget;

  @Column({ type: 'uuid', name: 'target_id', nullable: true })
  targetId!: string | null;

  @Column({
    type: 'enum',
    enum: HEALTH_BANNER_SCREENS,
    enumName: 'health_banner_screen',
    name: 'target_screen',
    nullable: true,
  })
  targetScreen!: HealthBannerScreen | null;

  /** Null: every city. Otherwise matched case-insensitively. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  city!: string | null;

  @Column({ type: 'timestamptz', name: 'starts_at', nullable: true })
  startsAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'ends_at', nullable: true })
  endsAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  sort!: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
