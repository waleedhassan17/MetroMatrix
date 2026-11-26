import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  Appointment,
  AppointmentSource,
  PatientSnapshot,
} from './entities/appointment.entity';
import { WalkInPatient } from '../consultation/entities/walk-in-patient.entity';
import {
  AppointmentTransitionsService,
  Actor,
  SYSTEM,
} from './appointment-transitions.service';
import { AppointmentViewsService } from './appointment-views.service';
import {
  BookAppointmentDto,
  DoctorRescheduleDto,
  FollowUpDto,
  PaymentProofDto,
  RefundDto,
  WalkInDto,
} from './dto/appointment.dto';
import { ACTIVE_STATUSES } from './appointment-status';
import { Doctor } from '../doctors/entities/doctor.entity';
import { DoctorsService } from '../doctors/doctors.service';
import { PracticeLocation } from '../practice/entities/practice-location.entity';
import { FamilyService, ageFrom } from '../family/family.service';
import {
  AvailabilityService,
  DOCTOR_WINDOW_DAYS,
} from '../availability/availability.service';
import { DiscoveryService, TITLE_PREFIX } from '../discovery/discovery.service';
import { HealthEvents } from '../common/health-events';
import { LISTED_DOCTOR_SQL } from '../discovery/listing-sql';
import { availabilityLabel, todayIn, toZonedIso } from '../common/time.util';
import { newCode } from '../../../common/utils/codes';
import { ErrorCode } from '../../../common/errors/codes';
import { MediaService } from '../../media/media.service';
import { AccountService } from '../../auth/account.service';
import {
  NotificationsService,
  NotifyPayload,
} from '../../notifications/notifications.service';
import { invalidTransition } from '../../../common/state/transitions';

const MIN = 60_000;
/** Patients may hold at most this many upcoming appointments with one doctor. */
export const MAX_UPCOMING_WITH_DOCTOR = 3;
/** A rejected transfer proof leaves at least this long to try again. */
export const RESUBMIT_GRACE_MS = 2 * 60 * MIN;

/**
 * A seam for tests to fail a reschedule after the old appointment is
 * cancelled and prove the transaction leaves it booked. No-op in the app.
 */
export const APPOINTMENT_FAULT_INJECTOR = 'APPOINTMENT_FAULT_INJECTOR';
export interface AppointmentFaultInjector {
  afterOldCancelled(m: EntityManager): Promise<void> | void;
}
export const noAppointmentFaults: AppointmentFaultInjector = {
  afterOldCancelled: () => undefined,
};

/** `userId` null: a walk-in (no account), so nothing is sent. */
type Notice = { userId: string | null; payload: NotifyPayload };

const ACTIVE_SQL = `status IN ('booked', 'checked_in', 'in_consultation')`;

const isExclusionViolation = (err: unknown) =>
  (err as { code?: string })?.code === '23P01';

/**
 * Booking and every patient/doctor action on an appointment. The slot is
 * re-validated inside the transaction (never from cache), the fee comes from
 * the location, and the exclusion constraint makes a double booking
 * impossible even under a race. People are told only after the commit.
 */
@Injectable()
export class AppointmentsService implements OnModuleInit {
  private readonly logger = new Logger(AppointmentsService.name);

