import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';
import { FoodBrand } from '../../vendor/entities/food-brand.entity';
import { Branch } from '../../vendor/entities/branch.entity';
import { FULFILMENTS, Fulfilment } from '../../common/food-types';
import { FoodCartItem } from './food-cart-item.entity';

/** One cart per customer, from one vendor at a time (CART_OTHER_VENDOR). */
@Entity('food_carts')
@Index(['userId'], { unique: true })
export class FoodCart extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({
    type: 'enum',
    enum: FULFILMENTS,
    enumName: 'food_cart_fulfilment',
    default: 'delivery',
  })
  fulfilment!: Fulfilment;

  /** null = as soon as possible. */
  @Column({ type: 'timestamptz', name: 'scheduled_for', nullable: true })
  scheduledFor!: Date | null;

  @OneToMany(() => FoodCartItem, (i) => i.cart)
  items?: FoodCartItem[];
}
