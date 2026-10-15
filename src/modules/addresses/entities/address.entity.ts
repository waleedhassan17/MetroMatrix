import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { User } from '../../users/entities/user.entity';

export const ADDRESS_LABELS = ['home', 'work', 'other'] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

/** numeric → number (pg returns numerics as strings to keep precision). */
const coordinate = {
  to: (v?: number | null) => v,
  from: (v: string | null) => (v === null ? null : parseFloat(v)),
};

/**
 * A customer's saved delivery address — shared by Shopping, Food and
 * Healthcare. Orders never point here: they copy it into a snapshot, so
 * editing or deleting an address never changes a past order.
 */
@Entity('addresses')
// One default per user, enforced by the database (a race cannot make two).
@Index('UQ_addresses_one_default_per_user', ['userId'], {
  unique: true,
  where: '"is_default"',
})
@Index(['userId', 'createdAt'])
export class Address extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({
    type: 'enum',
    enum: ADDRESS_LABELS,
    enumName: 'address_label',
    default: 'home',
  })
  label!: AddressLabel;

  @Column({ type: 'varchar', length: 80, name: 'full_name' })
  fullName!: string;

  /** Canonical +923XXXXXXXXX. */
  @Column({ type: 'varchar', length: 16 })
  phone!: string;

  @Column({ type: 'varchar', length: 60 })
  city!: string;

  @Column({ type: 'varchar', length: 100 })
  area!: string;

  @Column({ type: 'varchar', length: 255 })
  line1!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  landmark!: string | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: coordinate,
  })
  lat!: number | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: coordinate,
  })
  lng!: number | null;

  @Column({ type: 'boolean', name: 'is_default', default: false })
  isDefault!: boolean;
}
