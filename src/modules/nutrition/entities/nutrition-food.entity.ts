import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { numeric } from '../../kitchen/common/numeric';

export const NUTRITION_SOURCES = ['usda_sr_legacy', 'staff'] as const;

/**
 * Reference values per 100 g. Seeded from USDA FoodData Central SR Legacy
 * (public domain; scripts/build-nutrition-seed.mjs); staff can edit or add
 * rows (`source = staff`). `canonicals` link it to the kitchen's canonical
 * ingredient names (ingredient_aliases), which is how mappings are suggested.
 */
@Entity('nutrition_foods')
@Index('UQ_nutrition_foods_key', ['key'], { unique: true })
@Check(
  'CHK_nutrition_foods_values',
  '"kcal" >= 0 AND "kcal" <= 950 AND "protein_g" >= 0 AND "carbs_g" >= 0 AND "fat_g" >= 0 AND "fibre_g" >= 0 AND "sodium_mg" >= 0',
)
export class NutritionFood extends BaseEntity {
  @Column({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 120, name: 'name_ur', nullable: true })
  nameUr!: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  canonicals!: string[];

  @Column({ type: 'varchar', length: 80, name: 'food_group' })
  foodGroup!: string;

  @Column({
    type: 'enum',
    enum: NUTRITION_SOURCES,
    enumName: 'nutrition_source',
    default: 'usda_sr_legacy',
  })
  source!: (typeof NUTRITION_SOURCES)[number];

  @Column({ type: 'int', name: 'fdc_id', nullable: true })
  fdcId!: number | null;

  @Column({ type: 'text', name: 'usda_description', nullable: true })
  usdaDescription!: string | null;

  @Column({ ...numeric(6, 1) })
  kcal!: number;

  @Column({ ...numeric(6, 2), name: 'protein_g' })
  proteinG!: number;

  @Column({ ...numeric(6, 2), name: 'carbs_g' })
  carbsG!: number;

  @Column({ ...numeric(6, 2), name: 'fat_g' })
  fatG!: number;

  @Column({ ...numeric(6, 2), name: 'fibre_g' })
  fibreG!: number;

  @Column({ ...numeric(8, 1), name: 'sodium_mg' })
  sodiumMg!: number;

  /** A typical weight for ingredients counted in pieces (an egg 50 g, a naan 90 g). */
  @Column({ ...numeric(7, 1), name: 'piece_grams', nullable: true })
  pieceGrams!: number | null;

  /** Labels a USDA equivalent used for a local item ("queso fresco for paneer"). */
  @Column({ type: 'varchar', length: 300, nullable: true })
  note!: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
