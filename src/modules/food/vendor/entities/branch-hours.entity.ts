import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Branch } from './branch.entity';

/**
 * Weekly opening hours. Several ranges a day are fine (lunch + dinner).
 * `closes_at <= opens_at` means the range runs past midnight (18:00–02:00)
 * and belongs to the weekday it opens on.
 */
@Entity('branch_hours')
@Index(['branchId', 'weekday'])
@Check(
  'CHK_branch_hours_weekday',
  '"weekday" BETWEEN 0 AND 6 AND "opens_at" <> "closes_at"',
)
export class BranchHours extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  /** 0 = Sunday … 6 = Saturday. */
  @Column({ type: 'smallint' })
  weekday!: number;

  @Column({ type: 'time', name: 'opens_at' })
  opensAt!: string;

  @Column({ type: 'time', name: 'closes_at' })
  closesAt!: string;
}
