import { Entity, Index, JoinColumn, ManyToOne, Column } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';

/**
 * One cart per customer, holding lines from any number of stores. The row
 * also serves as the per-customer lock: every cart write and checkout takes
 * `FOR UPDATE` on it first, so a line added mid-checkout is never cleared
 * unbought.
 */
@Entity('carts')
@Index(['userId'], { unique: true })
export class Cart extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
