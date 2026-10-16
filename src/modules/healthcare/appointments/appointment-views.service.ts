import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { AppointmentEvent } from './entities/appointment-event.entity';
import { PatientAppointmentQueryDto } from './dto/appointment.dto';
import { ACTIVE_STATUSES } from './appointment-status';
import { TITLE_PREFIX } from '../discovery/discovery.service';
import { toZonedIso } from '../common/time.util';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';

const MIN = 60_000;
export const JOIN_EARLY_MS = 10 * MIN;
export const JOIN_LATE_MS = 30 * MIN;
export const REVIEW_WINDOW_MS = 30 * 24 * 60 * MIN;

export const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Appointment not found.',
  });

export interface DoctorBrief {
  id: string;
  businessId: string;
  displayName: string;
  photoUrl: string | null;
  specialty: string | null;
  cancelCutoffMinutes: number;
}

export interface LocationBrief {
  id: string;
  kind: string;
  name: string;
  addressLine: string | null;
  area: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  instructions: string | null;
  timezone: string;
}

/** Can a video appointment be joined right now (status, window, prepayment)? */
export function videoJoinState(
  a: Appointment,
  now = new Date(),
): 'ok' | 'window' | 'status' | 'payment' {
  if (
    a.kind !== 'video' ||
    (a.status !== 'booked' && a.status !== 'in_consultation')
  )
    return 'status';
  const t = now.getTime();
  if (
    t < a.startsAt.getTime() - JOIN_EARLY_MS ||
    t > a.endsAt.getTime() + JOIN_LATE_MS
  )
    return 'window';
  if (a.payBy && a.paymentStatus !== 'paid') return 'payment';
  return 'ok';
}

/**
 * Read models for appointments. Times are ISO strings in the location's zone.
 * `can.*` flags are computed here so the app never re-implements the rules.
 */
@Injectable()
export class AppointmentViewsService {
  /** Filled in by reviews (P5): has this appointment been reviewed? */
  reviewed: (appointmentIds: string[]) => Promise<Set<string>> = async () =>
    new Set();
  /** Filled in by records (P5): records shared with each appointment. */
  attachments: (appointmentIds: string[]) => Promise<Map<string, unknown[]>> =
    async () => new Map();

  /** The prescription written for each appointment, if any (the patient's own). */
  async prescriptionIds(appointmentIds: string[]) {
    if (!appointmentIds.length) return new Map<string, string>();
    const rows: Array<{ id: string; appointment_id: string }> =
      await this.dataSource.query(
        `SELECT id, appointment_id FROM prescriptions WHERE appointment_id = ANY($1::uuid[])`,
        [appointmentIds],
      );
    return new Map(rows.map((r) => [r.appointment_id, r.id]));
  }

  constructor(private readonly dataSource: DataSource) {}

  async briefs(doctorIds: string[], locationIds: string[]) {
    const [doctors, locations] = await Promise.all([
      doctorIds.length
        ? this.dataSource.query(
            `SELECT d.id, d.business_id, d.title, d.full_name, d.photo_url, d.cancel_cutoff_minutes, s.name AS specialty
               FROM doctors d LEFT JOIN specialties s ON s.id = d.primary_specialty_id WHERE d.id = ANY($1::uuid[])`,
            [doctorIds],
          )
        : [],
      locationIds.length
        ? this.dataSource.query(
            `SELECT id, kind, name, address_line, area, city, lat, lng, phone, instructions, timezone
               FROM practice_locations WHERE id = ANY($1::uuid[])`,
            [locationIds],
          )
        : [],
    ]);
    return {
      doctor: new Map<string, DoctorBrief>(
        doctors.map((d: any) => [
          d.id,
          {
            id: d.id,
            businessId: d.business_id,
            displayName: `${TITLE_PREFIX[d.title] ?? 'Dr.'} ${d.full_name}`,
            photoUrl: d.photo_url,
            specialty: d.specialty,
            cancelCutoffMinutes: d.cancel_cutoff_minutes,
          },
        ]),
      ),
      location: new Map<string, LocationBrief>(
        locations.map((l: any) => [
          l.id,
          {
            id: l.id,
            kind: l.kind,
            name: l.name,
            addressLine: l.address_line,
            area: l.area,
            city: l.city,
            lat: l.lat === null ? null : parseFloat(l.lat),
            lng: l.lng === null ? null : parseFloat(l.lng),
            phone: l.phone,
            instructions: l.instructions,
            timezone: l.timezone,
          },
        ]),
      ),
    };
  }

