import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';
import { FamilyMember } from '../../family/entities/family-member.entity';

export const RECORD_KINDS = [
  'lab_report',
  'imaging',
  'prescription',
  'discharge_summary',
  'vaccination',
  'other',
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/**
 * A patient's own medical document (lab report, scan, old prescription),
 * about them or one of their family members. The file is a private
 * (authenticated) Cloudinary asset. A doctor sees a record only while it is
 * attached to one of that doctor's appointments.
 */
@Entity('health_records')
@Index(['userId', 'createdAt'])
@Index(['familyMemberId'])
export class HealthRecord extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** Null = the account holder. Removing the family member removes their records. */
  @Column({ type: 'uuid', name: 'family_member_id', nullable: true })
  familyMemberId!: string | null;

  @ManyToOne(() => FamilyMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'family_member_id' })
  familyMember?: FamilyMember | null;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'enum', enum: RECORD_KINDS, enumName: 'health_record_kind' })
  kind!: RecordKind;

  /** When the test was done or the document issued (not the upload time). */
  @Column({ type: 'date', name: 'record_date', nullable: true })
  recordDate!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'file_url' })
  fileUrl!: string;

  @Column({ type: 'varchar', length: 255, name: 'file_public_id' })
  filePublicId!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  mime!: string | null;
}
