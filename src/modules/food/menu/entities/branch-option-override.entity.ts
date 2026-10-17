import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Branch } from '../../vendor/entities/branch.entity';
import { MenuOption } from './menu-option.entity';

/** An option a branch has run out of. */
@Entity('branch_option_overrides')
@Index(['branchId', 'optionId'], { unique: true })
export class BranchOptionOverride extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'uuid', name: 'option_id' })
  optionId!: string;

  @ManyToOne(() => MenuOption, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'option_id' })
  option?: MenuOption;

  @Column({ type: 'boolean', name: 'is_available', default: true })
  isAvailable!: boolean;
}
