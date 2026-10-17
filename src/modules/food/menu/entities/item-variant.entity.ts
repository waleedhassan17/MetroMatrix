import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { MenuItem } from './menu-item.entity';

/** A size or portion with its own absolute price (Half / Full; Regular / Large). */
@Entity('item_variants')
@Index(['itemId', 'sort'])
@Check('CHK_item_variants_price', '"price" >= 0')
export class ItemVariant extends BaseEntity {
  @Column({ type: 'uuid', name: 'item_id' })
  itemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: MenuItem;

  @Column({ type: 'varchar', length: 60 })
  name!: string;

  @Column({ type: 'int' })
  price!: number;

  @Column({ type: 'int', default: 0 })
  sort!: number;
}
