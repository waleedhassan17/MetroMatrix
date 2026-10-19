import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { NutritionFood } from '../../nutrition/entities/nutrition-food.entity';
import { BaseEntity } from '../../../common/base/base.entity';
import { Branch } from '../../food/vendor/entities/branch.entity';
import { numeric } from '../common/numeric';
import type { BaseUnit, CustomUnit } from '../stock/units';
import { ReferenceItem } from './reference-price.entity';

export const INGREDIENT_CATEGORIES = [
  'meat',
  'vegetable',
  'dairy',
  'spice',
  'grain',
  'oil',
  'bakery',
  'beverage',
  'packaging',
  'other',
] as const;
export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

/**
 * Something the kitchen buys and uses, counted in a base unit. `on_hand` is
 * the running balance (sum of movements, may be negative — stock never
 * blocks an order); `avg_cost` the weighted average rupees per base unit.
 * Changed only by KitchenStockService.
 */
@Entity('kitchen_ingredients')
@Index(['branchId', 'name'], { unique: true })
@Check(
  'CHK_kitchen_ingredients_numbers',
  '"avg_cost" >= 0 AND ("par_level" IS NULL OR "par_level" >= 0)',
)
export class KitchenIngredient extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  /** Unique per kitchen, regardless of case. */
  @Column({ type: 'citext' })
  name!: string;

  @Column({ type: 'varchar', length: 80, name: 'name_ur', nullable: true })
  nameUr!: string | null;

  @Column({
    type: 'enum',
    enum: INGREDIENT_CATEGORIES,
    enumName: 'ingredient_category',
    default: 'other',
  })
  category!: IngredientCategory;

  @Column({
    type: 'enum',
    enum: ['g', 'ml', 'piece'],
    enumName: 'ingredient_base_unit',
    name: 'base_unit',
  })
  baseUnit!: BaseUnit;

  /** [{ name: "tray", factor: 30 }] — factor in base units. */
  @Column({ type: 'jsonb', name: 'custom_units', default: () => "'[]'" })
  customUnits!: CustomUnit[];

  /** Reorder point in base units: below it shows on "below par" and the shopping list tops up to it. */
  @Column({ ...numeric(14, 3), name: 'par_level', nullable: true })
  parLevel!: number | null;

  @Column({ ...numeric(14, 3), name: 'on_hand', default: 0 })
  onHand!: number;

  /** Weighted average rupees per base unit. */
  @Column({ ...numeric(12, 4), name: 'avg_cost', default: 0 })
  avgCost!: number;

  @Column({ ...numeric(12, 4), name: 'last_cost', nullable: true })
  lastCost!: number | null;

  /** The PBS SPI item its cost is compared with (price watch). */
  @Column({ type: 'uuid', name: 'reference_item_id', nullable: true })
  referenceItemId!: string | null;

  @ManyToOne(() => ReferenceItem, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reference_item_id' })
  referenceItem?: ReferenceItem;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  /** Set when on_hand went below zero and the "log your purchase" alert was sent; cleared when back ≥ 0. */
  @Column({ type: 'timestamptz', name: 'negative_alerted_at', nullable: true })
  negativeAlertedAt!: Date | null;

  /** The reference food for nutrition (Chunk 5, P10): suggested, then confirmed by the vendor. */
  @Column({ type: 'uuid', name: 'nutrition_food_id', nullable: true })
  nutritionFoodId!: string | null;

  @ManyToOne(() => NutritionFood, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'nutrition_food_id' })
  nutritionFood?: NutritionFood;

  @Column({ type: 'boolean', name: 'nutrition_confirmed', default: false })
  nutritionConfirmed!: boolean;

  /** Grams per piece for an ingredient counted in pieces (overrides the food's typical weight). */
  @Column({ ...numeric(7, 1), name: 'nutrition_piece_grams', nullable: true })
  nutritionPieceGrams!: number | null;
}