  core(a: Appointment, tz: string) {
    const z = (d: Date | null) => (d ? toZonedIso(d, tz) : null);
    return {
      id: a.id,
      code: a.code,
      status: a.status,
      kind: a.kind,
      startsAt: z(a.startsAt),
      endsAt: z(a.endsAt),
      patient: a.patientSnapshot,
      familyMemberId: a.familyMemberId,
      reason: a.reason,
      symptoms: a.symptoms,
      fee: a.fee,
      payment: {
        method: a.paymentMethod,
        status: a.paymentStatus,
        payBy: z(a.payBy),
        paidAt: z(a.paidAt),
        paymentRef: a.paymentRef,
        proofUrl: a.paymentProofUrl,
        rejectedReason: a.paymentRejectedReason,
        // Where to transfer: the doctor's own accounts, as at booking.
        accounts: a.paymentAccountSnapshot,
        refundRef: a.refundRef,
        refundedAt: z(a.refundedAt),
      },
      lateCancel: a.lateCancel,
      cancelledBy: a.cancelledBy,
      cancelReason: a.cancelReason,
      rescheduledFromId: a.rescheduledFromId,
      bookedAt: z(a.createdAt),
      checkedInAt: z(a.checkedInAt),
      startedAt: z(a.startedAt),
      completedAt: z(a.completedAt),
      cancelledAt: z(a.cancelledAt),
    };
  }

  async events(appointmentIds: string[]) {
    if (!appointmentIds.length) return new Map<string, AppointmentEvent[]>();
    const rows = await this.dataSource.manager.find(AppointmentEvent, {
      where: { appointmentId: In(appointmentIds) },
      order: { at: 'ASC', id: 'ASC' },
    });
    const out = new Map<string, AppointmentEvent[]>();
    rows.forEach((e) =>
      out.set(e.appointmentId, [...(out.get(e.appointmentId) ?? []), e]),
    );
    return out;
  }

  /** The patient's own view: timeline, location, payment instructions, actions. */
  async forPatient(userId: string, code: string, now = new Date()) {
    const a = await this.dataSource.manager.findOne(Appointment, {
      where: { code: code.toUpperCase(), patientUserId: userId },
    });
    if (!a) throw notFound();
    return (await this.patientViews([a], now, true))[0];
  }

  async patientViews(
    rows: Appointment[],
    now = new Date(),
    withEvents = false,
  ) {
    if (!rows.length) return [];
    const [b, events, reviewed, attachments, prescriptions] = await Promise.all(
      [
        this.briefs(
          [...new Set(rows.map((r) => r.doctorId))],
          [...new Set(rows.map((r) => r.locationId))],
        ),
        withEvents
          ? this.events(rows.map((r) => r.id))
          : Promise.resolve(new Map<string, AppointmentEvent[]>()),
        this.reviewed(rows.map((r) => r.id)),
        withEvents
          ? this.attachments(rows.map((r) => r.id))
          : Promise.resolve(new Map<string, unknown[]>()),
        this.prescriptionIds(rows.map((r) => r.id)),
      ],
    );
    return rows.map((a) => {
      const loc = b.location.get(a.locationId)!;
      const doc = b.doctor.get(a.doctorId)!;
      const t = now.getTime();
      const cutoff = a.startsAt.getTime() - doc.cancelCutoffMinutes * MIN;
      return {
        ...this.core(a, loc.timezone),
        doctor: {
          id: doc.id,
          displayName: doc.displayName,
          photoUrl: doc.photoUrl,
          specialty: doc.specialty,
        },
        location: loc,
        // A reschedule is allowed until here (the doctor's notice), a free cancel too.
        cancelCutoffAt: toZonedIso(new Date(cutoff), loc.timezone),
        prescriptionId: prescriptions.get(a.id) ?? null,
        reviewed: reviewed.has(a.id),
        ...(withEvents
          ? {
              events: (events.get(a.id) ?? []).map((e) => ({
                kind: e.kind,
                from: e.from,
                to: e.to,
                actorRole: e.actorRole,
                note: e.note,
                at: toZonedIso(e.at, loc.timezone),
              })),
              sharedRecords: attachments.get(a.id) ?? [],
            }
          : {}),
        can: {
          cancel: a.status === 'booked' && t < a.startsAt.getTime(),
          reschedule:
            a.status === 'booked' && !a.rescheduledFromId && t < cutoff,
          joinVideo: videoJoinState(a, now) === 'ok',
          shareRecords: (ACTIVE_STATUSES as readonly string[]).includes(
            a.status,
          ),
          submitPaymentProof:
            a.paymentMethod === 'transfer' &&
            a.paymentStatus === 'awaiting_transfer' &&
            a.status === 'booked',
          review:
            a.status === 'completed' &&
            !!a.completedAt &&
            t - a.completedAt.getTime() <= REVIEW_WINDOW_MS &&
            !reviewed.has(a.id),
        },
      };
    });
  }

  async patientList(
    userId: string,
    q: PatientAppointmentQueryDto,
    now = new Date(),
  ) {
    const upcoming = (q.scope ?? 'upcoming') === 'upcoming';
    const qb = this.dataSource
      .getRepository(Appointment)
      .createQueryBuilder('a')
      .where('a.patientUserId = :userId', { userId });
    if (upcoming) {
      qb.andWhere('a.status IN (:...active)', { active: [...ACTIVE_STATUSES] })
        .andWhere('a.endsAt > :now', { now })
        .orderBy('a.startsAt', 'ASC');
    } else {
      qb.andWhere('(a.status NOT IN (:...active) OR a.endsAt <= :now)', {
        active: [...ACTIVE_STATUSES],
        now,
      }).orderBy('a.startsAt', 'DESC');
    }
    const [rows, total] = await qb
      .addOrderBy('a.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(await this.patientViews(rows, now), total, q);
  }
}
