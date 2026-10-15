import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * One in-app notification. The same row drives the bell list, the unread
 * badge and the push that went with it (`data` carries the deep-link target).
 */
@Entity('notifications')
@Index(['userId', 'createdAt'])
// The unread badge is read on every app open: keep it an index-only count.
@Index('IDX_notifications_unread', ['userId'], { where: '"read_at" IS NULL' })
export class Notification extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** Dotted, e.g. `shop.order_placed`, `shop.payment_confirmed`. */
  @Column({ type: 'varchar', length: 64 })
  type!: string;

  @Column({ type: 'varchar', length: 140 })
  title!: string;

  @Column({ type: 'varchar', length: 500 })
  body!: string;

  /** Always written by NotificationsService (no DB default: TypeORM and
   * Postgres render a jsonb default differently, which reads as drift). */
  @Column({ type: 'jsonb' })
  data!: Record<string, any>;

  @Column({ type: 'timestamptz', name: 'read_at', nullable: true })
  readAt!: Date | null;
}
