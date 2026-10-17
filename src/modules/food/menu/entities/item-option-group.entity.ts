import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { MenuItem } from './menu-item.entity';
import { OptionGroup } from './option-group.entity';
import { ItemVariant } from './item-variant.entity';

/**
 * A group offered on an item — for every variant, or only one (`variant_id`).
 * Unique per (item, group, variant) with NULLS NOT DISTINCT — written by hand
 * in the migration (TypeORM can't express it).
 */
@Entity('item_option_groups')
@Index('UQ_item_option_groups', { synchronize: false })
@Index(['itemId'])
@Index(['groupId'])
export class ItemOptionGroup extends BaseEntity {
  @Column({ type: 'uuid', name: 'item_id' })
  itemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: MenuItem;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @ManyToOne(() => OptionGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group?: OptionGroup;

  @Column({ type: 'int', default: 0 })
  sort!: number;

  @Column({ type: 'uuid', name: 'variant_id', nullable: true })
  variantId!: string | null;

  @ManyToOne(() => ItemVariant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'variant_id' })
  variant?: ItemVariant;
}
