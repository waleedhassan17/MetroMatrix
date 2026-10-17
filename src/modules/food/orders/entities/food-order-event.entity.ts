import {
  Column,
  Entity,
  Generated,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { FoodOrder } from './food-order.entity';
import { FOOD_ACTORS, FoodActorRole } from '../food-order-status';

export const FOOD_EVENT_KINDS = ['status', 'payment', 'rider', 'note'] as const;
export type FoodEventKind = (typeof FOOD_EVENT_KINDS)[number];

/** Append-only history: every status, payment and rider step, and notes. */
@Entity('food_order_events')
@Index(['orderId', 'seq'])
export class FoodOrderEvent extends BaseEntity {
  /** Order of writing — several events share one transaction's now(). */
  @Column({ type: 'bigint', select: true, insert: false, update: false })
  @Generated('increment')
  seq!: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @ManyToOne(() => FoodOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: FoodOrder;

  @Column({
    type: 'enum',
    enum: FOOD_EVENT_KINDS,
    enumName: 'food_order_event_kind',
  })
  kind!: FoodEventKind;

  @Column({ type: 'varchar', length: 30, name: 'from_state', nullable: true })
  from!: string | null;

  @Column({ type: 'varchar', length: 30, name: 'to_state', nullable: true })
  to!: string | null;

  @Column({
    type: 'enum',
    enum: FOOD_ACTORS,
    enumName: 'food_order_actor',
    name: 'actor_role',
  })
  actorRole!: FoodActorRole;

  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data!: Record<string, unknown> | null;
}
