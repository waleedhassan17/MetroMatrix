import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';
import { FamilyMember } from '../../family/entities/family-member.entity';

export const RECORD_TYPES = [
  'lab_report',
  'prescription',
  'scan',
  'discharge_summary',
  'other',
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export interface RecordFile {
  url: string;
  publicId: string;
  mime: string | null;
}

/**
 * A patient's own medical document (lab report, scan, old prescription),
 * about them or one of their family members. The file is a private
 * (authenticated) Cloudinary asset per file. A doctor sees a record only while it is
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

  @Column({ type: 'enum', enum: RECORD_TYPES, enumName: 'health_record_type' })
  type!: RecordType;

  /** When the test was done or the document issued (not the upload time). */
  @Column({ type: 'date', name: 'record_date', nullable: true })
  recordDate!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** 1–10 pages/photos/PDFs, each a private (authenticated) upload. */
  @Column({ type: 'jsonb' })
  files!: RecordFile[];
}
