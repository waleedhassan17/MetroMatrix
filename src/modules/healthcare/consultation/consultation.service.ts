import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Appointment } from '../appointments/entities/appointment.entity';
import { AppointmentTransitionsService } from '../appointments/appointment-transitions.service';
import {
  AppointmentViewsService,
  notFound,
  videoJoinState,
} from '../appointments/appointment-views.service';
import { DoctorAppointmentQueryDto } from '../appointments/dto/appointment.dto';
import { allowedMoves } from '../appointments/appointment-status';
import { MedicalNote } from './entities/medical-note.entity';
import { NotesDto, PatientQueryDto } from './dto/consultation.dto';
import { HealthEvents } from '../common/health-events';
import { localDayBounds, todayIn, toZonedIso } from '../common/time.util';
import { invalidTransition } from '../../../common/state/transitions';
import { ErrorCode } from '../../../common/errors/codes';
import { paged, likeEscape } from '../../../common/pagination/pagination';
import { SqlParams } from '../../../common/utils/sql-params';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { MediaService } from '../../media/media.service';

const MIN = 60_000;
/** A doctor may mark a no-show only this long after the start. */
export const NO_SHOW_AFTER_MS = 15 * MIN;
const STATUS_RANK = `CASE a.status WHEN 'in_consultation' THEN 0 WHEN 'checked_in' THEN 1 WHEN 'booked' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END`;

/** The person an appointment is for: the family member, else the booking account. */
export const personKeyOf = (a: {
  familyMemberId: string | null;
  patientUserId: string;
}) => a.familyMemberId ?? a.patientUserId;
const PERSON_SQL = `coalesce(a.family_member_id, a.patient_user_id)`;

/**
 * The doctor's day: queue, visit flow, private notes and patient history.
 *
 * PHI rule: a doctor reaches a patient's identity, history, notes or shared
 * records only through an appointment between them — otherwise 404 — and
 * every such read writes a `phi.read` audit event.
 */
