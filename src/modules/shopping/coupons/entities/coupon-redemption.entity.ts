import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Coupon } from './coupon.entity';
import { User } from '../../../users/entities/user.entity';

/**
 * One use of a coupon by one store order. Counting a customer's rows enforces
 * `per_user_limit`; cancelling the order deletes its row and gives the use
 * back (`used_count - 1`).
 */
@Entity('coupon_redemptions')
@Index(['couponId', 'userId'])
export class CouponRedemption extends BaseEntity {
  @Column({ type: 'uuid', name: 'coupon_id' })
  couponId!: string;

  @ManyToOne(() => Coupon, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coupon_id' })
  coupon?: Coupon;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** The store order that used it (FK added with store_orders in P4). */
  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'store_order_id' })
  storeOrderId!: string;

  @Column({ type: 'int' })
  discount!: number;
}
