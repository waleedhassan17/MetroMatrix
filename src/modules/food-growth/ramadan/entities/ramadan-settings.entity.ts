import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Branch } from '../../../food/vendor/entities/branch.entity';

/**
 * A kitchen's Ramadan hours. On dates inside a `ramadan` calendar event
 * (everywhere, or the branch's city) the sehri and iftar windows replace the
 * weekly hours; on every other date nothing changes. `iftar_preorder_only`:
 * orders for the iftar window are taken before it opens.
 */
@Entity('ramadan_settings')
@Index('UQ_ramadan_settings_branch', ['branchId'], { unique: true })
@Check(
  'CHK_ramadan_settings_windows',
  '("sehri_from" IS NULL) = ("sehri_to" IS NULL) AND ("iftar_from" IS NULL) = ("iftar_to" IS NULL)',
)
export class RamadanSettings extends BaseEntity {
  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'time', name: 'sehri_from', nullable: true })
  sehriFrom!: string | null;

  @Column({ type: 'time', name: 'sehri_to', nullable: true })
  sehriTo!: string | null;

  @Column({ type: 'time', name: 'iftar_from', nullable: true })
  iftarFrom!: string | null;

  @Column({ type: 'time', name: 'iftar_to', nullable: true })
  iftarTo!: string | null;

  @Column({ type: 'boolean', name: 'iftar_preorder_only', default: false })
  iftarPreorderOnly!: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes!: string | null;
}
