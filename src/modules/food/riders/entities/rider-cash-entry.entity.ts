import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Rider } from './rider.entity';
import { FoodOrder } from '../../orders/entities/food-order.entity';
import { User } from '../../../users/entities/user.entity';

export const CASH_KINDS = ['cod_collected', 'handover', 'adjustment'] as const;
export type CashKind = (typeof CASH_KINDS)[number];

/**
 * Cash a rider holds for their vendor: + COD taken at the door, − handed
 * over to the vendor. The balance is SUM(amount). This is the vendor's own
 * money — MetroMatrix only keeps the record.
 */
@Entity('rider_cash_ledger')
@Index(['riderId', 'at'])
@Index('UQ_rider_cash_ledger_cod', ['orderId'], {
  unique: true,
  where: `"kind" = 'cod_collected'`,
})
@Check(
  'CHK_rider_cash_ledger_sign',
  `("kind" = 'cod_collected' AND "amount" > 0) OR ("kind" = 'handover' AND "amount" < 0) OR ("kind" = 'adjustment' AND "amount" <> 0)`,
)
export class RiderCashEntry extends BaseEntity {
  @Column({ type: 'uuid', name: 'rider_id' })
  riderId!: string;

  @ManyToOne(() => Rider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rider_id' })
  rider?: Rider;

  @Column({ type: 'uuid', name: 'order_id', nullable: true })
  orderId!: string | null;

  @ManyToOne(() => FoodOrder, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'order_id' })
  order?: FoodOrder;

  @Column({ type: 'enum', enum: CASH_KINDS, enumName: 'rider_cash_kind' })
  kind!: CashKind;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', name: 'recorded_by', nullable: true })
  recordedBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recorded_by' })
  recorder?: User;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  at!: Date;
}
