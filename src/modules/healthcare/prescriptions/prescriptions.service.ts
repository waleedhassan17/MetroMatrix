import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  Prescription,
  PrescriptionMedicine,
  PrescriptionTest,
} from './entities/prescription.entity';
import { WritePrescriptionDto } from './dto/prescription.dto';
import { Appointment } from '../appointments/entities/appointment.entity';
import { AppointmentTransitionsService } from '../appointments/appointment-transitions.service';
import { ConsultationService } from '../consultation/consultation.service';
import { TITLE_PREFIX } from '../discovery/discovery.service';
import { TRIGRAM_MIN } from '../reference/reference.service';
import { addDays, localDate, toZonedIso } from '../common/time.util';
import { ErrorCode } from '../../../common/errors/codes';
import {
  likeEscape,
  paged,
  PaginationQueryDto,
} from '../../../common/pagination/pagination';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { NotificationsService } from '../../notifications/notifications.service';

/** A prescription can be replaced until this long after the visit is completed. */
export const PRESCRIPTION_EDIT_MS = 24 * 60 * 60_000;

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Prescription not found.',
  });

const favouriteKey = (m: {
  name: string;
  strength?: string | null;
  form: string;
}) => `${m.name.trim().toLowerCase()}|${(m.strength ?? '').trim()}|${m.form}`;

/**
 * Prescriptions (A4): readable by their patient and their prescribing doctor —
 * anyone else gets 404. Written from in_consultation until 24 h after completion.
 */
