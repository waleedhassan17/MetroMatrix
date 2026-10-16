import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';

export const SYMPTOM_SOURCES = ['red_flag', 'model', 'fallback'] as const;
export type SymptomSource = (typeof SYMPTOM_SOURCES)[number];

/**
 * One symptom-checker run: counts toward the per-user hourly limit (so the
 * limit survives restarts) and records what was suggested. The free text is
 * nulled after 30 days by the nightly job; the outcome stays for quality.
 */
@Entity('symptom_checks')
@Index(['userId', 'createdAt'])
export class SymptomCheck extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** Null once purged (30 days). */
  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({
    type: 'enum',
    enum: SYMPTOM_SOURCES,
    enumName: 'symptom_check_source',
  })
  source!: SymptomSource;

  @Column({ type: 'boolean' })
  emergency!: boolean;

  @Column({ type: 'jsonb' })
  result!: Record<string, unknown>;
}
