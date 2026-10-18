import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';

export const VOICE_LOG_STATUSES = [
  'proposed',
  'unclear',
  'unavailable',
] as const;
export type VoiceLogStatus = (typeof VOICE_LOG_STATUSES)[number];

/**
 * A voice command for quality review: the transcript and what we proposed.
 * The audio is deleted after 24 h; the row (transcript) after 30 days.
 */
@Entity('voice_logs')
@Index(['createdAt'])
@Index('IDX_voice_logs_audio_pending', ['createdAt'], {
  where: '"audio_url" IS NOT NULL AND "audio_deleted_at" IS NULL',
})
@Index(['businessId', 'createdAt'])
export class VoiceLog extends BaseEntity {
  @Column({ type: 'uuid', name: 'business_id', nullable: true })
  businessId!: string | null;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 20 })
  context!: string;

  @Column({ type: 'varchar', length: 4, name: 'language_hint' })
  languageHint!: string;

  /** Null for a typed command. */
  @Column({ type: 'varchar', length: 500, name: 'audio_url', nullable: true })
  audioUrl!: string | null;

  @Column({ type: 'int', name: 'audio_seconds', default: 0 })
  audioSeconds!: number;

  @Column({ type: 'text', nullable: true })
  transcript!: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  language!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  intent!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  slots!: Record<string, unknown> | null;

  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: true })
  confidence!: string | null;

  /** ai: the model read the intent; rules: the deterministic parser did. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  source!: string | null;

  @Column({
    type: 'enum',
    enum: VOICE_LOG_STATUSES,
    enumName: 'voice_log_status',
  })
  status!: VoiceLogStatus;

  @Column({ type: 'timestamptz', name: 'audio_deleted_at', nullable: true })
  audioDeletedAt!: Date | null;
}
