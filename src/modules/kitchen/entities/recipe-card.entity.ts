import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { MenuItem } from '../../food/menu/entities/menu-item.entity';
import { ItemVariant } from '../../food/menu/entities/item-variant.entity';

/**
 * What one dish (or one size of it) uses. `yield_servings`: the lines make
 * this many servings. A variant without its own card uses the item's.
 */
@Entity('recipe_cards')
@Index('UQ_recipe_cards_item', ['menuItemId'], {
  unique: true,
  where: '"variant_id" IS NULL',
})
@Index('UQ_recipe_cards_variant', ['menuItemId', 'variantId'], {
  unique: true,
  where: '"variant_id" IS NOT NULL',
})
@Check('CHK_recipe_cards_yield', '"yield_servings" BETWEEN 1 AND 500')
export class RecipeCard extends BaseEntity {
  @Column({ type: 'uuid', name: 'menu_item_id' })
  menuItemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'menu_item_id' })
  item?: MenuItem;

  @Column({ type: 'uuid', name: 'variant_id', nullable: true })
  variantId!: string | null;

  @ManyToOne(() => ItemVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'variant_id' })
  variant?: ItemVariant;

  @Column({ type: 'smallint', name: 'yield_servings', default: 1 })
  yieldServings!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** The vendor's own creation (badge on the dish, P7); staff can remove a false claim. */
  @Column({ type: 'boolean', name: 'is_signature', default: false })
  isSignature!: boolean;

  @Column({
    type: 'varchar',
    length: 120,
    name: 'signature_by',
    nullable: true,
  })
  signatureBy!: string | null;

  @Column({ type: 'date', name: 'signature_since', nullable: true })
  signatureSince!: string | null;
}