@Injectable()
export class ConsultationService {
  /** Filled in by records (P5): records the patient shared on this appointment. */
  sharedRecords: (appointmentId: string) => Promise<unknown[]> = async () => [];

  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: AppointmentTransitionsService,
    private readonly views: AppointmentViewsService,
    private readonly events: HealthEvents,
    private readonly audit: OperationalAuditService,
    private readonly media: MediaService,
  ) {}

  phiRead(
    doctorUserId: string,
    what: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown> = {},
  ) {
    return this.audit.record({
      actorUserId: doctorUserId,
      action: 'phi.read',
      targetType,
      targetId,
      details: { what, ...details },
    });
  }

  // ── Views ─────────────────────────────────────────────────────────────────

  /** History counts for flags: with THIS doctor only (other doctors' care is not shared). */
  private async flags(doctorId: string, rows: Appointment[]) {
    const keys = [...new Set(rows.map(personKeyOf))];
    if (!keys.length)
      return new Map<
        string,
        { completed: number; lateCancels: number; noShows: number }
      >();
    const stats: Array<{
      person: string;
      completed: number;
      late: number;
      no_shows: number;
    }> = await this.dataSource.query(
      `SELECT ${PERSON_SQL} AS person,
              count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
              count(*) FILTER (WHERE a.late_cancel)::int AS late,
              count(*) FILTER (WHERE a.status = 'no_show')::int AS no_shows
         FROM appointments a WHERE a.doctor_id = $1 AND ${PERSON_SQL} = ANY($2::uuid[])
        GROUP BY 1`,
      [doctorId, keys],
    );
    return new Map(
      stats.map((s) => [
        s.person,
        { completed: s.completed, lateCancels: s.late, noShows: s.no_shows },
      ]),
    );
  }

  private async doctorViews(
    doctorId: string,
    rows: Appointment[],
    now = new Date(),
  ) {
    if (!rows.length) return [];
    const [b, flags] = await Promise.all([
      this.views.briefs(
        [doctorId],
        [...new Set(rows.map((r) => r.locationId))],
      ),
      this.flags(doctorId, rows),
    ]);
    return rows.map((a) => {
      const loc = b.location.get(a.locationId)!;
      const f = flags.get(personKeyOf(a)) ?? {
        completed: 0,
        lateCancels: 0,
        noShows: 0,
      };
      const firstVisit =
        f.completed === 0 || (a.status === 'completed' && f.completed === 1);
      const waitingMinutes =
        a.status === 'checked_in' && a.checkedInAt
          ? Math.max(
              0,
              Math.floor(
                (now.getTime() -
                  Math.max(a.checkedInAt.getTime(), a.startsAt.getTime())) /
                  MIN,
              ),
            )
          : null;
      const moves = allowedMoves(a.status, 'doctor', a.kind);
      return {
        ...this.views.core(a, loc.timezone),
        patientKey: personKeyOf(a),
        location: {
          id: loc.id,
          kind: loc.kind,
          name: loc.name,
          area: loc.area,
          timezone: loc.timezone,
        },
        waitingMinutes,
        flags: { firstVisit, lateCancels: f.lateCancels, noShows: f.noShows },
        can: {
          checkIn: moves.includes('checked_in'),
          start: moves.includes('in_consultation'),
          complete: moves.includes('completed'),
          noShow:
            moves.includes('no_show') &&
            now.getTime() >= a.startsAt.getTime() + NO_SHOW_AFTER_MS,
          cancel: moves.includes('cancelled'),
          writePrescription:
            a.status === 'in_consultation' ||
            (a.status === 'completed' &&
              !!a.completedAt &&
              now.getTime() - a.completedAt.getTime() <= 24 * 60 * MIN),
          joinVideo: videoJoinState(a, now) === 'ok',
        },
      };
    });
  }

  /** Today's queue across locations (each location's own day), in visit order. */
  async today(doctorId: string, now = new Date()) {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT a.id FROM appointments a JOIN practice_locations l ON l.id = a.location_id
        WHERE a.doctor_id = $1 AND a.status <> 'cancelled'
          AND (a.starts_at AT TIME ZONE l.timezone)::date = ($2::timestamptz AT TIME ZONE l.timezone)::date
        ORDER BY ${STATUS_RANK}, coalesce(a.checked_in_at, a.starts_at), a.starts_at, a.id`,
      [doctorId, now],
    );
    const loaded = await this.load(rows.map((r) => r.id));
    const queue = await this.doctorViews(doctorId, loaded, now);
    return {
      date: todayIn('Asia/Karachi', now),
      counts: {
        total: queue.length,
        waiting: queue.filter((q) => q.status === 'checked_in').length,
        inConsultation: queue.filter((q) => q.status === 'in_consultation')
          .length,
        remaining: queue.filter((q) => q.status === 'booked').length,
        done: queue.filter((q) => q.status === 'completed').length,
      },
      queue,
    };
  }

  async list(doctorId: string, q: DoctorAppointmentQueryDto) {
    const params = new SqlParams();
    const where = [`a.doctor_id = ${params.add(doctorId)}`];
    if (q.date) {
      const { start, end } = localDayBounds(
        q.date.slice(0, 10),
        'Asia/Karachi',
      );
      where.push(
        `a.starts_at >= ${params.add(start)} AND a.starts_at < ${params.add(end)}`,
      );
    }
    if (q.from) where.push(`a.starts_at >= ${params.add(new Date(q.from))}`);
    if (q.to) where.push(`a.starts_at < ${params.add(new Date(q.to))}`);
    if (q.status) where.push(`a.status = ${params.add(q.status)}`);
    if (q.locationId) where.push(`a.location_id = ${params.add(q.locationId)}`);
    const whereSql = where.join(' AND ');
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM appointments a WHERE ${whereSql}`,
      params.values,
    );
    const ids: Array<{ id: string }> = await this.dataSource.query(
      `SELECT a.id FROM appointments a WHERE ${whereSql} ORDER BY a.starts_at, a.id
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    return paged(
      await this.doctorViews(doctorId, await this.load(ids.map((r) => r.id))),
      total,
      q,
    );
  }

  /** One appointment with the patient's history WITH THIS DOCTOR and shared records. Audited. */
  async detail(doctorId: string, doctorUserId: string, code: string) {
    const a = await this.dataSource.manager.findOne(Appointment, {
      where: { code: code.toUpperCase(), doctorId },
    });
    if (!a) throw notFound();
    const [view] = await this.doctorViews(doctorId, [a]);
    const [history, events, shared] = await Promise.all([
      this.history(doctorId, personKeyOf(a), a.id),
      this.views.events([a.id]),
      this.sharedRecords(a.id),
    ]);
    await this.phiRead(doctorUserId, 'appointment', 'appointment', a.id, {
      code: a.code,
      patientKey: personKeyOf(a),
    });
    return {
      ...view,
      events: (events.get(a.id) ?? []).map((e) => ({
        kind: e.kind,
        from: e.from,
        to: e.to,
        actorRole: e.actorRole,
        note: e.note,
        at: toZonedIso(e.at, view.location.timezone),
      })),
      history,
      sharedRecords: shared,
    };
  }

  private async history(
    doctorId: string,
    personKey: string,
    exceptId: string | null,
  ) {
    const [visits, prescriptions] = await Promise.all([
      this.dataSource.query(
        `SELECT a.code, a.starts_at, a.status, a.kind, a.reason, l.timezone
           FROM appointments a JOIN practice_locations l ON l.id = a.location_id
          WHERE a.doctor_id = $1 AND ${PERSON_SQL} = $2 AND ($3::uuid IS NULL OR a.id <> $3)
          ORDER BY a.starts_at DESC LIMIT 50`,
        [doctorId, personKey, exceptId],
      ),
      this.dataSource.query(
        `SELECT p.id, p.issued_at, p.diagnosis, a.code AS appointment_code
           FROM prescriptions p JOIN appointments a ON a.id = p.appointment_id
          WHERE p.doctor_id = $1 AND coalesce(p.family_member_id, p.patient_user_id) = $2
          ORDER BY p.issued_at DESC LIMIT 50`,
        [doctorId, personKey],
      ),
    ]);
    return {
      previousAppointments: visits.map((v: any) => ({
        code: v.code,
        startsAt: toZonedIso(v.starts_at, v.timezone),
        status: v.status,
        kind: v.kind,
        reason: v.reason,
      })),
      prescriptions: prescriptions.map((p: any) => ({
        id: p.id,
        issuedAt: p.issued_at,
        diagnosis: p.diagnosis,
        appointmentCode: p.appointment_code,
      })),
    };
  }

  private async load(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.dataSource.manager.findBy(Appointment, {
      id: In(ids),
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)!);
  }

  // ── Visit flow ───────────────────────────────────────────────────────────

  private async act(
    doctorId: string,
    doctorUserId: string,
    code: string,
    work: (m: EntityManager, a: Appointment) => Promise<void>,
  ) {
    let doctorChanged = false;
    await this.dataSource.transaction(async (m) => {
      const a = await this.transitions.lock(m, { code, doctorId });
      const before = a.status;
      await work(m, a);
      doctorChanged = before !== a.status;
    });
    if (doctorChanged) await this.events.availabilityChanged(doctorId);
    const a = await this.dataSource.manager.findOneByOrFail(Appointment, {
      code: code.toUpperCase(),
      doctorId,
    });
    return (await this.doctorViews(doctorId, [a]))[0];
  }

  checkIn(doctorId: string, doctorUserId: string, code: string) {
    return this.act(doctorId, doctorUserId, code, (m, a) =>
      this.transitions.moveStatus(
        m,
        a,
        'checked_in',
        { role: 'doctor', userId: doctorUserId },
        {
          message:
            a.kind === 'video'
              ? 'Video consultations have no check-in — start the call.'
              : undefined,
        },
      ),
    );
  }

  start(doctorId: string, doctorUserId: string, code: string) {
    return this.act(doctorId, doctorUserId, code, (m, a) =>
      this.transitions.moveStatus(
        m,
        a,
        'in_consultation',
        { role: 'doctor', userId: doctorUserId },
        {
          message:
            a.kind === 'clinic' && a.status === 'booked'
              ? 'Check the patient in first.'
              : undefined,
        },
      ),
    );
  }

  /** in_consultation → completed; pay-at-clinic with paymentCollected → paid. */
  complete(
    doctorId: string,
    doctorUserId: string,
    code: string,
    paymentCollected: boolean,
  ) {
    return this.act(doctorId, doctorUserId, code, async (m, a) => {
      const actor = { role: 'doctor' as const, userId: doctorUserId };
      await this.transitions.moveStatus(m, a, 'completed', actor);
      if (
        paymentCollected &&
        (a.paymentStatus === 'unpaid' ||
          a.paymentStatus === 'awaiting_transfer' ||
          a.paymentStatus === 'proof_submitted')
      ) {
        await this.transitions.movePayment(m, a, 'paid', actor, {
          note: 'Collected at the visit',
        });
      }
    });
  }

  /** booked → no_show, from 15 minutes after the start. */
  noShow(
    doctorId: string,
    doctorUserId: string,
    code: string,
    now = new Date(),
  ) {
    return this.act(doctorId, doctorUserId, code, async (m, a) => {
      if (
        a.status === 'booked' &&
        now.getTime() < a.startsAt.getTime() + NO_SHOW_AFTER_MS
      ) {
        throw invalidTransition(
          a.status,
          'no_show',
          [],
          'A no-show can be marked from 15 minutes after the start.',
        );
      }
      await this.transitions.moveStatus(m, a, 'no_show', {
        role: 'doctor',
        userId: doctorUserId,
      });
    });
  }

  // ── Private notes ────────────────────────────────────────────────────────

  async notes(doctorId: string, doctorUserId: string, code: string) {
    const a = await this.dataSource.manager.findOne(Appointment, {
      where: { code: code.toUpperCase(), doctorId },
    });
    if (!a) throw notFound();
    const note = await this.dataSource.manager.findOne(MedicalNote, {
      where: { appointmentId: a.id },
    });
    await this.phiRead(doctorUserId, 'notes', 'appointment', a.id, {
      code: a.code,
    });
    return {
      appointmentCode: a.code,
      text: note?.text ?? '',
      files: note?.files ?? [],
      updatedAt: note?.updatedAt ?? null,
    };
  }

  async saveNotes(
    doctorId: string,
    doctorUserId: string,
    code: string,
    dto: NotesDto,
  ) {
    const a = await this.dataSource.manager.findOne(Appointment, {
      where: { code: code.toUpperCase(), doctorId },
    });
    if (!a) throw notFound();
    if (a.status === 'cancelled') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'This appointment was cancelled.',
      });
    }
    const files = (dto.files ?? []).map((f, i) => {
      this.media.assertOwnedAsset(
        doctorUserId,
        'medical_note',
        f.url,
        f.publicId,
        `files.${i}`,
      );
      return { url: f.url, publicId: f.publicId, mime: f.mime ?? null };
    });
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(MedicalNote)
      .values({ appointmentId: a.id, doctorId, text: dto.text, files })
      .orUpdate(['text', 'files', 'updated_at'], ['appointment_id'])
      .execute();
    return this.notes(doctorId, doctorUserId, code);
  }

  // ── Patients ─────────────────────────────────────────────────────────────

  /** People with at least one appointment with this doctor. */
  async patients(doctorId: string, q: PatientQueryDto) {
    const params = new SqlParams();
    const where = [`a.doctor_id = ${params.add(doctorId)}`];
    if (q.q) {
      const like = params.add(`%${likeEscape(q.q)}%`);
      where.push(
        `(a.patient_snapshot->>'name' ILIKE ${like} OR a.patient_snapshot->>'phone' ILIKE ${like})`,
      );
    }
    const base = `SELECT ${PERSON_SQL} AS person_key, (array_agg(a.patient_snapshot ORDER BY a.starts_at DESC))[1] AS snapshot,
                         count(*)::int AS visits, count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
                         max(a.starts_at) AS last_at
                    FROM appointments a WHERE ${where.join(' AND ')} GROUP BY 1`;
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM (${base}) x`,
      params.values,
    );
    const rows = await this.dataSource.query(
      `${base} ORDER BY last_at DESC, person_key LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    return paged(
      rows.map((r: any) => ({
        patientKey: r.person_key,
        name: r.snapshot?.name,
        gender: r.snapshot?.gender ?? null,
        age: r.snapshot?.age ?? null,
        phone: r.snapshot?.phone ?? null,
        relation: r.snapshot?.relation ?? null,
        visits: r.visits,
        completedVisits: r.completed,
        lastVisitAt: r.last_at,
      })),
      total,
      q,
    );
  }

  /** History with this doctor only; no appointment between them → 404. Audited. */
  async patient(doctorId: string, doctorUserId: string, patientKey: string) {
    const [row] = await this.dataSource.query(
      `SELECT (array_agg(a.patient_snapshot ORDER BY a.starts_at DESC))[1] AS snapshot, count(*)::int AS visits
         FROM appointments a WHERE a.doctor_id = $1 AND ${PERSON_SQL} = $2 HAVING count(*) > 0`,
      [doctorId, patientKey],
    );
    if (!row)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Patient not found.',
      });
    await this.phiRead(doctorUserId, 'patient_history', 'patient', patientKey);
    return {
      patientKey,
      name: row.snapshot?.name,
      gender: row.snapshot?.gender ?? null,
      age: row.snapshot?.age ?? null,
      phone: row.snapshot?.phone ?? null,
      relation: row.snapshot?.relation ?? null,
      visits: row.visits,
      ...(await this.history(doctorId, patientKey, null)),
    };
  }
}
