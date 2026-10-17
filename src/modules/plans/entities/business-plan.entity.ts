import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { Business } from '../../businesses/entities/business.entity';
import type { PlanOverrides } from '../plan-config';

/** The plan a partner business is on (Food vendors: `community`). */
@Entity('business_plans')
@Index(['businessId'], { unique: true })
export class BusinessPlan extends BaseEntity {
  @Column({ type: 'uuid', name: 'business_id' })
  businessId!: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business?: Business;

  @Column({ type: 'varchar', length: 40, name: 'plan_key' })
  planKey!: string;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  /** null = no expiry. */
  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  /** Admin per-vendor overrides (limits, entitlements). */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  overrides!: PlanOverrides;
}