  /** Filled in by records (P5): share records with a new booking, in its transaction. */
  attachRecords: (
    m: EntityManager,
    a: Appointment,
    recordIds: string[],
    userId: string,
  ) => Promise<void> = async () => {};
  /** Filled in by records (P5): a rescheduled visit keeps what was shared. */
  carryRecords: (
    m: EntityManager,
    fromId: string,
    toId: string,
  ) => Promise<void> = async () => {};

  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: AppointmentTransitionsService,
    private readonly views: AppointmentViewsService,
    private readonly availability: AvailabilityService,
    private readonly doctors: DoctorsService,
    private readonly family: FamilyService,
    private readonly discovery: DiscoveryService,
    private readonly events: HealthEvents,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
    private readonly account: AccountService,
    @Inject(APPOINTMENT_FAULT_INJECTOR)
    private readonly faults: AppointmentFaultInjector,
  ) {}

  onModuleInit(): void {
    const refs = (rows: any[]) =>
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        patientName: r.patient_snapshot?.name ?? '',
      }));
    this.events.futureBookingsAtLocation = async (m, locationId) =>
      refs(
        await m.query(
          `SELECT id, code, starts_at, ends_at, patient_snapshot FROM appointments WHERE location_id = $1 AND ${ACTIVE_SQL} AND ends_at > now() ORDER BY starts_at`,
          [locationId],
        ),
      );
    this.events.locationUsed = async (m, locationId) =>
      (
        await m.query(
          `SELECT 1 FROM appointments WHERE location_id = $1 LIMIT 1`,
          [locationId],
        )
      ).length > 0;
    this.events.bookingsOverlapping = async (
      m,
      doctorId,
      locationId,
      from,
      to,
    ) =>
      refs(
        await m.query(
          `SELECT id, code, starts_at, ends_at, patient_snapshot FROM appointments
            WHERE doctor_id = $1 AND ${ACTIVE_SQL} AND starts_at < $3 AND ends_at > $2
              ${locationId ? 'AND location_id = $4' : ''}
            ORDER BY starts_at`,
          locationId ? [doctorId, from, to, locationId] : [doctorId, from, to],
        ),
      );
    this.events.cancelForTimeOff = async (m, ids, reason) => {
      const notices: Notice[] = [];
      for (const id of ids) {
        const a = await m.findOne(Appointment, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!a || !(ACTIVE_STATUSES as readonly string[]).includes(a.status))
          continue;
        await this.transitions.moveStatus(m, a, 'cancelled', SYSTEM, {
          note: reason,
          patch: { cancelledBy: 'system', cancelReason: reason },
        });
        notices.push(
          this.toPatient(
            a,
            'health.appointment.cancelled',
            `${a.code} cancelled`,
            `The doctor is unavailable: ${reason}`,
          ),
        );
      }
      return () => this.send(notices);
    };
    this.discovery.upcomingFor = async (userId) => {
      const [next] = await this.dataSource.query(
        `SELECT * FROM appointments WHERE patient_user_id = $1 AND ${ACTIVE_SQL} AND ends_at > now() ORDER BY starts_at LIMIT 1`,
        [userId],
      );
      if (!next) return null;
      const a = await this.dataSource.manager.findOneByOrFail(Appointment, {
        id: next.id,
      });
      return (await this.views.patientViews([a]))[0];
    };
    this.discovery.specialtyRanking = async (limit) =>
      (
        await this.dataSource.query(
          `SELECT d.primary_specialty_id AS id, count(*) AS n FROM appointments a JOIN doctors d ON d.id = a.doctor_id
            WHERE a.created_at > now() - interval '90 days' AND d.primary_specialty_id IS NOT NULL
            GROUP BY 1 ORDER BY n DESC LIMIT $1`,
          [limit],
        )
      ).map((r: { id: string }) => r.id);
    // Deleting a patient account cancels their upcoming visits (doctors keep the records).
    this.account.onAccountDeleted(async (m, user) => {
      const rows: Array<{ id: string }> = await m.query(
        `SELECT id FROM appointments WHERE patient_user_id = $1 AND ${ACTIVE_SQL} AND starts_at > now()`,
        [user.id],
      );
      for (const r of rows) {
        const a = await m.findOneByOrFail(Appointment, { id: r.id });
        await this.transitions.moveStatus(m, a, 'cancelled', SYSTEM, {
          note: 'Patient account deleted',
          patch: {
            cancelledBy: 'system',
            cancelReason: 'Patient account deleted',
          },
        });
      }
    });
  }

  // ── Booking ───────────────────────────────────────────────────────────────

  async book(userId: string, dto: BookAppointmentDto, now = new Date()) {
    const startsAt = new Date(dto.startsAt);
    let booked: Appointment;
    try {
      booked = await this.dataSource.transaction(async (m) => {
        const a = await this.insertBooking(m, userId, dto, startsAt, now, null);
        if (dto.attachmentRecordIds?.length)
          await this.attachRecords(m, a, dto.attachmentRecordIds, userId);
        return a;
      });
    } catch (err) {
      if (isExclusionViolation(err))
        throw await this.slotTaken(dto.doctorId, dto.locationId, startsAt);
      throw err;
    }
    await this.afterBooked(booked);
    return this.views.forPatient(userId, booked.code);
  }

  /** Everything a booking checks and writes, inside the caller's transaction. */
  private async insertBooking(
    m: EntityManager,
    userId: string,
    dto: Pick<
      BookAppointmentDto,
      | 'doctorId'
      | 'locationId'
      | 'familyMemberId'
      | 'reason'
      | 'symptoms'
      | 'paymentMethod'
    >,
    startsAt: Date,
    now: Date,
    carry: Partial<Appointment> | null,
  ): Promise<Appointment> {
    const person = `patient:${userId}:${dto.familyMemberId ?? 'self'}`;
    await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [person]);

    const [listed] = await m.query(
      `SELECT d.id, d.is_accepting FROM doctors d JOIN businesses b ON b.id = d.business_id WHERE d.id = $1 AND ${LISTED_DOCTOR_SQL}`,
      [dto.doctorId],
    );
    if (!listed || !listed.is_accepting) {
      throw new NotFoundException({
        code: ErrorCode.DOCTOR_NOT_LISTED,
        message: listed
          ? 'This doctor is not taking new bookings right now.'
          : 'This doctor is not taking bookings on MetroMatrix.',
      });
    }
    const location = await m.findOne(PracticeLocation, {
      where: { id: dto.locationId, doctorId: dto.doctorId, isActive: true },
    });
    if (!location)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Location not found.',
      });

    const { slot, free } = await this.availability.checkSlot(
      m,
      dto.doctorId,
      dto.locationId,
      startsAt,
      now,
    );
    if (!slot) {
      throw new BadRequestException({
        code: ErrorCode.SLOT_INVALID,
        message: 'That time is not one of the doctor’s available slots.',
        details: { startsAt: startsAt.toISOString() },
      });
    }
    if (!free)
      throw await this.slotTaken(dto.doctorId, dto.locationId, startsAt);

    const [overlap] = await m.query(
      `SELECT code FROM appointments
        WHERE patient_user_id = $1 AND family_member_id IS NOT DISTINCT FROM $2 AND ${ACTIVE_SQL}
          AND starts_at < $4 AND ends_at > $3 LIMIT 1`,
      [userId, dto.familyMemberId ?? null, slot.startsAt, slot.endsAt],
    );
    if (overlap) {
      throw new ConflictException({
        code: ErrorCode.PATIENT_OVERLAP,
        message: 'You already have an appointment at that time.',
        details: { appointmentCode: overlap.code },
      });
    }
    const [{ upcoming }] = await m.query(
      `SELECT count(*)::int AS upcoming FROM appointments
        WHERE patient_user_id = $1 AND doctor_id = $2 AND ${ACTIVE_SQL} AND ends_at > $3`,
      [userId, dto.doctorId, now],
    );
    if (upcoming >= MAX_UPCOMING_WITH_DOCTOR) {
      throw new ConflictException({
        code: ErrorCode.BOOKING_LIMIT,
        message: `You can hold at most ${MAX_UPCOMING_WITH_DOCTOR} upcoming appointments with one doctor.`,
        details: { limit: MAX_UPCOMING_WITH_DOCTOR },
      });
    }

    const patientSnapshot = await this.snapshotPatient(
      m,
      userId,
      dto.familyMemberId ?? null,
      now,
    );
    const method = location.kind === 'video' ? 'transfer' : 'pay_at_clinic';
    if (dto.paymentMethod && dto.paymentMethod !== method) {
      const message =
        location.kind === 'video'
          ? 'Video consultations are paid by transfer to the doctor.'
          : 'Clinic visits are paid at the clinic.';
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message,
        details: { fields: { paymentMethod: [message] } },
      });
    }
    const doctor = await m.findOneByOrFail(Doctor, { id: dto.doctorId });
    const accounts =
      method === 'transfer'
        ? await this.doctors.activeAccounts(m, doctor.id)
        : [];
    const prepay =
      method === 'transfer' &&
      doctor.videoPrepayRequired &&
      accounts.length > 0;
    const payBy = prepay
      ? new Date(
          Math.min(
            Math.max(
              now.getTime() + 10 * MIN,
              Math.min(
                now.getTime() + 120 * MIN,
                slot.startsAt.getTime() - 30 * MIN,
              ),
            ),
            slot.startsAt.getTime(),
          ),
        )
      : null;

    const values: Partial<Appointment> = {
      patientUserId: userId,
      familyMemberId: dto.familyMemberId ?? null,
      patientSnapshot,
      doctorId: doctor.id,
      locationId: location.id,
      kind: location.kind,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      status: 'booked',
      reason: dto.reason ?? null,
      symptoms: dto.symptoms ?? [],
      fee: location.fee,
      paymentMethod: method,
      paymentStatus: method === 'transfer' ? 'awaiting_transfer' : 'unpaid',
      payBy,
      paymentAccountSnapshot:
        method === 'transfer'
          ? accounts.map((a) => ({
              kind: a.kind,
              accountTitle: a.accountTitle,
              accountNumber: a.accountNumber,
              bankName: a.bankName,
            }))
          : null,
      videoRoom: location.kind === 'video' ? randomUUID() : null,
      ...carry,
    };
    return this.insertRow(
      m,
      values,
      { role: 'patient', userId },
      carry?.rescheduledFromId ? 'Rescheduled' : null,
    );
  }

  /** Insert a booked appointment under a fresh code, with its first event. */
  private async insertRow(
    m: EntityManager,
    values: Partial<Appointment>,
    actor: Actor,
    note: string | null,
  ): Promise<Appointment> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await m
        .createQueryBuilder()
        .insert()
        .into(Appointment)
        .values({ ...values, code: newCode('HC') })
        // Only a code collision is retried. A bare ON CONFLICT DO NOTHING would
        // also swallow the exclusion constraint and hide a double booking.
        .onConflict('("code") DO NOTHING')
        .returning('id')
        .execute();
      if (res.raw.length) {
        const a = await m.findOneByOrFail(Appointment, { id: res.raw[0].id });
        await this.transitions.event(
          m,
          a.id,
          'status',
          null,
          'booked',
          actor,
          note,
        );
        return a;
      }
    }
    throw new Error('Could not allocate an appointment code');
  }

  // ── The doctor's own bookings: move a visit, book a follow-up, a walk-in ──

  /**
   * A booking the doctor places: on their own grid (hours, day-specific
   * hours, the break, time off), with no minimum notice, up to
   * DOCTOR_WINDOW_DAYS ahead, bookings on or paused — and still never two
   * visits at once (checkSlot, then the exclusion constraint). The person
   * can't be in two visits at once either.
   */
  private async placeByDoctor(
    m: EntityManager,
    doctorId: string,
    locationId: string,
    startsAt: Date,
    now: Date,
    person: {
      patientUserId: string | null;
      familyMemberId: string | null;
      walkInPatientId: string | null;
      snapshot: PatientSnapshot;
    },
    rest: {
      reason: string | null;
      symptoms: string[];
      source: AppointmentSource;
      actor: Actor;
      note: string | null;
      carry?: Partial<Appointment>;
      /** A walk-in may take the slot running now (it started up to this long ago). */
      startedGraceMinutes?: number;
    },
  ): Promise<Appointment> {
    const location = await m.findOne(PracticeLocation, {
      where: { id: locationId, doctorId, isActive: true },
    });
    if (!location)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Location not found.',
      });
    const checkAt = rest.startedGraceMinutes
      ? new Date(now.getTime() - rest.startedGraceMinutes * MIN)
      : now;
    const { slot, free } = await this.availability.checkSlot(
      m,
      doctorId,
      locationId,
      startsAt,
      checkAt,
      { minNoticeMinutes: 0, bookingWindowDays: DOCTOR_WINDOW_DAYS },
    );
    if (!slot) {
      throw new BadRequestException({
        code: ErrorCode.SLOT_INVALID,
        message: 'That time is not one of your free slots there.',
        details: { startsAt: startsAt.toISOString() },
      });
    }
    if (!free) throw await this.slotTaken(doctorId, locationId, startsAt);
    const [overlap] = person.walkInPatientId
      ? await m.query(
          `SELECT code FROM appointments WHERE walk_in_patient_id = $1 AND ${ACTIVE_SQL}
              AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
          [person.walkInPatientId, slot.startsAt, slot.endsAt],
        )
      : await m.query(
          `SELECT code FROM appointments
            WHERE patient_user_id = $1 AND family_member_id IS NOT DISTINCT FROM $2 AND ${ACTIVE_SQL}
              AND starts_at < $4 AND ends_at > $3 LIMIT 1`,
          [
            person.patientUserId,
            person.familyMemberId,
            slot.startsAt,
            slot.endsAt,
          ],
        );
    if (overlap) {
      throw new ConflictException({
        code: ErrorCode.PATIENT_OVERLAP,
        message: 'They already have a visit at that time.',
        details: { appointmentCode: overlap.code },
      });
    }
    const method = location.kind === 'video' ? 'transfer' : 'pay_at_clinic';
    const doctor = await m.findOneByOrFail(Doctor, { id: doctorId });
    const accounts =
      method === 'transfer'
        ? await this.doctors.activeAccounts(m, doctor.id)
        : [];
    const prepay =
      method === 'transfer' &&
      doctor.videoPrepayRequired &&
      accounts.length > 0;
    const payBy = prepay
      ? new Date(
          Math.min(
            Math.max(
              now.getTime() + 10 * MIN,
              Math.min(
                now.getTime() + 120 * MIN,
                slot.startsAt.getTime() - 30 * MIN,
              ),
            ),
            slot.startsAt.getTime(),
          ),
        )
      : null;
    return this.insertRow(
      m,
      {
        patientUserId: person.patientUserId,
        familyMemberId: person.familyMemberId,
        walkInPatientId: person.walkInPatientId,
        source: rest.source,
        patientSnapshot: person.snapshot,
        doctorId,
        locationId: location.id,
        kind: location.kind,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: 'booked',
        reason: rest.reason,
        symptoms: rest.symptoms,
        fee: location.fee,
        paymentMethod: method,
        paymentStatus: method === 'transfer' ? 'awaiting_transfer' : 'unpaid',
        payBy,
        paymentAccountSnapshot:
          method === 'transfer'
            ? accounts.map((a) => ({
                kind: a.kind,
                accountTitle: a.accountTitle,
                accountNumber: a.accountNumber,
                bankName: a.bankName,
              }))
            : null,
        videoRoom: location.kind === 'video' ? randomUUID() : null,
        ...rest.carry,
      },
      rest.actor,
      rest.note,
    );
  }

  /** The person a doctor's booking is for, snapshotted afresh for an app patient. */
  private async personOf(m: EntityManager, a: Appointment, now: Date) {
    return {
      patientUserId: a.patientUserId,
      familyMemberId: a.familyMemberId,
      walkInPatientId: a.walkInPatientId,
      snapshot: a.patientUserId
        ? await this.snapshotPatient(m, a.patientUserId, a.familyMemberId, now)
        : a.patientSnapshot,
    };
  }

  private async doctorDisplayName(doctorId: string): Promise<string> {
    const [d] = await this.dataSource.query(
      `SELECT title, full_name FROM doctors WHERE id = $1`,
      [doctorId],
    );
    if (!d) return 'Your doctor';
    return `${TITLE_PREFIX[d.title] ?? 'Dr.'} ${d.full_name}`;
  }

  private async whenAt(a: Appointment) {
    const [loc] = await this.dataSource.query(
      `SELECT timezone, name FROM practice_locations WHERE id = $1`,
      [a.locationId],
    );
    const when = availabilityLabel(a.startsAt, loc.timezone)
      .replace(/^Available /, '')
      .replace(/^Next available /, '');
    return `${when} · ${loc.name}`;
  }

  /**
   * The doctor moves a booked visit to another of their free times (another
   * location of the same kind allowed): the old one is cancelled by the
   * doctor ("rescheduled"), the new one keeps the payment as it was, the
   * shared reports and the private notes, and the patient is told why.
   */
  async doctorReschedule(
    doctorId: string,
    doctorUserId: string,
    code: string,
    dto: DoctorRescheduleDto,
    now = new Date(),
  ) {
    const startsAt = new Date(dto.startsAt);
    let locationId = '';
    let moved: Appointment;
    try {
      moved = await this.dataSource.transaction(async (m) => {
        const old = await this.transitions.lock(m, { code, doctorId });
        if (old.status !== 'booked')
          throw invalidTransition(
            old.status,
            'cancelled',
            [],
            'Only a booked visit can be moved.',
          );
        locationId = dto.locationId ?? old.locationId;
        if (locationId !== old.locationId) {
          const target = await m.findOne(PracticeLocation, {
            where: { id: locationId, doctorId, isActive: true },
          });
          if (!target)
            throw new NotFoundException({
              code: ErrorCode.NOT_FOUND,
              message: 'Location not found.',
            });
          if (target.kind !== old.kind) {
            const message =
              'Move it to a location of the same kind (a clinic visit to a clinic, a video consultation to video).';
            throw new BadRequestException({
              code: ErrorCode.VALIDATION_FAILED,
              message,
              details: { fields: { locationId: [message] } },
            });
          }
        }
        if (startsAt.getTime() <= now.getTime()) {
          const message = 'Choose a time from now on.';
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_FAILED,
            message,
            details: { fields: { startsAt: [message] } },
          });
        }
        const before = {
          status: old.paymentStatus,
          ref: old.paymentRef,
          proof: old.paymentProofUrl,
          paidAt: old.paidAt,
        };
        const actor: Actor = { role: 'doctor', userId: doctorUserId };
        await this.transitions.moveStatus(m, old, 'cancelled', actor, {
          note: `Moved by the doctor: ${dto.reason}`,
          patch: { cancelledBy: 'doctor', cancelReason: 'rescheduled' },
          settle: false,
        });
        const carried =
          before.status === 'paid' || before.status === 'proof_submitted';
        const fresh = await this.placeByDoctor(
          m,
          doctorId,
          locationId,
          startsAt,
          now,
          await this.personOf(m, old, now),
          {
            reason: old.reason,
            symptoms: old.symptoms,
            source: old.source,
            actor,
            note: 'Moved by the doctor',
            carry: {
              rescheduledFromId: old.id,
              followUpOfId: old.followUpOfId,
              ...(carried
                ? {
                    paymentStatus: before.status,
                    paymentRef: before.ref,
                    paymentProofUrl: before.proof,
                    paidAt: before.paidAt,
                  }
                : {}),
            },
          },
        );
        await this.carryRecords(m, old.id, fresh.id);
        await m.query(
          `UPDATE medical_notes SET appointment_id = $2 WHERE appointment_id = $1`,
          [old.id, fresh.id],
        );
        await this.transitions.movePayment(
          m,
          old,
          'void',
          carried ? SYSTEM : actor,
          { note: carried ? `Payment moved to ${fresh.code}` : 'Moved' },
        );
        return fresh;
      });
    } catch (err) {
      if (isExclusionViolation(err))
        throw await this.slotTaken(doctorId, locationId, startsAt);
      throw err;
    }
    await this.events.availabilityChanged(doctorId);
    await this.send([
      this.toPatient(
        moved,
        'health.appointment.moved',
        `New time for your visit: ${moved.code}`,
        `${await this.doctorDisplayName(doctorId)} moved it to ${await this.whenAt(moved)}. ${dto.reason}`,
      ),
    ]);
    return this.doctorBrief(doctorId, moved.code);
  }

  /**
   * The doctor books the follow-up of a visit for the same person (a family
   * member included, or a walk-in), linked to it (`followUpOfId`), on that
   * location's payment rules. The patient is told.
   */
  async bookFollowUp(
    doctorId: string,
    doctorUserId: string,
    code: string,
    dto: FollowUpDto,
    now = new Date(),
  ) {
    const startsAt = new Date(dto.startsAt);
    let booked: Appointment;
    try {
      booked = await this.dataSource.transaction(async (m) => {
        const src = await this.transitions.lock(m, { code, doctorId });
        if (!['in_consultation', 'completed'].includes(src.status))
          throw invalidTransition(
            src.status,
            'booked',
            [],
            'Book a follow-up from a visit that has started or is completed.',
          );
        if (startsAt.getTime() <= now.getTime()) {
          const message = 'Choose a time from now on.';
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_FAILED,
            message,
            details: { fields: { startsAt: [message] } },
          });
        }
        return this.placeByDoctor(
          m,
          doctorId,
          dto.locationId,
          startsAt,
          now,
          await this.personOf(m, src, now),
          {
            reason: 'Follow-up',
            symptoms: [],
            source: src.source,
            actor: { role: 'doctor', userId: doctorUserId },
            note: `Follow-up of ${src.code}`,
            carry: { followUpOfId: src.id },
          },
        );
      });
    } catch (err) {
      if (isExclusionViolation(err))
        throw await this.slotTaken(doctorId, dto.locationId, startsAt);
      throw err;
    }
    await this.events.availabilityChanged(doctorId);
    await this.send([
      this.toPatient(
        booked,
        'health.appointment.booked',
        `Follow-up booked: ${booked.code}`,
        `${await this.doctorDisplayName(doctorId)} booked your follow-up · ${await this.whenAt(booked)}`,
      ),
    ]);
    return this.doctorBrief(doctorId, booked.code);
  }

  /**
   * Someone at the clinic desk with no booking: the doctor adds them (name,
   * phone, gender, age) to a free slot today — the one running now when no
   * time is given, else the next free one — checked in at once, paying at
   * the clinic. Walk-ins have no account: nothing is sent to them.
   */
  async addWalkIn(
    doctorId: string,
    doctorUserId: string,
    dto: WalkInDto,
    now = new Date(),
  ) {
    let locationId = dto.locationId;
    let startsAt = dto.startsAt ? new Date(dto.startsAt) : now;
    let added: Appointment;
    try {
      added = await this.dataSource.transaction(async (m) => {
        const location = await m.findOne(PracticeLocation, {
          where: { id: dto.locationId, doctorId, isActive: true },
        });
        if (!location)
          throw new NotFoundException({
            code: ErrorCode.NOT_FOUND,
            message: 'Location not found.',
          });
        locationId = location.id;
        if (location.kind !== 'clinic') {
          const message = 'Walk-ins are for your clinics.';
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_FAILED,
            message,
            details: { fields: { locationId: [message] } },
          });
        }
        const tz = location.timezone;
        const today = todayIn(tz, now);
        const grace = location.slotMinutes;
        if (dto.startsAt) {
          if (todayIn(tz, startsAt) !== today) {
            const message = 'A walk-in is for today.';
            throw new BadRequestException({
              code: ErrorCode.VALIDATION_FAILED,
              message,
              details: { fields: { startsAt: [message] } },
            });
          }
        } else {
          // The slot running now (it started up to a slot ago), else the next free one today.
          const { days } = await this.availability.days(
            doctorId,
            location.id,
            today,
            1,
            {
              m,
              fresh: true,
              now: new Date(now.getTime() - grace * MIN),
              ignorePause: true,
              minNoticeMinutes: 0,
              bookingWindowDays: DOCTOR_WINDOW_DAYS,
            },
          );
          const next = (days[0]?.slots ?? []).find((s) => s.endsAt > now);
          if (!next)
            throw new ConflictException({
              code: ErrorCode.NO_FREE_SLOT,
              message:
                'No free time is left today at this clinic. Add hours for today, or choose another clinic.',
            });
          startsAt = next.startsAt;
        }
        const person = await m.save(
          m.create(WalkInPatient, {
            doctorId,
            name: dto.patient.name,
            phone: dto.patient.phone ?? null,
            gender: dto.patient.gender ?? null,
            age: dto.patient.age ?? null,
          }),
        );
        const actor: Actor = { role: 'doctor', userId: doctorUserId };
        const a = await this.placeByDoctor(
          m,
          doctorId,
          location.id,
          startsAt,
          now,
          {
            patientUserId: null,
            familyMemberId: null,
            walkInPatientId: person.id,
            snapshot: {
              name: dto.patient.name,
              gender: dto.patient.gender ?? null,
              age: dto.patient.age ?? null,
              phone: dto.patient.phone ?? null,
              relation: null,
            },
          },
          {
            reason: dto.reason ?? null,
            symptoms: [],
            source: 'walk_in',
            actor,
            note: 'Walk-in',
            startedGraceMinutes: grace,
          },
        );
        await this.transitions.moveStatus(m, a, 'checked_in', actor, {
          note: 'Walk-in',
        });
        return a;
      });
    } catch (err) {
      if (isExclusionViolation(err))
        throw await this.slotTaken(doctorId, locationId, startsAt);
      throw err;
    }
    await this.events.availabilityChanged(doctorId);
    return this.doctorBrief(doctorId, added.code);
  }

  private async snapshotPatient(
    m: EntityManager,
    userId: string,
    familyMemberId: string | null,
    now: Date,
  ): Promise<PatientSnapshot> {
    if (familyMemberId) {
      const f = await this.family.owned(userId, familyMemberId);
      return {
        name: f.fullName,
        gender: f.gender,
        age: ageFrom(f.dateOfBirth, now),
        phone: f.phone,
        relation: f.relation,
      };
    }
    const [u] = await m.query(
      `SELECT display_name, phone FROM users WHERE id = $1`,
      [userId],
    );
    return {
      name: u?.display_name ?? 'Patient',
      gender: null,
      age: null,
      phone: u?.phone ?? null,
      relation: null,
    };
  }

  /** 409 SLOT_TAKEN with the three nearest free slots. */
  private async slotTaken(
    doctorId: string,
    locationId: string,
    startsAt: Date,
  ): Promise<HttpException> {
    let alternatives: Array<{ startsAt: string; endsAt: string }> = [];
    try {
      const tz = (
        await this.dataSource.manager.findOneByOrFail(PracticeLocation, {
          id: locationId,
        })
      ).timezone;
      alternatives = (
        await this.availability.nearest(doctorId, locationId, startsAt, 3)
      ).map((s) => ({
        startsAt: toZonedIso(s.startsAt, tz),
        endsAt: toZonedIso(s.endsAt, tz),
      }));
    } catch (err) {
      this.logger.warn(`alternatives: ${(err as Error).message}`);
    }
    return new ConflictException({
      code: ErrorCode.SLOT_TAKEN,
      message:
        'Someone just booked that time. Here are the nearest free slots.',
      details: { alternatives },
    });
  }

  private async afterBooked(a: Appointment) {
    await this.events.availabilityChanged(a.doctorId);
    const [owner] = await this.dataSource.query(
      `SELECT b.owner_user_id, l.timezone, l.name FROM doctors d JOIN businesses b ON b.id = d.business_id
         JOIN practice_locations l ON l.id = $2 WHERE d.id = $1`,
      [a.doctorId, a.locationId],
    );
    const when = availabilityLabel(a.startsAt, owner.timezone)
      .replace(/^Available /, '')
      .replace(/^Next available /, '');
    await this.send([
      this.toDoctor(
        owner.owner_user_id,
        a,
        'health.appointment.new',
        `New appointment ${a.code}`,
        `${a.patientSnapshot.name} · ${when} · ${owner.name}`,
      ),
      this.toPatient(
        a,
        'health.appointment.booked',
        `Booked ${a.code}`,
        `${when} · ${owner.name}`,
      ),
    ]);
  }

  // ── Patient actions ───────────────────────────────────────────────────────

  async patientCancel(
    userId: string,
    code: string,
    reason: string,
    now = new Date(),
  ) {
    const notices = await this.dataSource.transaction(async (m) => {
      const a = await this.transitions.lock(m, { code, patientUserId: userId });
      if (a.status === 'booked' && now >= a.startsAt) {
        throw new ConflictException({
          code: ErrorCode.CANCEL_CUTOFF_PASSED,
          message: 'This appointment has already started.',
          details: { startsAt: a.startsAt },
        });
      }
      const doctor = await m.findOneByOrFail(Doctor, { id: a.doctorId });
      const late =
        now.getTime() > a.startsAt.getTime() - doctor.cancelCutoffMinutes * MIN;
      await this.transitions.moveStatus(
        m,
        a,
        'cancelled',
        { role: 'patient', userId },
        {
          note: reason,
          patch: {
            cancelledBy: 'patient',
            cancelReason: reason,
            lateCancel: late,
          },
        },
      );
      return [
        await this.doctorNotice(
          m,
          a,
          'health.appointment.cancelled',
          `${a.code} cancelled by the patient`,
          reason,
        ),
      ];
    });
    await this.send(notices);
    await this.events.availabilityChanged(await this.doctorIdOf(code));
    return this.views.forPatient(userId, code);
  }

  /**
   * Move to another slot with the same doctor and location — once, before the
   * cutoff. One transaction: cancel the old one, book the new one (the old
   * time is free again inside it); any failure leaves the old one booked.
   */
  async reschedule(
    userId: string,
    code: string,
    startsAtIso: string,
    now = new Date(),
  ) {
    const startsAt = new Date(startsAtIso);
    let moved: Appointment;
    let doctorId = '';
    let locationId = '';
    try {
      moved = await this.dataSource.transaction(async (m) => {
        const old = await this.transitions.lock(m, {
          code,
          patientUserId: userId,
        });
        doctorId = old.doctorId;
        locationId = old.locationId;
        if (old.rescheduledFromId) {
          // Once by the patient; a move the doctor made doesn't count.
          const [prev] = await m.query(
            `SELECT cancelled_by FROM appointments WHERE id = $1`,
            [old.rescheduledFromId],
          );
          if (prev?.cancelled_by !== 'doctor')
            throw new ConflictException({
              code: ErrorCode.RESCHEDULE_NOT_ALLOWED,
              message: 'An appointment can be rescheduled only once.',
            });
        }
        if (old.status !== 'booked')
          throw invalidTransition(
            old.status,
            'cancelled',
            [],
            'Only a booked appointment can be rescheduled.',
          );
        const doctor = await m.findOneByOrFail(Doctor, { id: old.doctorId });
        if (
          now.getTime() >
          old.startsAt.getTime() - doctor.cancelCutoffMinutes * MIN
        ) {
          throw new ConflictException({
            code: ErrorCode.CANCEL_CUTOFF_PASSED,
            message: `Rescheduling closes ${doctor.cancelCutoffMinutes} minutes before the appointment.`,
            details: { cutoffMinutes: doctor.cancelCutoffMinutes },
          });
        }
        const before = {
          status: old.paymentStatus,
          ref: old.paymentRef,
          proof: old.paymentProofUrl,
          paidAt: old.paidAt,
        };
        const patient: Actor = { role: 'patient', userId };
        await this.transitions.moveStatus(m, old, 'cancelled', patient, {
          note: 'Rescheduled',
          patch: { cancelledBy: 'patient', cancelReason: 'rescheduled' },
          settle: false,
        });
        await this.faults.afterOldCancelled(m);
        // A payment already made (or claimed) moves with the appointment.
        const carried =
          before.status === 'paid' || before.status === 'proof_submitted';
        const fresh = await this.insertBooking(
          m,
          userId,
          {
            doctorId: old.doctorId,
            locationId: old.locationId,
            familyMemberId: old.familyMemberId,
            reason: old.reason ?? undefined,
            symptoms: old.symptoms,
          },
          startsAt,
          now,
          {
            rescheduledFromId: old.id,
            ...(carried
              ? {
                  paymentStatus: before.status,
                  paymentRef: before.ref,
                  paymentProofUrl: before.proof,
                  paidAt: before.paidAt,
                }
              : {}),
          },
        );
        await this.carryRecords(m, old.id, fresh.id);
        if (carried) {
          await this.transitions.movePayment(m, old, 'void', SYSTEM, {
            note: `Payment moved to ${fresh.code}`,
          });
        } else {
          await this.transitions.movePayment(m, old, 'void', patient, {
            note: 'Rescheduled',
          });
        }
        return fresh;
      });
    } catch (err) {
      if (isExclusionViolation(err))
        throw await this.slotTaken(doctorId, locationId, startsAt);
      throw err;
    }
    await this.afterBooked(moved);
    return this.views.forPatient(userId, moved.code);
  }

  async submitPaymentProof(userId: string, code: string, dto: PaymentProofDto) {
    const notices = await this.dataSource.transaction(async (m) => {
      const a = await this.transitions.lock(m, { code, patientUserId: userId });
      if (a.paymentMethod !== 'transfer') {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Clinic visits are paid at the clinic.',
        });
      }
      if (a.status !== 'booked' && a.status !== 'in_consultation') {
        throw invalidTransition(
          a.paymentStatus,
          'proof_submitted',
          [],
          'This appointment is closed.',
        );
      }
      if (dto.proofUrl)
        this.media.assertOwnedAsset(
          userId,
          'payment_proof',
          dto.proofUrl,
          undefined,
          'proofUrl',
        );
      await this.transitions.movePayment(
        m,
        a,
        'proof_submitted',
        { role: 'patient', userId },
        {
          note: dto.paymentRef,
          patch: {
            paymentRef: dto.paymentRef,
            paymentProofUrl: dto.proofUrl ?? null,
            paymentRejectedReason: null,
          },
        },
      );
      return [
        await this.doctorNotice(
          m,
          a,
          'health.payment.proof',
          `${a.code}: payment sent`,
          `Ref ${dto.paymentRef} · Rs ${a.fee} — please confirm.`,
        ),
      ];
    });
    await this.send(notices);
    return this.views.forPatient(userId, code);
  }

  // ── Doctor actions (P3: cancel and payments; the visit flow is in the doctor workflow) ──

  async doctorCancel(
    doctorId: string,
    doctorUserId: string,
    code: string,
    reason: string,
  ) {
    const notices = await this.dataSource.transaction(async (m) => {
      const a = await this.transitions.lock(m, { code, doctorId });
      await this.transitions.moveStatus(
        m,
        a,
        'cancelled',
        { role: 'doctor', userId: doctorUserId },
        {
          note: reason,
          patch: { cancelledBy: 'doctor', cancelReason: reason },
        },
      );
      return [
        this.toPatient(
          a,
          'health.appointment.cancelled',
          `${a.code} cancelled by the doctor`,
          reason,
        ),
      ];
    });
    await this.send(notices);
    await this.events.availabilityChanged(doctorId);
    return this.doctorBrief(doctorId, code);
  }

  async confirmPayment(doctorId: string, doctorUserId: string, code: string) {
    return this.doctorPayment(doctorId, code, async (m, a) => {
      if (a.paymentMethod !== 'transfer') {
        throw invalidTransition(
          a.paymentStatus,
          'paid',
          [],
          'Mark a clinic fee paid when completing the visit.',
        );
      }
      await this.transitions.movePayment(m, a, 'paid', {
        role: 'doctor',
        userId: doctorUserId,
      });
      return [
        this.toPatient(
          a,
          'health.payment.confirmed',
          `${a.code}: payment received`,
          `The doctor confirmed Rs ${a.fee}.`,
        ),
      ];
    });
  }

  /** A clinic fee collected at the desk or after the visit (pay at clinic, unpaid → paid). */
  async markPaid(doctorId: string, doctorUserId: string, code: string) {
    return this.doctorPayment(doctorId, code, async (m, a) => {
      if (
        a.paymentMethod !== 'pay_at_clinic' ||
        !['checked_in', 'in_consultation', 'completed'].includes(a.status)
      ) {
        throw invalidTransition(
          a.paymentStatus,
          'paid',
          [],
          a.paymentMethod === 'transfer'
            ? 'Confirm a transfer when you find it in your account.'
            : 'Mark the fee paid once the patient is at the clinic.',
        );
      }
      await this.transitions.movePayment(
        m,
        a,
        'paid',
        { role: 'doctor', userId: doctorUserId },
        { note: 'Collected at the clinic' },
      );
      return [];
    });
  }

  async rejectPayment(
    doctorId: string,
    doctorUserId: string,
    code: string,
    reason: string,
  ) {
    return this.doctorPayment(doctorId, code, async (m, a) => {
      const floor = new Date(Date.now() + RESUBMIT_GRACE_MS);
      const payBy = a.payBy
        ? new Date(
            Math.min(
              Math.max(a.payBy.getTime(), floor.getTime()),
              a.startsAt.getTime(),
            ),
          )
        : null;
      await this.transitions.movePayment(
        m,
        a,
        'awaiting_transfer',
        { role: 'doctor', userId: doctorUserId },
        {
          note: reason,
          patch: { paymentRejectedReason: reason, payBy },
        },
      );
      return [
        this.toPatient(
          a,
          'health.payment.rejected',
          `${a.code}: payment not received`,
          `${reason} — please check and resubmit.`,
        ),
      ];
    });
  }

  async refund(
    doctorId: string,
    doctorUserId: string,
    code: string,
    dto: RefundDto,
  ) {
    return this.doctorPayment(doctorId, code, async (m, a) => {
      await this.transitions.movePayment(
        m,
        a,
        'refunded',
        { role: 'doctor', userId: doctorUserId },
        {
          note: dto.refundRef,
          patch: { refundRef: dto.refundRef },
        },
      );
      return [
        this.toPatient(
          a,
          'health.payment.refunded',
          `${a.code}: refund sent`,
          `Rs ${a.fee} · ref ${dto.refundRef}`,
        ),
      ];
    });
  }

  private async doctorPayment(
    doctorId: string,
    code: string,
    work: (m: EntityManager, a: Appointment) => Promise<Notice[]>,
  ) {
    const notices = await this.dataSource.transaction(async (m) =>
      work(m, await this.transitions.lock(m, { code, doctorId })),
    );
    await this.send(notices);
    return this.doctorBrief(doctorId, code);
  }

  /** Minimal doctor-side view (the doctor workflow adds history and records). */
  async doctorBrief(doctorId: string, code: string) {
    const a = await this.dataSource.manager.findOne(Appointment, {
      where: { code: code.toUpperCase(), doctorId },
    });
    if (!a)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Appointment not found.',
      });
    const tz = (
      await this.dataSource.manager.findOneByOrFail(PracticeLocation, {
        id: a.locationId,
      })
    ).timezone;
    return this.views.core(a, tz);
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private async doctorIdOf(code: string): Promise<string> {
    const [r] = await this.dataSource.query(
      `SELECT doctor_id FROM appointments WHERE code = $1`,
      [code.toUpperCase()],
    );
    return r.doctor_id;
  }

  private toPatient(
    a: Appointment,
    type: string,
    title: string,
    body: string,
  ): Notice {
    return {
      userId: a.patientUserId,
      payload: { type, title, body, data: { appointmentCode: a.code } },
    };
  }

  private toDoctor(
    ownerUserId: string,
    a: Appointment,
    type: string,
    title: string,
    body: string,
  ): Notice {
    return {
      userId: ownerUserId,
      payload: { type, title, body, data: { appointmentCode: a.code } },
    };
  }

  private async doctorNotice(
    m: EntityManager,
    a: Appointment,
    type: string,
    title: string,
    body: string,
  ): Promise<Notice> {
    const [o] = await m.query(
      `SELECT b.owner_user_id FROM doctors d JOIN businesses b ON b.id = d.business_id WHERE d.id = $1`,
      [a.doctorId],
    );
    return this.toDoctor(o.owner_user_id, a, type, title, body);
  }

  /** After a support (admin) cancel: tell both sides. */
  async notifyAdminCancel(a: Appointment, reason: string) {
    const body = `MetroMatrix support cancelled this appointment: ${reason}`;
    await this.send([
      this.toPatient(
        a,
        'health.appointment.cancelled',
        `${a.code} cancelled`,
        body,
      ),
      await this.doctorNotice(
        this.dataSource.manager,
        a,
        'health.appointment.cancelled',
        `${a.code} cancelled`,
        body,
      ),
    ]);
  }

  async send(notices: Notice[]) {
    for (const n of notices) {
      if (!n.userId) continue;
      try {
        await this.notifications.notify(n.userId, n.payload);
      } catch (err) {
        this.logger.warn(`notification failed: ${(err as Error).message}`);
      }
    }
  }
}