@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: AppointmentTransitionsService,
    private readonly consultation: ConsultationService,
    private readonly audit: OperationalAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Why the writer is closed for this appointment, or null when it is open. */
  static lockReason(
    a: Pick<Appointment, 'status' | 'completedAt'>,
    now = new Date(),
  ) {
    if (a.status === 'in_consultation') return null;
    if (
      a.status === 'completed' &&
      a.completedAt &&
      now.getTime() - a.completedAt.getTime() <= PRESCRIPTION_EDIT_MS
    )
      return null;
    return a.status === 'completed' ? 'window_closed' : 'not_in_consultation';
  }

  async write(
    doctorId: string,
    doctorUserId: string,
    code: string,
    dto: WritePrescriptionDto,
    now = new Date(),
  ) {
    const { id, patientUserId, created } = await this.dataSource.transaction(
      async (m) => {
        const a = await this.transitions.lock(m, { code, doctorId });
        const reason = PrescriptionsService.lockReason(a, now);
        if (reason) {
          throw new ConflictException({
            code: ErrorCode.PRESCRIPTION_LOCKED,
            message:
              reason === 'window_closed'
                ? 'Prescriptions can be changed only until 24 hours after the visit.'
                : 'Start the consultation before writing a prescription.',
            details: { reason, status: a.status },
          });
        }
        const existing = await m.findOne(Prescription, {
          where: { appointmentId: a.id },
        });
        const previous = existing
          ? await m.find(PrescriptionMedicine, {
              where: { prescriptionId: existing.id },
            })
          : [];
        const header = {
          diagnosis: dto.diagnosis,
          advice: dto.advice ?? null,
          followUpInDays: dto.followUpInDays ?? null,
        };
        let p: Prescription;
        if (existing) {
          await m.update(Prescription, { id: existing.id }, header);
          await m.delete(PrescriptionMedicine, { prescriptionId: existing.id });
          await m.delete(PrescriptionTest, { prescriptionId: existing.id });
          p = existing;
        } else {
          p = await m.save(
            m.create(Prescription, {
              ...header,
              appointmentId: a.id,
              doctorId,
              patientUserId: a.patientUserId,
              familyMemberId: a.familyMemberId,
              issuedAt: now,
            }),
          );
        }
        if (dto.medicines.length) {
          await m.insert(
            PrescriptionMedicine,
            dto.medicines.map((x, i) => ({
              prescriptionId: p.id,
              name: x.name,
              strength: x.strength ?? null,
              form: x.form,
              dosePattern: x.dosePattern,
              timing: x.timing,
              durationDays: x.durationDays ?? null,
              instructions: x.instructions ?? null,
              sort: i,
            })),
          );
        }
        if (dto.tests?.length) {
          await m.insert(
            PrescriptionTest,
            dto.tests.map((t, i) => ({
              prescriptionId: p.id,
              name: t.name,
              instructions: t.instructions ?? null,
              sort: i,
            })),
          );
        }
        await this.rememberFavourites(
          m,
          doctorId,
          dto,
          new Set(previous.map(favouriteKey)),
        );
        await this.transitions.note(
          m,
          a.id,
          { role: 'doctor', userId: doctorUserId },
          existing ? 'Prescription updated' : 'Prescription issued',
        );
        return { id: p.id, patientUserId: a.patientUserId, created: !existing };
      },
    );
    await this.audit.record({
      actorUserId: doctorUserId,
      action: created
        ? 'health.prescription.issue'
        : 'health.prescription.update',
      targetType: 'prescription',
      targetId: id,
      details: { code },
    });
    try {
      await this.notifications.notify(patientUserId, {
        type: 'health.prescription',
        title: created
          ? 'Your prescription is ready'
          : 'Your prescription was updated',
        body: `Open appointment ${code.toUpperCase()} to see it.`,
        data: { prescriptionId: id, appointmentCode: code.toUpperCase() },
      });
    } catch (err) {
      this.logger.warn(`notification failed: ${(err as Error).message}`);
    }
    return (
      await this.views(
        [await this.dataSource.manager.findOneByOrFail(Prescription, { id })],
        now,
      )
    )[0];
  }

  /** Upsert the doctor's shortcuts: latest dose and timing win; only new lines count as a use. */
  private async rememberFavourites(
    m: EntityManager,
    doctorId: string,
    dto: WritePrescriptionDto,
    already: Set<string>,
  ) {
    const unique = new Map(dto.medicines.map((x) => [favouriteKey(x), x]));
    for (const [key, x] of unique) {
      await m.query(
        `INSERT INTO doctor_medicine_favourites (doctor_id, name, strength, form, dose_pattern, timing, use_count)
         VALUES ($1, $2, $3, $4, $5, $6, 1)
         ON CONFLICT (doctor_id, lower(name), coalesce(strength, ''), form)
         DO UPDATE SET dose_pattern = EXCLUDED.dose_pattern, timing = EXCLUDED.timing,
                       use_count = doctor_medicine_favourites.use_count + $7, updated_at = now()`,
        [
          doctorId,
          x.name,
          x.strength ?? null,
          x.form,
          x.dosePattern,
          x.timing,
          already.has(key) ? 0 : 1,
        ],
      );
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async views(rows: Prescription[], now = new Date()) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [medicines, tests, appts] = await Promise.all([
      this.dataSource.manager.find(PrescriptionMedicine, {
        where: { prescriptionId: In(ids) },
        order: { sort: 'ASC' },
      }),
      this.dataSource.manager.find(PrescriptionTest, {
        where: { prescriptionId: In(ids) },
        order: { sort: 'ASC' },
      }),
      this.dataSource.manager.find(Appointment, {
        where: { id: In(rows.map((r) => r.appointmentId)) },
      }),
    ]);
    const doctorIds = [...new Set(rows.map((r) => r.doctorId))];
    const [doctors, quals, locations] = await Promise.all([
      this.dataSource.query(
        `SELECT d.id, d.title, d.full_name, d.photo_url, b.pmdc_number, s.name AS specialty
           FROM doctors d JOIN businesses b ON b.id = d.business_id
           LEFT JOIN specialties s ON s.id = d.primary_specialty_id WHERE d.id = ANY($1::uuid[])`,
        [doctorIds],
      ),
      this.dataSource.query(
        `SELECT doctor_id, degree FROM doctor_qualifications WHERE doctor_id = ANY($1::uuid[]) ORDER BY doctor_id, sort`,
        [doctorIds],
      ),
      this.dataSource.query(
        `SELECT id, kind, name, address_line, area, city, phone, timezone FROM practice_locations WHERE id = ANY($1::uuid[])`,
        [[...new Set(appts.map((a) => a.locationId))]],
      ),
    ]);
    const apptById = new Map(appts.map((a) => [a.id, a]));
    const docById = new Map(doctors.map((d: any) => [d.id, d]));
    const locById = new Map(locations.map((l: any) => [l.id, l]));
    const degrees = new Map<string, string[]>();
    quals.forEach((q: any) =>
      degrees.set(q.doctor_id, [...(degrees.get(q.doctor_id) ?? []), q.degree]),
    );
    return rows.map((p) => {
      const a = apptById.get(p.appointmentId)!;
      const d: any = docById.get(p.doctorId);
      const l: any = locById.get(a.locationId);
      const tz: string = l?.timezone ?? 'Asia/Karachi';
      const lockedAt = a.completedAt
        ? new Date(a.completedAt.getTime() + PRESCRIPTION_EDIT_MS)
        : null;
      const visitDate = localDate(a.startsAt, tz);
      return {
        id: p.id,
        appointmentCode: a.code,
        appointmentKind: a.kind,
        visitDate,
        issuedAt: toZonedIso(p.issuedAt, tz),
        updatedAt: toZonedIso(p.updatedAt, tz),
        editableUntil: lockedAt ? toZonedIso(lockedAt, tz) : null,
        locked: PrescriptionsService.lockReason(a, now) !== null,
        doctor: {
          id: d.id,
          displayName: `${TITLE_PREFIX[d.title] ?? 'Dr.'} ${d.full_name}`,
          qualifications: (degrees.get(d.id) ?? []).join(', '),
          pmdcNumber: d.pmdc_number,
          specialty: d.specialty,
          photoUrl: d.photo_url,
        },
        location: l
          ? {
              id: l.id,
              kind: l.kind,
              name: l.name,
              addressLine: l.address_line,
              area: l.area,
              city: l.city,
              phone: l.phone,
            }
          : null,
        patient: a.patientSnapshot,
        familyMemberId: p.familyMemberId,
        diagnosis: p.diagnosis,
        advice: p.advice,
        followUpInDays: p.followUpInDays,
        followUpOn: p.followUpInDays
          ? addDays(visitDate, p.followUpInDays)
          : null,
        medicines: medicines
          .filter((x) => x.prescriptionId === p.id)
          .map((x) => ({
            name: x.name,
            strength: x.strength,
            form: x.form,
            dosePattern: x.dosePattern,
            timing: x.timing,
            durationDays: x.durationDays,
            instructions: x.instructions,
          })),
        tests: tests
          .filter((t) => t.prescriptionId === p.id)
          .map((t) => ({ name: t.name, instructions: t.instructions })),
      };
    });
  }

  /** The patient's own prescriptions (every person on the account), newest first. */
  async patientList(
    userId: string,
    q: PaginationQueryDto & { familyMemberId?: string },
  ) {
    const where: Record<string, unknown> = { patientUserId: userId };
    if (q.familyMemberId) where.familyMemberId = q.familyMemberId;
    const [rows, total] = await this.dataSource.manager.findAndCount(
      Prescription,
      {
        where,
        order: { issuedAt: 'DESC', id: 'ASC' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      },
    );
    return paged(await this.views(rows), total, q);
  }

  async forPatient(userId: string, id: string) {
    const p = await this.dataSource.manager.findOne(Prescription, {
      where: { id, patientUserId: userId },
    });
    if (!p) throw notFound();
    return (await this.views([p]))[0];
  }

  /** The prescribing doctor only (A4); any other doctor gets 404. Audited. */
  async forDoctor(doctorId: string, doctorUserId: string, id: string) {
    const p = await this.dataSource.manager.findOne(Prescription, {
      where: { id, doctorId },
    });
    if (!p) throw notFound();
    await this.consultation.phiRead(
      doctorUserId,
      'prescription',
      'prescription',
      p.id,
    );
    return (await this.views([p]))[0];
  }

  /** The prescription on one of this doctor's appointments, or null. */
  async forAppointment(doctorId: string, doctorUserId: string, code: string) {
    const a = await this.dataSource.manager.findOne(Appointment, {
      where: { code: code.toUpperCase(), doctorId },
    });
    if (!a)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Appointment not found.',
      });
    const p = await this.dataSource.manager.findOne(Prescription, {
      where: { appointmentId: a.id },
    });
    if (!p)
      return {
        prescription: null,
        locked: PrescriptionsService.lockReason(a) !== null,
      };
    await this.consultation.phiRead(
      doctorUserId,
      'prescription',
      'prescription',
      p.id,
    );
    const [view] = await this.views([p]);
    return { prescription: view, locked: view.locked };
  }

  /** The doctor's favourites first, then the reference list. */
  async suggest(doctorId: string, q: string) {
    const contains = `%${likeEscape(q)}%`;
    const prefix = `${likeEscape(q)}%`;
    const [favourites, reference] = await Promise.all([
      this.dataSource.query(
        `SELECT name, strength, form, dose_pattern, timing, use_count FROM doctor_medicine_favourites
          WHERE doctor_id = $1 AND (name ILIKE $2 OR word_similarity($3, name) >= ${TRIGRAM_MIN})
          ORDER BY (name ILIKE $4) DESC, use_count DESC, name LIMIT 8`,
        [doctorId, contains, q, prefix],
      ),
      this.dataSource.query(
        `SELECT name, strength, form FROM medicines
          WHERE name ILIKE $1 OR word_similarity($2, name) >= ${TRIGRAM_MIN}
          ORDER BY (name ILIKE $3) DESC, word_similarity($2, name) DESC, name, strength LIMIT 15`,
        [contains, q, prefix],
      ),
    ]);
    const seen = new Set<string>();
    const out: Array<Record<string, unknown>> = [];
    for (const f of favourites) {
      seen.add(favouriteKey(f));
      out.push({
        source: 'favourite',
        name: f.name,
        strength: f.strength,
        form: f.form,
        dosePattern: f.dose_pattern,
        timing: f.timing,
        useCount: f.use_count,
      });
    }
    for (const r of reference) {
      if (seen.has(favouriteKey(r))) continue;
      out.push({
        source: 'reference',
        name: r.name,
        strength: r.strength,
        form: r.form,
        dosePattern: null,
        timing: null,
        useCount: 0,
      });
    }
    return { medicines: out.slice(0, 15) };
  }
}
