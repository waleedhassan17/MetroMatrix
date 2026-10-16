import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';
import { User } from '../../../users/entities/user.entity';
import {
  LOCATION_KINDS,
  LocationKind,
} from '../../practice/entities/practice-location.entity';

/** Fixed praise tags so they can be counted ("No waiting time", "Great experience"…). */
export const REVIEW_TAGS = [
  'no_wait',
  'great_experience',
  'explained_well',
  'friendly',
  'on_time',
  'clean_clinic',
  'value_for_money',
] as const;
export type ReviewTag = (typeof REVIEW_TAGS)[number];

/**
 * A verified-visit review: one per completed appointment, within 30 days of
 * completion. `environment` is for clinic visits only. Aggregates on the
 * doctor row are recomputed when a review is written, hidden or unhidden,
 * and again nightly.
 */
@Entity('doctor_reviews')
@Index(['appointmentId'], { unique: true })
@Index(['doctorId', 'createdAt'])
@Index(['patientUserId'])
@Check(
  'CHK_doctor_reviews_scores',
  `"overall" BETWEEN 1 AND 5 AND "diagnosis" BETWEEN 1 AND 5 AND ("staff" IS NULL OR "staff" BETWEEN 1 AND 5) AND ("environment" IS NULL OR "environment" BETWEEN 1 AND 5)`,
)
export class DoctorReview extends BaseEntity {
  @Column({ type: 'uuid', name: 'appointment_id' })
  appointmentId!: string;

  @ManyToOne(() => Appointment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment;

  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'uuid', name: 'patient_user_id' })
  patientUserId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'patient_user_id' })
  patient?: User;

  @Column({
    type: 'enum',
    enum: LOCATION_KINDS,
    enumName: 'practice_location_kind',
  })
  kind!: LocationKind;

  @Column({ type: 'smallint' })
  overall!: number;

  @Column({ type: 'smallint' })
  diagnosis!: number;

  @Column({ type: 'smallint', nullable: true })
  staff!: number | null;

  @Column({ type: 'smallint', nullable: true })
  environment!: number | null;

  @Column({ type: 'boolean' })
  recommend!: boolean;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: ReviewTag[];

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ type: 'boolean', name: 'is_anonymous', default: false })
  isAnonymous!: boolean;

  /** "Ayesha K." (or initials "A. K." when anonymous), fixed at writing; never the full name. */
  @Column({ type: 'varchar', length: 80, name: 'author_name' })
  authorName!: string;

  @Column({ type: 'text', name: 'doctor_reply', nullable: true })
  doctorReply!: string | null;

  @Column({ type: 'timestamptz', name: 'replied_at', nullable: true })
  repliedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'hidden_at', nullable: true })
  hiddenAt!: Date | null;

  @Column({ type: 'text', name: 'hidden_reason', nullable: true })
  hiddenReason!: string | null;

  @Column({ type: 'uuid', name: 'hidden_by_user_id', nullable: true })
  hiddenByUserId!: string | null;
}
