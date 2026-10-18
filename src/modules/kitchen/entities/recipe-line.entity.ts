import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { MenuOption } from '../../food/menu/entities/menu-option.entity';
import { numeric } from '../common/numeric';
import { KitchenIngredient } from './kitchen-ingredient.entity';
import { RecipeCard } from './recipe-card.entity';

/**
 * One ingredient of a recipe card. With `option_id` it is used only when
 * that add-on is chosen. `qty_base` is `qty` × `unit` in the ingredient's
 * base unit, for the whole card (divide by yield for one serving).
 */
@Entity('recipe_lines')
@Index(['recipeCardId', 'sort'])
@Index(['ingredientId'])
@Check('CHK_recipe_lines_qty', '"qty" > 0 AND "qty_base" > 0')
export class RecipeLine extends BaseEntity {
  @Column({ type: 'uuid', name: 'recipe_card_id' })
  recipeCardId!: string;

  @ManyToOne(() => RecipeCard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipe_card_id' })
  card?: RecipeCard;

  @Column({ type: 'uuid', name: 'ingredient_id' })
  ingredientId!: string;

  @ManyToOne(() => KitchenIngredient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingredient_id' })
  ingredient?: KitchenIngredient;

  @Column({ ...numeric(12, 3) })
  qty!: number;

  @Column({ type: 'varchar', length: 20 })
  unit!: string;

  @Column({ ...numeric(14, 3), name: 'qty_base' })
  qtyBase!: number;

  @Column({ type: 'uuid', name: 'option_id', nullable: true })
  optionId!: string | null;

  @ManyToOne(() => MenuOption, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'option_id' })
  option?: MenuOption;

  /** Boxes, bags, foil: costed and deducted, but never what makes a dish sold out. */
  @Column({ type: 'boolean', name: 'is_packaging', default: false })
  isPackaging!: boolean;

  @Column({ type: 'smallint', default: 0 })
  sort!: number;
}
