import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Branch } from './branch.entity';

/** A one-off closure (Eid, a family event): closed whatever the weekly hours say. */
@Entity('branch_closures')
@Index(['branchId', 'endsAt'])
@Check('CHK_branch_closures_range', '"ends_at" > "starts_at"')
export class BranchClosure extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  @Column({ type: 'timestamptz', name: 'ends_at' })
  endsAt!: Date;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason!: string | null;
}
