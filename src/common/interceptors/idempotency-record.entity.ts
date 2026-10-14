import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Stores the outcome of an idempotent POST so a retried request (same
 * Idempotency-Key header, same caller) returns the original response instead
 * of running twice. Critical on mobile networks.
 *
 * `scope` is `user:<id>`. FinMatrix keyed this on a company uuid and fell back
 * to the string 'no-company', which a uuid column cannot hold.
 */
@Entity('idempotency_records')
@Index(['scope', 'idempotencyKey'], { unique: true })
@Index(['createdAt'])
export class IdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  scope!: string;

  @Column({ type: 'varchar', length: 200, name: 'idempotency_key' })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 8 })
  method!: string;

  @Column({ type: 'varchar', length: 300 })
  path!: string;

  // 'pending' while in flight, 'completed' once the response is captured.
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: string;

  @Column({ type: 'int', nullable: true, name: 'status_code' })
  statusCode!: number | null;

  @Column({ type: 'jsonb', nullable: true, name: 'response_body' })
  responseBody!: unknown;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
