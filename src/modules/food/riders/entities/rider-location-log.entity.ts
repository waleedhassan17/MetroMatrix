import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Rider } from './rider.entity';
import { FoodOrder } from '../../orders/entities/food-order.entity';

const decimal = {
  to: (v?: number | null) => v,
  from: (v: string | null) => (v === null ? null : parseFloat(v)),
};

/** Port of FinMatrix delivery_location_logs: where a rider was, purged after 14 days. */
@Entity('rider_location_logs')
@Index(['riderId', 'at'])
@Index(['orderId', 'at'])
export class RiderLocationLog extends BaseEntity {
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

  @Column({ type: 'numeric', precision: 9, scale: 6, transformer: decimal })
  lat!: number;

  @Column({ type: 'numeric', precision: 9, scale: 6, transformer: decimal })
  lng!: number;

  @Column({ type: 'smallint', nullable: true })
  heading!: number | null;

  /** m/s */
  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: decimal,
  })
  speed!: number | null;

  /** metres */
  @Column({
    type: 'numeric',
    precision: 7,
    scale: 1,
    nullable: true,
    transformer: decimal,
  })
  accuracy!: number | null;

  @Column({ type: 'timestamptz' })
  at!: Date;
}
