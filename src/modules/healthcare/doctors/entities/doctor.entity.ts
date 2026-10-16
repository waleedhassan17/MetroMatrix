import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { Business } from '../../../businesses/entities/business.entity';
import { Specialty } from '../../reference/entities/specialty.entity';
import { User } from '../../../users/entities/user.entity';

export const DOCTOR_TITLES = ['dr', 'prof', 'assoc_prof', 'asst_prof'] as const;
export type DoctorTitle = (typeof DOCTOR_TITLES)[number];
export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

const decimal = {
  to: (v?: number | null) => v,
  from: (v: string | null) => (v === null ? null : parseFloat(v)),
};

/**
 * A doctor partner's public profile and booking rules. Created (unlisted,
 * unverified) when a doctor business is submitted, so MetroMatrix can verify
 * the PMDC number before approval. Shown to patients only when `is_listed`.
 *
 * Aggregates (rating, satisfaction, measured wait/consult minutes, …) are
 * computed by the nightly job; `next_available_at` by the availability
 * service. `search` is refreshed by doctor_search_refresh() (see migration).
 */
@Entity('doctors')
@Index(['businessId'], { unique: true })
@Index(['pmdcNumber'], { unique: true })
@Index(['isListed', 'primarySpecialtyId'])
@Index('IDX_doctors_search', { synchronize: false })
@Index('IDX_doctors_full_name_trgm', { synchronize: false })
@Check(
  'CHK_doctors_booking_rules',
  '"booking_window_days" BETWEEN 1 AND 30 AND "min_notice_minutes" >= 0 AND "cancel_cutoff_minutes" >= 0',
)
export class Doctor extends BaseEntity {
  @Column({ type: 'uuid', name: 'business_id' })
  businessId!: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business?: Business;

  @Column({
    type: 'enum',
    enum: DOCTOR_TITLES,
    enumName: 'doctor_title',
    default: 'dr',
  })
  title!: DoctorTitle;

  @Column({ type: 'varchar', length: 120, name: 'full_name' })
  fullName!: string;

  @Column({
    type: 'enum',
    enum: GENDERS,
    enumName: 'person_gender',
    nullable: true,
  })
  gender!: Gender | null;

  @Column({ type: 'varchar', length: 500, name: 'photo_url', nullable: true })
  photoUrl!: string | null;

  @Column({ type: 'citext', name: 'pmdc_number' })
  pmdcNumber!: string;

  @Column({ type: 'timestamptz', name: 'pmdc_verified_at', nullable: true })
  pmdcVerifiedAt!: Date | null;

  @Column({ type: 'uuid', name: 'pmdc_verified_by', nullable: true })
  pmdcVerifiedBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'pmdc_verified_by' })
  verifier?: User;

  @Column({ type: 'uuid', name: 'primary_specialty_id', nullable: true })
  primarySpecialtyId!: string | null;

  @ManyToOne(() => Specialty)
  @JoinColumn({ name: 'primary_specialty_id' })
  primarySpecialty?: Specialty;

  /** Year; years of experience are derived from it. */
  @Column({ type: 'smallint', name: 'practicing_since', nullable: true })
  practicingSince!: number | null;

  @Column({ type: 'text', nullable: true })
  about!: string | null;

  @Column({ type: 'text', array: true })
  languages!: string[];

  @Column({ type: 'smallint', name: 'booking_window_days', default: 14 })
  bookingWindowDays!: number;

  @Column({ type: 'int', name: 'min_notice_minutes', default: 60 })
  minNoticeMinutes!: number;

  @Column({ type: 'int', name: 'cancel_cutoff_minutes', default: 120 })
  cancelCutoffMinutes!: number;

  @Column({ type: 'boolean', name: 'video_prepay_required', default: false })
  videoPrepayRequired!: boolean;

  @Column({ type: 'boolean', name: 'is_listed', default: false })
  isListed!: boolean;

  @Column({ type: 'boolean', name: 'is_accepting', default: true })
  isAccepting!: boolean;

  /** Set when an admin takes the doctor off the directory. */
  @Column({ type: 'text', name: 'unlisted_reason', nullable: true })
  unlistedReason!: string | null;

  @Column({
    type: 'numeric',
    precision: 3,
    scale: 2,
    name: 'rating_avg',
    default: 0,
    transformer: decimal,
  })
  ratingAvg!: number;

  @Column({ type: 'int', name: 'rating_count', default: 0 })
  ratingCount!: number;

  /** Share of reviews that recommend the doctor, 0–100. */
  @Column({ type: 'smallint', name: 'satisfaction_pct', nullable: true })
  satisfactionPct!: number | null;

  /** Measured from check-in/start timestamps; null until ≥ 5 samples. */
  @Column({ type: 'smallint', name: 'avg_wait_minutes', nullable: true })
  avgWaitMinutes!: number | null;

  @Column({ type: 'smallint', name: 'avg_consult_minutes', nullable: true })
  avgConsultMinutes!: number | null;

  @Column({ type: 'int', name: 'patients_served', default: 0 })
  patientsServed!: number;

  @Column({ type: 'int', name: 'completed_30d', default: 0 })
  completed30d!: number;

  @Column({ type: 'boolean', name: 'is_top_booked', default: false })
  isTopBooked!: boolean;

  @Column({ type: 'timestamptz', name: 'next_available_at', nullable: true })
  nextAvailableAt!: Date | null;

  /** Job bookkeeping: the 07:00 digest goes out once per local day. */
  @Column({ type: 'date', name: 'daily_digest_on', nullable: true })
  dailyDigestOn!: string | null;

  @Column({
    type: 'tsvector',
    select: false,
    insert: false,
    update: false,
    nullable: true,
  })
  search?: string;
}
