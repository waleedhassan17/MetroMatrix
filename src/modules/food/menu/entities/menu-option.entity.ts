import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { OptionGroup } from './option-group.entity';

/** One choice in a group, with what it adds to the price (may be 0). */
@Entity('options')
@Index(['groupId'])
@Check('CHK_options_price', '"price_delta" >= 0')
export class MenuOption extends BaseEntity {
  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @ManyToOne(() => OptionGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group?: OptionGroup;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'int', name: 'price_delta', default: 0 })
  priceDelta!: number;

  @Column({ type: 'boolean', name: 'is_default', default: false })
  isDefault!: boolean;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sort!: number;
}
