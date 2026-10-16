import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';
import { GENDERS, Gender } from '../../doctors/entities/doctor.entity';

export const RELATIONS = [
  'spouse',
  'child',
  'parent',
  'sibling',
  'other',
] as const;
export type Relation = (typeof RELATIONS)[number];

/** Someone a patient books for. Appointments keep a snapshot, so edits never rewrite history. */
@Entity('family_members')
@Index(['userId', 'createdAt'])
export class FamilyMember extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 120, name: 'full_name' })
  fullName!: string;

  @Column({ type: 'enum', enum: RELATIONS, enumName: 'family_relation' })
  relation!: Relation;

  @Column({
    type: 'enum',
    enum: GENDERS,
    enumName: 'person_gender',
    nullable: true,
  })
  gender!: Gender | null;

  @Column({ type: 'date', name: 'date_of_birth', nullable: true })
  dateOfBirth!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  phone!: string | null;
}
