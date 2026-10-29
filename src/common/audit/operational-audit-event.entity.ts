import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only operational audit trail (a trigger refuses UPDATE, DELETE and
 * TRUNCATE — migration AuditTrail): sign-ins, sign-ups, password resets,
 * refresh-token reuse, business submissions and every admin write. Who did
 * what to which record, from where.
 */
@Entity('operational_audit_events')
@Index(['targetType', 'targetId', 'createdAt'])
@Index(['actorUserId', 'createdAt'])
@Index(['action', 'createdAt'])
// GET /admin/audit pages newest-first on (created_at, id).
@Index(['createdAt', 'id'])
export class OperationalAuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Null for system actions (cron, seed) and for failed anonymous attempts. */
  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId!: string | null;

  /** Dotted verb, e.g. `auth.signin`, `business.approve`. */
  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ type: 'varchar', length: 64, name: 'target_type' })
  targetType!: string;

  @Column({ type: 'varchar', length: 64, name: 'target_id', nullable: true })
  targetId!: string | null;

  // `any`, not `unknown`: TypeORM cannot type an `unknown` jsonb value on insert.
  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, any> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent!: string | null;

  /** The X-Request-Id of the request that wrote it: ties a row to its log lines. */
  @Column({ type: 'varchar', length: 128, name: 'request_id', nullable: true })
  requestId!: string | null;

  /** The changed fields as they were (admin writes); null when nothing existed. */
  @Column({ type: 'jsonb', nullable: true })
  before!: Record<string, any> | null;

  /** The same fields afterwards; null when the record was deleted. */
  @Column({ type: 'jsonb', nullable: true })
  after!: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
