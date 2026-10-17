import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Branch } from './branch.entity';

const decimal = {
  to: (v: number) => v,
  from: (v: string) => parseFloat(v),
};

/** The vendor's own delivery fee and minimum order by distance band [from_km, to_km). */
@Entity('delivery_fee_bands')
@Index(['branchId', 'fromKm'])
@Check(
  'CHK_delivery_fee_bands',
  '"to_km" > "from_km" AND "from_km" >= 0 AND "fee" >= 0 AND "min_order" >= 0',
)
export class DeliveryFeeBand extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'from_km',
    transformer: decimal,
  })
  fromKm!: number;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'to_km',
    transformer: decimal,
  })
  toKm!: number;

  @Column({ type: 'int' })
  fee!: number;

  @Column({ type: 'int', name: 'min_order', default: 0 })
  minOrder!: number;
}
