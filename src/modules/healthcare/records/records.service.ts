import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { HealthRecord, RecordFile } from './entities/health-record.entity';
import { AppointmentAttachment } from './entities/appointment-attachment.entity';
import {
  AttachRecordsDto,
  CreateRecordDto,
  RecordQueryDto,
  UpdateRecordDto,
} from './dto/record.dto';
import { Appointment } from '../appointments/entities/appointment.entity';
import { ACTIVE_STATUSES } from '../appointments/appointment-status';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentViewsService } from '../appointments/appointment-views.service';
import { ConsultationService } from '../consultation/consultation.service';
import { FamilyService } from '../family/family.service';
import { MediaService } from '../../media/media.service';
import { AccountService } from '../../auth/account.service';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';

export const MAX_RECORDS = 200;
export const MAX_ATTACHMENTS = 10;

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Record not found.',
  });
const appointmentNotFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Appointment not found.',
  });

/** Metadata only: what a doctor sees in the appointment before opening a file. */
const sharedView = (r: HealthRecord, attachedAt: Date) => ({
  id: r.id,
  title: r.title,
  type: r.type,
  recordDate: r.recordDate,
  notes: r.notes,
  fileCount: r.files.length,
  mimes: r.files.map((f) => f.mime),
  sharedAt: attachedAt,
});

/**
 * Patients' own medical documents, and sharing them with a visit.
 *
 * Sharing rule: a record goes only to the appointment of the person it is
 * about, only while that visit is still open (booked → in consultation),
 * and a doctor can open it only while it stays attached. Every doctor open
 * is a `phi.read`; doctors get a 10-minute download link, never the file URL.
 */
