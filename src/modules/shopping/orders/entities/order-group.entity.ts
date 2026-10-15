import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';
import { StoreOrder } from './store-order.entity';

/** The delivery address as it was at checkout. */
export interface AddressSnapshot {
  label: string;
  fullName: string;
  phone: string;
  city: string;
  area: string;
  line1: string;
  landmark: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * One checkout: the customer's view of "my order". It splits into one
 * store order per store; its totals are exactly the sums of theirs.
 */
@Entity('order_groups')
@Index(['code'], { unique: true })
@Index(['userId', 'placedAt'])
@Check(
  'CHK_order_groups_totals',
  '"grand_total" = "items_total" - "discount_total" + "shipping_total" AND "discount_total" <= "items_total" AND "shipping_total" >= 0',
)
export class OrderGroup extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** MM-XXXXXX */
  @Column({ type: 'varchar', length: 12 })
  code!: string;

  @Column({ type: 'jsonb', name: 'address_snapshot' })
  addressSnapshot!: AddressSnapshot;

  @Column({ type: 'int', name: 'items_total' })
  itemsTotal!: number;

  @Column({ type: 'int', name: 'discount_total' })
  discountTotal!: number;

  @Column({ type: 'int', name: 'shipping_total' })
  shippingTotal!: number;

  @Column({ type: 'int', name: 'grand_total' })
  grandTotal!: number;

  @Column({ type: 'timestamptz', name: 'placed_at' })
  placedAt!: Date;

  @OneToMany(() => StoreOrder, (o) => o.group)
  storeOrders?: StoreOrder[];
}
