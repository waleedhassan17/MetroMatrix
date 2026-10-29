import {
  Check,
  Column,
  Entity,
  Exclusion,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { BaseEntity } from '../../../../common/base/base.entity';
import { User } from '../../../users/entities/user.entity';
import { Doctor } from '../../doctors/entities/doctor.entity';
import {
  PracticeLocation,
  LOCATION_KINDS,
  LocationKind,
} from '../../practice/entities/practice-location.entity';
import { FamilyMember } from '../../family/entities/family-member.entity';
import {
  APPOINTMENT_ACTORS,
  APPOINTMENT_STATUSES,
  AppointmentActor,
  AppointmentStatus,
} from '../appointment-status';
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PaymentMethod,
  PaymentStatus,
} from '../payment-status';
import { PaymentAccountKind } from '../../../../common/payments/payment-account.validation';

/** Who the appointment is for, as it was when booked. */
export interface PatientSnapshot {
  name: string;
  gender: string | null;
  age: number | null;
  phone: string | null;
  relation: string | null;
}

export interface AccountSnapshot {
  kind: PaymentAccountKind;
  accountTitle: string;
  accountNumber: string;
  bankName: string | null;
}

/**
 * A booked visit. Double booking is impossible in the database: the
 * exclusion constraint refuses two active appointments of one doctor whose
 * time ranges overlap — at any location, so a doctor can't be booked in two
 * clinics at once. A clash raises 23P01 → 409 SLOT_TAKEN.
 *
 * Status and payment move only through AppointmentTransitionsService, which
 * writes an appointment_events row with each change.
 */
@Entity('appointments')
@Exclusion(
  'EX_appointments_doctor_time',
  `USING gist ("doctor_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE (("status" = ANY (ARRAY['booked'::"appointment_status", 'checked_in'::"appointment_status", 'in_consultation'::"appointment_status"])))`,
)
@Index(['code'], { unique: true })
@Index(['doctorId', 'startsAt'])
// Bookings made per period (admin overview, analytics).
@Index('IDX_appointments_created_at', ['createdAt'])
@Index('IDX_appointments_patient_starts', { synchronize: false })
@Index(['status', 'payBy'])
@Check('CHK_appointments_times', '"ends_at" > "starts_at" AND "fee" >= 0')
export class Appointment extends BaseEntity {
  /** HC-XXXXXX */
  @Column({ type: 'varchar', length: 12 })
  code!: string;

  /** The account that booked (and owns it), whoever it is for. */
  @Column({ type: 'uuid', name: 'patient_user_id' })
  patientUserId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'patient_user_id' })
  patient?: User;

  @Column({ type: 'uuid', name: 'family_member_id', nullable: true })
  familyMemberId!: string | null;

  @ManyToOne(() => FamilyMember, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'family_member_id' })
  familyMember?: FamilyMember;

  @Column({ type: 'jsonb', name: 'patient_snapshot' })
  patientSnapshot!: PatientSnapshot;

  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId!: string;

  @ManyToOne(() => Doctor)
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'uuid', name: 'location_id' })
  locationId!: string;

  @ManyToOne(() => PracticeLocation)
  @JoinColumn({ name: 'location_id' })
  location?: PracticeLocation;

  @Column({
    type: 'enum',
    enum: LOCATION_KINDS,
    enumName: 'practice_location_kind',
  })
  kind!: LocationKind;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  @Column({ type: 'timestamptz', name: 'ends_at' })
  endsAt!: Date;

  @Column({
    type: 'enum',
    enum: APPOINTMENT_STATUSES,
    enumName: 'appointment_status',
    default: 'booked',
  })
  status!: AppointmentStatus;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'text', array: true })
  symptoms!: string[];

  /** Rupees, from the location at booking time. */
  @Column({ type: 'int' })
  fee!: number;

  @Column({
    type: 'enum',
    enum: PAYMENT_METHODS,
    enumName: 'appointment_payment_method',
    name: 'payment_method',
  })
  paymentMethod!: PaymentMethod;

  @Column({
    type: 'enum',
    enum: PAYMENT_STATUSES,
    enumName: 'appointment_payment_status',
    name: 'payment_status',
  })
  paymentStatus!: PaymentStatus;

  @Column({ type: 'varchar', length: 100, name: 'payment_ref', nullable: true })
  paymentRef!: string | null;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'payment_proof_url',
    nullable: true,
  })
  paymentProofUrl!: string | null;

  @Column({ type: 'text', name: 'payment_rejected_reason', nullable: true })
  paymentRejectedReason!: string | null;

  /** Required prepayment deadline; unpaid after it, the system cancels. */
  @Column({ type: 'timestamptz', name: 'pay_by', nullable: true })
  payBy!: Date | null;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'jsonb', name: 'payment_account_snapshot', nullable: true })
  paymentAccountSnapshot!: AccountSnapshot[] | null;

  @Column({ type: 'varchar', length: 100, name: 'refund_ref', nullable: true })
  refundRef!: string | null;

  @Column({ type: 'timestamptz', name: 'refunded_at', nullable: true })
  refundedAt!: Date | null;

  @Column({ type: 'uuid', name: 'rescheduled_from_id', nullable: true })
  rescheduledFromId!: string | null;

  @ManyToOne(() => Appointment, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rescheduled_from_id' })
  rescheduledFrom?: Appointment;

  @Column({ type: 'timestamptz', name: 'checked_in_at', nullable: true })
  checkedInAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt!: Date | null;

  @Column({
    type: 'enum',
    enum: APPOINTMENT_ACTORS,
    enumName: 'appointment_actor',
    name: 'cancelled_by',
    nullable: true,
  })
  cancelledBy!: AppointmentActor | null;

  @Column({ type: 'text', name: 'cancel_reason', nullable: true })
  cancelReason!: string | null;

  /** Cancelled by the patient inside the doctor's cutoff. */
  @Column({ type: 'boolean', name: 'late_cancel', default: false })
  lateCancel!: boolean;

  /** Video: mm-<this uuid> — never derivable from the code. */
  @Column({ type: 'uuid', name: 'video_room', nullable: true })
  videoRoom!: string | null;

  @Column({ type: 'timestamptz', name: 'reminded_24h_at', nullable: true })
  reminded24hAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'reminded_1h_at', nullable: true })
  reminded1hAt!: Date | null;
}
