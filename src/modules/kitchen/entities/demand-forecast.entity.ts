import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { Branch } from '../../food/vendor/entities/branch.entity';
import { MenuItem } from '../../food/menu/entities/menu-item.entity';
import { numeric } from '../common/numeric';

export const FORECAST_METHODS = [
  'learning',
  'weekday_avg',
  'weighted',
] as const;

/** Expected portions of a dish on a day (kitchen/forecast/forecast.ts), rewritten nightly for the next 7 days. */
@Entity('demand_forecasts')
@Index(['branchId', 'menuItemId', 'forDate'], { unique: true })
@Index(['branchId', 'forDate'])
export class DemandForecast extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'uuid', name: 'menu_item_id' })
  menuItemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'menu_item_id' })
  item?: MenuItem;

  @Column({ type: 'date', name: 'for_date' })
  forDate!: string;

  @Column({ ...numeric(8, 1) })
  expected!: number;

  @Column({ ...numeric(8, 1) })
  low!: number;

  @Column({ ...numeric(8, 1) })
  high!: number;

  @Column({ type: 'enum', enum: FORECAST_METHODS, enumName: 'forecast_method' })
  method!: (typeof FORECAST_METHODS)[number];

  /** The vendor's own number for that day (prep sheet uses it instead); kept when the forecast is rewritten. */
  @Column({ type: 'int', nullable: true })
  adjusted!: number | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  basis!: Record<string, number>;

  @Column({ type: 'timestamptz', name: 'generated_at' })
  generatedAt!: Date;
}

/** How far yesterday's forecasts were from what sold (MAPE, %). */
@Entity('forecast_accuracy')
@Index(['branchId', 'forDate'], { unique: true })
export class ForecastAccuracy extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'date', name: 'for_date' })
  forDate!: string;

  @Column({ ...numeric(6, 1), nullable: true })
  mape!: number | null;

  @Column({ type: 'int', name: 'items_count' })
  itemsCount!: number;
}
