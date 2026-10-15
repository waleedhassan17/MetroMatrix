import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { StoreOrder } from './store-order.entity';
import { ACTOR_ROLES, ActorRole } from '../order-status';

export const ORDER_EVENT_KINDS = ['status', 'payment', 'note'] as const;
export type OrderEventKind = (typeof ORDER_EVENT_KINDS)[number];

/**
 * The append-only timeline of a store order. Written in the same transaction
 * as the change it records. `at` is clock_timestamp(), so several events in
 * one transaction still sort in the order they happened.
 */
@Entity('store_order_events')
@Index(['storeOrderId', 'at'])
export class StoreOrderEvent extends BaseEntity {
  @Column({ type: 'uuid', name: 'store_order_id' })
  storeOrderId!: string;

  @ManyToOne(() => StoreOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_order_id' })
  storeOrder?: StoreOrder;

  @Column({
    type: 'enum',
    enum: ORDER_EVENT_KINDS,
    enumName: 'store_order_event_kind',
  })
  kind!: OrderEventKind;

  @Column({ type: 'varchar', length: 30, name: 'from_state', nullable: true })
  from!: string | null;

  @Column({ type: 'varchar', length: 30, name: 'to_state', nullable: true })
  to!: string | null;

  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId!: string | null;

  @Column({
    type: 'enum',
    enum: ACTOR_ROLES,
    enumName: 'store_order_actor',
    name: 'actor_role',
  })
  actorRole!: ActorRole;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  at!: Date;
}
