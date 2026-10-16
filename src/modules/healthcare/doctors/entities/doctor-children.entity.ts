import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Doctor } from './doctor.entity';
import { Specialty } from '../../reference/entities/specialty.entity';
import { Condition } from '../../reference/entities/condition.entity';

/**
 * A doctor's profile tables. The doctor's PATCH /profile replaces each list
 * whole (send the full desired list), so there is no per-row editing API.
 */

@Entity('doctor_specialties')
@Index(['doctorId', 'specialtyId'], { unique: true })
@Index(['specialtyId'])
export class DoctorSpecialty extends BaseEntity {
  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'uuid', name: 'specialty_id' })
  specialtyId!: string;

  @ManyToOne(() => Specialty, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'specialty_id' })
  specialty?: Specialty;
}

@Entity('doctor_qualifications')
@Index(['doctorId', 'sort'])
export class DoctorQualification extends BaseEntity {
  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'varchar', length: 80 })
  degree!: string;

  @Column({ type: 'varchar', length: 160 })
  institute!: string;

  @Column({ type: 'smallint', nullable: true })
  year!: number | null;

  @Column({ type: 'smallint', default: 0 })
  sort!: number;
}

@Entity('doctor_experiences')
@Index(['doctorId', 'sort'])
@Check(
  'CHK_doctor_experiences_years',
  '"to_year" IS NULL OR "to_year" >= "from_year"',
)
export class DoctorExperience extends BaseEntity {
  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'varchar', length: 120 })
  designation!: string;

  @Column({ type: 'varchar', length: 160 })
  institute!: string;

  @Column({ type: 'smallint', name: 'from_year' })
  fromYear!: number;

  /** null = current position. */
  @Column({ type: 'smallint', name: 'to_year', nullable: true })
  toYear!: number | null;

  @Column({ type: 'smallint', default: 0 })
  sort!: number;
}

/** A service the doctor offers ("Acne scar treatment"). */
@Entity('doctor_services')
@Index(['doctorId', 'sort'])
export class DoctorServiceItem extends BaseEntity {
  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'smallint', default: 0 })
  sort!: number;
}

@Entity('doctor_conditions')
@Index(['doctorId', 'conditionId'], { unique: true })
@Index(['conditionId'])
export class DoctorCondition extends BaseEntity {
  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'uuid', name: 'condition_id' })
  conditionId!: string;

  @ManyToOne(() => Condition, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'condition_id' })
  condition?: Condition;
}
