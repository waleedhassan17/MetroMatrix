import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { Branch } from '../../food/vendor/entities/branch.entity';
import { MenuItem } from '../../food/menu/entities/menu-item.entity';
import { User } from '../../users/entities/user.entity';
import { numeric } from '../common/numeric';
import { KitchenIngredient } from './kitchen-ingredient.entity';

export const WASTE_REASONS = [
  'expired',
  'spoiled',
  'overcooked',
  'returned',
  'leftover',
  'other',
] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

/**
 * Something thrown away: an ingredient (taken out of stock, FIFO) or cooked
 * portions of a dish (its recipe taken out). `cost` is what it was worth at
 * the batches' cost; null for a dish without a recipe card. `created_at` is
 * the spec's `at`.
 */
@Entity('waste_entries')
@Index(['branchId', 'createdAt'])
@Check(
  'CHK_waste_entries_target',
  '("ingredient_id" IS NULL) <> ("menu_item_id" IS NULL)',
)
@Check('CHK_waste_entries_qty', '"qty" > 0')
export class WasteEntry extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'uuid', name: 'ingredient_id', nullable: true })
  ingredientId!: string | null;

  @ManyToOne(() => KitchenIngredient, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'ingredient_id' })
  ingredient?: KitchenIngredient;

  @Column({ type: 'uuid', name: 'menu_item_id', nullable: true })
  menuItemId!: string | null;

  @ManyToOne(() => MenuItem, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'menu_item_id' })
  item?: MenuItem;

  @Column({ ...numeric(12, 3) })
  qty!: number;

  /** As entered: kg, g, piece… or "serving" for a dish. */
  @Column({ type: 'varchar', length: 20 })
  unit!: string;

  @Column({ type: 'enum', enum: WASTE_REASONS, enumName: 'waste_reason' })
  reason!: WasteReason;

  /** Rupees. */
  @Column({ type: 'int', nullable: true })
  cost!: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', name: 'logged_by', nullable: true })
  loggedBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'logged_by' })
  logger?: User;
}
