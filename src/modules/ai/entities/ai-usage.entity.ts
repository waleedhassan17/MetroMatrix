import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';
import { Business } from '../../businesses/entities/business.entity';

export const AI_USAGE_STATUSES = [
  'ok',
  'invalid',
  'timeout',
  'quota',
  'error',
] as const;
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number];

/**
 * One row per AI call — what it cost and how it went. Quotas count this
 * month's rows (cache hits and quota refusals excluded); the admin AI
 * dashboard reads it by feature, business, failures and latency.
 */
@Entity('ai_usage')
@Index(['businessId', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['feature', 'createdAt'])
export class AiUsage extends BaseEntity {
  /** Vendor calls count against the business; customer calls have none. */
  @Column({ type: 'uuid', name: 'business_id', nullable: true })
  businessId!: string | null;

  @ManyToOne(() => Business, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'business_id' })
  business?: Business;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 40 })
  feature!: string;

  @Column({ type: 'varchar', length: 60, name: 'prompt_id' })
  promptId!: string;

  @Column({ type: 'smallint', name: 'prompt_version' })
  promptVersion!: number;

  @Column({ type: 'int', name: 'tokens_in', default: 0 })
  tokensIn!: number;

  @Column({ type: 'int', name: 'tokens_out', default: 0 })
  tokensOut!: number;

  @Column({ type: 'int', name: 'latency_ms', default: 0 })
  latencyMs!: number;

  @Column({
    type: 'enum',
    enum: AI_USAGE_STATUSES,
    enumName: 'ai_usage_status',
  })
  status!: AiUsageStatus;

  /** Served from ai_cache: free, not counted against the quota. */
  @Column({ type: 'boolean', default: false })
  cached!: boolean;

  /** Voice: the clip's length (voice_minutes_month). */
  @Column({ type: 'int', name: 'audio_seconds', default: 0 })
  audioSeconds!: number;
}
