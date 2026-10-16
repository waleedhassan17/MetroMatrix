import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';
import { User } from '../../../users/entities/user.entity';
import { FamilyMember } from '../../family/entities/family-member.entity';
import {
  MEDICINE_FORMS,
  MedicineForm,
} from '../../reference/entities/medicine.entity';

export const MEDICINE_TIMINGS = [
  'before_meal',
  'after_meal',
  'with_meal',
  'bedtime',
  'as_needed',
] as const;
export type MedicineTiming = (typeof MEDICINE_TIMINGS)[number];

/**
 * One per appointment. The doctor may replace it until 24 h after the visit
 * is completed; then it is immutable (PRESCRIPTION_LOCKED). Readable only by
 * its patient and its prescribing doctor.
 */
@Entity('prescriptions')
@Index(['appointmentId'], { unique: true })
@Index(['patientUserId', 'issuedAt'])
@Index(['doctorId', 'issuedAt'])
export class Prescription extends BaseEntity {
  @Column({ type: 'uuid', name: 'appointment_id' })
  appointmentId!: string;

  @ManyToOne(() => Appointment)
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment;

  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor)
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'uuid', name: 'patient_user_id' })
  patientUserId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'patient_user_id' })
  patient?: User;

  /** Set null with the appointment's when the family member is removed. */
  @Column({ type: 'uuid', name: 'family_member_id', nullable: true })
  familyMemberId!: string | null;

  @ManyToOne(() => FamilyMember, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'family_member_id' })
  familyMember?: FamilyMember | null;

  @Column({ type: 'text' })
  diagnosis!: string;

  @Column({ type: 'text', nullable: true })
  advice!: string | null;

  @Column({ type: 'smallint', name: 'follow_up_in_days', nullable: true })
  followUpInDays!: number | null;

  @Column({ type: 'timestamptz', name: 'issued_at' })
  issuedAt!: Date;
}

@Entity('prescription_medicines')
@Index(['prescriptionId', 'sort'])
export class PrescriptionMedicine extends BaseEntity {
  @Column({ type: 'uuid', name: 'prescription_id' })
  prescriptionId!: string;

  @ManyToOne(() => Prescription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'prescription_id' })
  prescription?: Prescription;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  strength!: string | null;

  @Column({ type: 'enum', enum: MEDICINE_FORMS, enumName: 'medicine_form' })
  form!: MedicineForm;

  /** e.g. 1+0+1 (morning + afternoon + night). */
  @Column({ type: 'varchar', length: 20, name: 'dose_pattern' })
  dosePattern!: string;

  @Column({ type: 'enum', enum: MEDICINE_TIMINGS, enumName: 'medicine_timing' })
  timing!: MedicineTiming;

  @Column({ type: 'smallint', name: 'duration_days', nullable: true })
  durationDays!: number | null;

  @Column({ type: 'text', nullable: true })
  instructions!: string | null;

  @Column({ type: 'smallint', default: 0 })
  sort!: number;
}

@Entity('prescription_tests')
@Index(['prescriptionId'])
export class PrescriptionTest extends BaseEntity {
  @Column({ type: 'uuid', name: 'prescription_id' })
  prescriptionId!: string;

  @ManyToOne(() => Prescription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'prescription_id' })
  prescription?: Prescription;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  instructions!: string | null;

  @Column({ type: 'smallint', default: 0 })
  sort!: number;
}

/** A doctor's own medicine shortcuts, most used first, for fast prescribing. */
@Entity('doctor_medicine_favourites')
@Index('UQ_doctor_medicine_favourites', { synchronize: false })
@Index(['doctorId', 'useCount'])
export class DoctorMedicineFavourite extends BaseEntity {
  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  strength!: string | null;

  @Column({ type: 'enum', enum: MEDICINE_FORMS, enumName: 'medicine_form' })
  form!: MedicineForm;

  @Column({ type: 'varchar', length: 20, name: 'dose_pattern' })
  dosePattern!: string;

  @Column({ type: 'enum', enum: MEDICINE_TIMINGS, enumName: 'medicine_timing' })
  timing!: MedicineTiming;

  @Column({ type: 'int', name: 'use_count', default: 0 })
  useCount!: number;
}