@Injectable()
export class RecordsService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly media: MediaService,
    private readonly family: FamilyService,
    private readonly appointments: AppointmentsService,
    private readonly views: AppointmentViewsService,
    private readonly consultation: ConsultationService,
    private readonly account: AccountService,
  ) {}

  onModuleInit(): void {
    this.appointments.attachRecords = (m, a, ids, userId) =>
      this.attachInTx(m, a, ids, userId);
    // A rescheduled visit keeps what was shared with the original.
    this.appointments.carryRecords = async (m, fromId, toId) => {
      await m.query(
        `INSERT INTO appointment_attachments (appointment_id, record_id)
         SELECT $2, record_id FROM appointment_attachments WHERE appointment_id = $1
         ON CONFLICT (appointment_id, record_id) DO NOTHING`,
        [fromId, toId],
      );
    };
    this.views.attachments = async (ids) => this.sharedFor(ids);
    this.consultation.sharedRecords = async (appointmentId) =>
      (await this.sharedFor([appointmentId])).get(appointmentId) ?? [];
    this.account.onAccountDeleted(async (m, user) => {
      await m.delete(HealthRecord, { userId: user.id });
    });
  }

  /** The uploader gets the URLs back, plus short-lived download links. */
  private ownerFiles(files: RecordFile[]) {
    return files.map((f) => ({ ...f, ...this.media.privateDownload(f.url) }));
  }

  private ownerView(r: HealthRecord, attachedTo: string[] = []) {
    return {
      id: r.id,
      title: r.title,
      type: r.type,
      recordDate: r.recordDate,
      notes: r.notes,
      familyMemberId: r.familyMemberId,
      files: this.ownerFiles(r.files),
      sharedWith: attachedTo,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private assertFiles(
    userId: string,
    files: Array<{ url: string; publicId: string; mime?: string }>,
  ): RecordFile[] {
    return files.map((f, i) => {
      this.media.assertOwnedAsset(
        userId,
        'health_record',
        f.url,
        f.publicId,
        `files.${i}.url`,
      );
      return { url: f.url, publicId: f.publicId, mime: f.mime ?? null };
    });
  }

  private async sharedFor(appointmentIds: string[]) {
    const out = new Map<string, ReturnType<typeof sharedView>[]>();
    if (!appointmentIds.length) return out;
    const links = await this.dataSource.manager.find(AppointmentAttachment, {
      where: { appointmentId: In(appointmentIds) },
      relations: { record: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    links.forEach((l) =>
      out.set(l.appointmentId, [
        ...(out.get(l.appointmentId) ?? []),
        sharedView(l.record!, l.createdAt),
      ]),
    );
    return out;
  }

  /** Appointment codes each record is shared with. */
  private async sharedWith(recordIds: string[]) {
    const out = new Map<string, string[]>();
    if (!recordIds.length) return out;
    const rows: Array<{ record_id: string; code: string }> =
      await this.dataSource.query(
        `SELECT t.record_id, a.code FROM appointment_attachments t JOIN appointments a ON a.id = t.appointment_id
          WHERE t.record_id = ANY($1::uuid[]) ORDER BY a.starts_at`,
        [recordIds],
      );
    rows.forEach((r) =>
      out.set(r.record_id, [...(out.get(r.record_id) ?? []), r.code]),
    );
    return out;
  }

  // ── The patient's own records ────────────────────────────────────────────

  async create(userId: string, dto: CreateRecordDto) {
    const files = this.assertFiles(userId, dto.files);
    if (dto.familyMemberId) await this.family.owned(userId, dto.familyMemberId);
    const saved = await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `records:${userId}`,
      ]);
      const n = await m.count(HealthRecord, { where: { userId } });
      if (n >= MAX_RECORDS) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: `You can keep up to ${MAX_RECORDS} records.`,
        });
      }
      return m.save(
        m.create(HealthRecord, {
          userId,
          familyMemberId: dto.familyMemberId ?? null,
          title: dto.title,
          type: dto.type,
          recordDate: dto.recordDate?.slice(0, 10) ?? null,
          notes: dto.notes ?? null,
          files,
        }),
      );
    });
    return this.ownerView(saved);
  }

  async list(userId: string, q: RecordQueryDto) {
    const qb = this.dataSource
      .getRepository(HealthRecord)
      .createQueryBuilder('r')
      .where('r.userId = :userId', { userId });
    if (q.person === 'self') qb.andWhere('r.familyMemberId IS NULL');
    else if (q.person) qb.andWhere('r.familyMemberId = :fm', { fm: q.person });
    if (q.type) qb.andWhere('r.type = :type', { type: q.type });
    const [rows, total] = await qb
      .orderBy('r.recordDate', 'DESC', 'NULLS LAST')
      .addOrderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    const shared = await this.sharedWith(rows.map((r) => r.id));
    return paged(
      rows.map((r) => this.ownerView(r, shared.get(r.id))),
      total,
      q,
    );
  }

  private async owned(userId: string, id: string) {
    const r = await this.dataSource.manager.findOne(HealthRecord, {
      where: { id, userId },
    });
    if (!r) throw notFound();
    return r;
  }

  async get(userId: string, id: string) {
    const r = await this.owned(userId, id);
    return this.ownerView(r, (await this.sharedWith([r.id])).get(r.id));
  }

  async update(userId: string, id: string, dto: UpdateRecordDto) {
    const r = await this.owned(userId, id);
    Object.assign(r, {
      title: dto.title ?? r.title,
      type: dto.type ?? r.type,
      files: dto.files ? this.assertFiles(userId, dto.files) : r.files,
      recordDate:
        dto.recordDate !== undefined
          ? (dto.recordDate?.slice(0, 10) ?? null)
          : r.recordDate,
      notes: dto.notes !== undefined ? dto.notes : r.notes,
    });
    await this.dataSource.manager.save(r);
    return this.get(userId, id);
  }

  /** Deleting a record also un-shares it from every visit. */
  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    await this.dataSource.manager.delete(HealthRecord, { id, userId });
    return { removed: true };
  }

  // ── Sharing with a visit ─────────────────────────────────────────────────

  /** Booking-time sharing (inside the booking transaction) and later sharing use one rule. */
  private async attachInTx(
    m: EntityManager,
    a: Appointment,
    recordIds: string[],
    userId: string,
  ) {
    if (!(ACTIVE_STATUSES as readonly string[]).includes(a.status)) {
      throw new ConflictException({
        code: ErrorCode.ATTACHMENTS_CLOSED,
        message: 'Records can be shared until the visit is completed.',
        details: { status: a.status },
      });
    }
    const ids = [...new Set(recordIds)];
    const records = await m.find(HealthRecord, {
      where: { id: In(ids), userId },
    });
    const missing = ids.filter((id) => !records.some((r) => r.id === id));
    if (missing.length) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Record not found.',
        details: { recordIds: missing },
      });
    }
    const otherPerson = records.filter(
      (r) => r.familyMemberId !== a.familyMemberId,
    );
    if (otherPerson.length) {
      const message =
        'Only records about the person this appointment is for can be shared.';
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message,
        details: {
          fields: { recordIds: [message] },
          recordIds: otherPerson.map((r) => r.id),
        },
      });
    }
    await m.query(
      `INSERT INTO appointment_attachments (appointment_id, record_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT (appointment_id, record_id) DO NOTHING`,
      [a.id, ids],
    );
    const [{ n }] = await m.query(
      `SELECT count(*)::int AS n FROM appointment_attachments WHERE appointment_id = $1`,
      [a.id],
    );
    if (n > MAX_ATTACHMENTS) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Share at most ${MAX_ATTACHMENTS} records with one visit.`,
        details: { limit: MAX_ATTACHMENTS },
      });
    }
  }

  async attach(userId: string, code: string, dto: AttachRecordsDto) {
    await this.dataSource.transaction(async (m) => {
      const a = await m.findOne(Appointment, {
        where: { code: code.toUpperCase(), patientUserId: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!a) throw appointmentNotFound();
      await this.attachInTx(m, a, dto.recordIds, userId);
    });
    return this.attachmentsOf(userId, code);
  }

  /** Revoking is always allowed, even after the visit. */
  async detach(userId: string, code: string, recordId: string) {
    const a = await this.dataSource.manager.findOne(Appointment, {
      where: { code: code.toUpperCase(), patientUserId: userId },
    });
    if (!a) throw appointmentNotFound();
    const res = await this.dataSource.manager.delete(AppointmentAttachment, {
      appointmentId: a.id,
      recordId,
    });
    if (!res.affected) throw notFound();
    return this.attachmentsOf(userId, code);
  }

  async attachmentsOf(userId: string, code: string) {
    const a = await this.dataSource.manager.findOne(Appointment, {
      where: { code: code.toUpperCase(), patientUserId: userId },
    });
    if (!a) throw appointmentNotFound();
    return {
      appointmentCode: a.code,
      records: (await this.sharedFor([a.id])).get(a.id) ?? [],
    };
  }

  // ── The doctor's side ────────────────────────────────────────────────────

  /** One shared record — only while attached to this doctor's appointment. Audited. */
  async forDoctor(
    doctorId: string,
    doctorUserId: string,
    code: string,
    recordId: string,
  ) {
    const [link] = await this.dataSource.query(
      `SELECT t.created_at, a.id AS appointment_id FROM appointment_attachments t
         JOIN appointments a ON a.id = t.appointment_id
        WHERE a.code = $1 AND a.doctor_id = $2 AND t.record_id = $3`,
      [code.toUpperCase(), doctorId, recordId],
    );
    if (!link) throw notFound();
    const r = await this.dataSource.manager.findOneByOrFail(HealthRecord, {
      id: recordId,
    });
    await this.consultation.phiRead(
      doctorUserId,
      'record',
      'health_record',
      r.id,
      {
        code: code.toUpperCase(),
      },
    );
    // Doctors never get the stored URLs, only expiring download links.
    return {
      ...sharedView(r, link.created_at),
      files: r.files.map((f) => ({
        mime: f.mime,
        ...this.media.privateDownload(f.url),
      })),
    };
  }
}
