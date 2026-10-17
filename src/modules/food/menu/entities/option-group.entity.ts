import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { FoodBrand } from '../../vendor/entities/food-brand.entity';

/** A reusable choice ("Choose your drink", "Extra toppings"); required when min_select ≥ 1. */
@Entity('option_groups')
@Index(['brandId'])
@Check(
  'CHK_option_groups_select',
  '"min_select" >= 0 AND "max_select" >= 1 AND "min_select" <= "max_select"',
)
export class OptionGroup extends BaseEntity {
  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'smallint', name: 'min_select', default: 0 })
  minSelect!: number;

  @Column({ type: 'smallint', name: 'max_select', default: 1 })
  maxSelect!: number;
}
