import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { MenuItem } from '../../food/menu/entities/menu-item.entity';
import { numeric } from '../../kitchen/common/numeric';

export const NUTRITION_METHODS = ['recipe', 'ai_estimate'] as const;
export type NutritionMethod = (typeof NUTRITION_METHODS)[number];

/**
 * A dish's nutrition per serving. `recipe` when the recipe card has at least
 * 80% of its weight mapped to reference foods (confidence 0.9); otherwise an
 * `ai_estimate` from the name, description and portion, labelled low
 * confidence. The vendor can hide it from customers.
 */
@Entity('menu_item_nutrition')
@Index('UQ_menu_item_nutrition_item', ['menuItemId'], { unique: true })
@Check('CHK_menu_item_nutrition_confidence', '"confidence" BETWEEN 0 AND 1')
export class MenuItemNutrition extends BaseEntity {
  @Column({ type: 'uuid', name: 'menu_item_id' })
  menuItemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'menu_item_id' })
  item?: MenuItem;

  @Column({ ...numeric(7, 1) })
  kcal!: number;

  @Column({ ...numeric(6, 1), name: 'protein_g' })
  proteinG!: number;

  @Column({ ...numeric(6, 1), name: 'carbs_g' })
  carbsG!: number;

  @Column({ ...numeric(6, 1), name: 'fat_g' })
  fatG!: number;

  @Column({ ...numeric(6, 1), name: 'fibre_g' })
  fibreG!: number;

  @Column({ ...numeric(8, 1), name: 'sodium_mg' })
  sodiumMg!: number;

  @Column({ type: 'int', name: 'serving_grams', nullable: true })
  servingGrams!: number | null;

  @Column({
    type: 'enum',
    enum: NUTRITION_METHODS,
    enumName: 'nutrition_method',
  })
  method!: NutritionMethod;

  @Column({ ...numeric(3, 2) })
  confidence!: number;

  /** Mapped weight ÷ recipe weight (recipe method; also kept on an estimate for context). */
  @Column({ ...numeric(4, 3), name: 'mapped_share', nullable: true })
  mappedShare!: number | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  badges!: string[];

  @Column({ type: 'boolean', default: false })
  hidden!: boolean;

  @Column({ type: 'timestamptz', name: 'computed_at' })
  computedAt!: Date;
}
