import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';
import { Branch } from '../../food/vendor/entities/branch.entity';

/** Where the kitchen buys (the sabzi mandi stall, the meat shop). */
@Entity('suppliers')
@Index(['branchId', 'name'], { unique: true })
export class Supplier extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'citext' })
  name!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes!: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
