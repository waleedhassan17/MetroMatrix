import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { StoreOrder } from '../../orders/entities/store-order.entity';
import { Store } from '../../stores/entities/store.entity';
import { User } from '../../../users/entities/user.entity';
import {
  RETURN_REASONS,
  RETURN_STATUSES,
  ReturnReason,
  ReturnStatus,
} from '../return-status';

/**
 * A customer's return of some lines of a delivered store order. The refund is
 * recorded here (money moves off-platform); the store order's own payment
 * status is untouched.
 */
@Entity('return_requests')
// One open request per store order (migration-defined partial unique index).
@Index('UQ_return_requests_one_open', { synchronize: false })
@Index(['storeId', 'status', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['storeOrderId'])
export class ReturnRequest extends BaseEntity {
  @Column({ type: 'uuid', name: 'store_order_id' })
  storeOrderId!: string;

  @ManyToOne(() => StoreOrder)
  @JoinColumn({ name: 'store_order_id' })
  storeOrder?: StoreOrder;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({
    type: 'enum',
    enum: RETURN_STATUSES,
    enumName: 'return_status',
    default: 'requested',
  })
  status!: ReturnStatus;

  @Column({ type: 'enum', enum: RETURN_REASONS, enumName: 'return_reason' })
  reason!: ReturnReason;

  @Column({ type: 'text', nullable: true })
  details!: string | null;

  @Column({ type: 'text', array: true })
  photos!: string[];

  @Column({ type: 'text', name: 'store_note', nullable: true })
  storeNote!: string | null;

  @Column({ type: 'int', name: 'refund_amount', nullable: true })
  refundAmount!: number | null;

  @Column({ type: 'varchar', length: 100, name: 'refund_ref', nullable: true })
  refundRef!: string | null;

  @Column({ type: 'timestamptz', name: 'decided_at', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'received_at', nullable: true })
  receivedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'refunded_at', nullable: true })
  refundedAt!: Date | null;
}
