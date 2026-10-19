import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { numeric } from '../common/numeric';

/**
 * A Pakistan Bureau of Statistics SPI item ("Tomatoes, kg"), loaded from the
 * weekly CSV staff transcribe from the PBS PDF. `base_unit` / `factor` let a
 * kitchen ingredient compare its cost: one SPI unit = factor base units.
 */
@Entity('reference_items')
@Index(['name'], { unique: true })
@Check('CHK_reference_items_factor', '"factor" > 0')
export class ReferenceItem extends BaseEntity {
  @Column({ type: 'citext' })
  name!: string;

  /** As PBS prints it: kg, litre, dozen, 250 grams… */
  @Column({ type: 'varchar', length: 30 })
  unit!: string;

  @Column({
    type: 'enum',
    enum: ['g', 'ml', 'piece'],
    enumName: 'ingredient_base_unit',
    name: 'base_unit',
  })
  baseUnit!: 'g' | 'ml' | 'piece';

  @Column({ ...numeric(12, 3) })
  factor!: number;

  /** The ingredient alias canonical ("tomato") — how kitchens' ingredients are matched. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  canonical!: string | null;
}

@Entity('reference_prices')
@Index(['itemId', 'city', 'weekEnding'], { unique: true })
@Index(['city', 'weekEnding'])
@Check('CHK_reference_prices_price', '"price" > 0')
export class ReferencePrice extends BaseEntity {
  @Column({ type: 'uuid', name: 'item_id' })
  itemId!: string;

  @ManyToOne(() => ReferenceItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: ReferenceItem;

  @Column({ type: 'citext' })
  city!: string;

  @Column({ type: 'date', name: 'week_ending' })
  weekEnding!: string;

  /** Rupees per the item's unit. */
  @Column({ ...numeric(10, 2) })
  price!: number;
}
