import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { FoodBrand } from '../../vendor/entities/food-brand.entity';

/** A menu section. `available_from/to` (local time) limit it to part of the day (Breakfast 7–11). */
@Entity('menu_categories')
@Index(['brandId', 'sort'])
export class MenuCategory extends BaseEntity {
  @Column({ type: 'uuid', name: 'brand_id' })
  brandId!: string;

  @ManyToOne(() => FoodBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_id' })
  brand?: FoodBrand;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'int', default: 0 })
  sort!: number;

  @Column({ type: 'time', name: 'available_from', nullable: true })
  availableFrom!: string | null;

  @Column({ type: 'time', name: 'available_to', nullable: true })
  availableTo!: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
