import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';

export const BROADCAST_STATUSES = [
  'queued',
  'sending',
  'sent',
  'failed',
] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

/**
 * A push sent to an audience from the console. Counts fill in as batches of
 * up to 100 go to Expo: `devices` targeted, `delivered` accepted by Expo,
 * `failed` refused (dead tokens are pruned).
 */
@Entity('admin_broadcasts')
@Index(['createdBy', 'createdAt'])
@Check(
  'CHK_admin_broadcasts_audience',
  `"audience" IN ('all', 'customers', 'partners', 'riders')`,
)
@Check(
  'CHK_admin_broadcasts_status',
  `"status" IN ('queued', 'sending', 'sent', 'failed')`,
)
export class AdminBroadcast extends BaseEntity {
  @Column({ type: 'uuid', name: 'created_by' })
  createdBy!: string;

  @Column({ type: 'varchar', length: 16 })
  audience!: string;

  /** Partners only: one service, or all of them when null. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  service!: string | null;

  @Column({ type: 'varchar', length: 65 })
  title!: string;

  @Column({ type: 'varchar', length: 240 })
  body!: string;

  @Column({ type: 'varchar', length: 500, name: 'deep_link', nullable: true })
  deepLink!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status!: BroadcastStatus;

  @Column({ type: 'int', default: 0 })
  recipients!: number;

  @Column({ type: 'int', default: 0 })
  devices!: number;

  @Column({ type: 'int', default: 0 })
  delivered!: number;

  @Column({ type: 'int', default: 0 })
  failed!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;
}
