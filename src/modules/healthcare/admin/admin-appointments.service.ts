import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Appointment } from '../appointments/entities/appointment.entity';
import {
  AppointmentViewsService,
  notFound,
} from '../appointments/appointment-views.service';
import { AppointmentTransitionsService } from '../appointments/appointment-transitions.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { HealthEvents } from '../common/health-events';
import { AdminAppointmentQueryDto } from './dto/admin-health.dto';
import {
  DEFAULT_TZ,
  localDayBounds,
  todayIn,
  toZonedIso,
} from '../common/time.util';
import { paged } from '../../../common/pagination/pagination';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';

/**
 * Support tools: find an appointment, read its timeline, cancel it on a
 * patient's or doctor's behalf, and a Healthcare overview. Admins see the
 * booking facts and payment trail — never notes, prescriptions or shared
 * records (those stay between patient and doctor). Reads of an appointment
 * and every cancel are audited.
 */
@Injectable()
export class AdminAppointmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly views: AppointmentViewsService,
    private readonly transitions: AppointmentTransitionsService,
    private readonly appointments: AppointmentsService,
    private readonly events: HealthEvents,
    private readonly audit: OperationalAuditService,
  ) {}

  private async adminViews(rows: Appointment[]) {
    if (!rows.length) return [];
    const b = await this.views.briefs(
      [...new Set(rows.map((r) => r.doctorId))],
      [...new Set(rows.map((r) => r.locationId))],
    );
    return rows.map((a) => {
      const loc = b.location.get(a.locationId)!;
      const doc = b.doctor.get(a.doctorId)!;
      return {
        ...this.views.core(a, loc.timezone),
        patientUserId: a.patientUserId,
        doctor: {
          id: doc.id,
          displayName: doc.displayName,
          specialty: doc.specialty,
        },
        location: {
          id: loc.id,
          kind: loc.kind,
          name: loc.name,
          city: loc.city,
          timezone: loc.timezone,
        },
      };
    });
  }

  async list(q: AdminAppointmentQueryDto) {
    const qb = this.dataSource
      .getRepository(Appointment)
      .createQueryBuilder('a');
    if (q.code) qb.andWhere('a.code = :code', { code: q.code.toUpperCase() });
    if (q.doctorId)
      qb.andWhere('a.doctorId = :doctorId', { doctorId: q.doctorId });
    if (q.patientUserId)
      qb.andWhere('a.patientUserId = :patientUserId', {
        patientUserId: q.patientUserId,
      });
    if (q.status) qb.andWhere('a.status = :status', { status: q.status });
    if (q.date) {
      const { start, end } = localDayBounds(q.date.slice(0, 10), DEFAULT_TZ);
      qb.andWhere('a.startsAt >= :start AND a.startsAt < :end', { start, end });
    }
    const [rows, total] = await qb
      .orderBy('a.startsAt', 'DESC')
      .addOrderBy('a.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(await this.adminViews(rows), total, q);
  }

  async detail(code: string) {
    const a = await this.dataSource.manager.findOne(Appointment, {
      where: { code: code.toUpperCase() },
    });
    if (!a) throw notFound();
    const [view] = await this.adminViews([a]);
    const events = (await this.views.events([a.id])).get(a.id) ?? [];
    await this.audit.record({
      action: 'health.appointment.read',
      targetType: 'appointment',
      targetId: a.id,
      details: { code: a.code },
    });
    return {
      ...view,
      events: events.map((e) => ({
        kind: e.kind,
        from: e.from,
        to: e.to,
        actorRole: e.actorRole,
        actorUserId: e.actorUserId,
        note: e.note,
        at: toZonedIso(e.at, view.location.timezone),
      })),
    };
  }

  /** Cancel on someone's behalf (booked or checked in); payment settles as for any cancel. */
  async cancel(adminUserId: string, code: string, reason: string) {
    const a = await this.dataSource.transaction(async (m) => {
      const a = await this.transitions.lock(m, { code });
      await this.transitions.moveStatus(
        m,
        a,
        'cancelled',
        { role: 'admin', userId: adminUserId },
        { note: reason, patch: { cancelledBy: 'admin', cancelReason: reason } },
      );
      return a;
    });
    await this.events.availabilityChanged(a.doctorId);
    await this.audit.record({
      actorUserId: adminUserId,
      action: 'health.appointment.cancel',
      targetType: 'appointment',
      targetId: a.id,
      details: { code: a.code, reason },
    });
    await this.appointments.notifyAdminCancel(a, reason);
    return this.detail(code);
  }

  async overview(now = new Date()) {
    const today = todayIn(DEFAULT_TZ, now);
    const { start, end } = localDayBounds(today, DEFAULT_TZ);
    const [
      [doctors],
      byStatus,
      [week],
      [reviews],
      [checks],
      topSpecialties,
      listedBySpecialty,
      [day],
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT count(*) FILTER (WHERE d.is_listed AND b.status = 'approved')::int AS listed,
                  count(*) FILTER (WHERE d.pmdc_verified_at IS NULL AND b.status = 'pending_approval')::int AS awaiting_pmdc,
                  count(*) FILTER (WHERE d.unlisted_reason IS NOT NULL)::int AS unlisted_by_admin,
                  count(*)::int AS total
             FROM doctors d JOIN businesses b ON b.id = d.business_id`,
      ),
      this.dataSource.query(
        `SELECT status, count(*)::int AS n FROM appointments
            WHERE starts_at >= $1 AND starts_at < $2 GROUP BY status`,
        [start, end],
      ),
      this.dataSource.query(
        `SELECT count(*)::int AS booked,
                  count(*) FILTER (WHERE status = 'completed')::int AS completed,
                  count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
                  count(*) FILTER (WHERE status = 'no_show')::int AS no_show,
                  count(*) FILTER (WHERE kind = 'video')::int AS video
             FROM appointments WHERE created_at > $1::timestamptz - interval '7 days'`,
        [now],
      ),
      this.dataSource.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE hidden_at IS NOT NULL)::int AS hidden,
                  count(*) FILTER (WHERE created_at > $1::timestamptz - interval '7 days')::int AS last_7d
             FROM doctor_reviews`,
        [now],
      ),
      this.dataSource.query(
        `SELECT count(*)::int AS last_24h, count(*) FILTER (WHERE emergency)::int AS emergencies_24h
             FROM symptom_checks WHERE created_at > $1::timestamptz - interval '24 hours'`,
        [now],
      ),
      this.dataSource.query(
        `SELECT s.slug, s.name, count(*)::int AS bookings FROM appointments a
             JOIN doctors d ON d.id = a.doctor_id JOIN specialties s ON s.id = d.primary_specialty_id
            WHERE a.created_at > $1::timestamptz - interval '30 days'
            GROUP BY s.slug, s.name ORDER BY bookings DESC, s.name LIMIT 5`,
        [now],
      ),
      this.dataSource.query(
        `SELECT s.slug, s.name, count(*)::int AS doctors
             FROM doctors d JOIN businesses b ON b.id = d.business_id
             JOIN specialties s ON s.id = d.primary_specialty_id
            WHERE d.is_listed AND b.status = 'approved'
            GROUP BY s.slug, s.name ORDER BY doctors DESC, s.name`,
      ),
      this.dataSource.query(
        `SELECT count(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::int AS new_bookings,
                  count(*) FILTER (WHERE cancelled_at >= $1 AND cancelled_at < $2)::int AS cancellations,
                  count(*) FILTER (WHERE status = 'no_show' AND starts_at >= $1 AND starts_at < $2)::int AS no_shows
             FROM appointments`,
        [start, end],
      ),
    ]);
    return {
      date: today,
      doctors: {
        total: doctors.total,
        listed: doctors.listed,
        awaitingPmdc: doctors.awaiting_pmdc,
        unlistedByAdmin: doctors.unlisted_by_admin,
      },
      listedBySpecialty,
      today: {
        newBookings: day.new_bookings,
        cancellations: day.cancellations,
        noShows: day.no_shows,
        appointmentsByStatus: Object.fromEntries(
          byStatus.map((r: any) => [r.status, r.n]),
        ),
      },
      last7Days: {
        booked: week.booked,
        completed: week.completed,
        cancelled: week.cancelled,
        noShow: week.no_show,
        video: week.video,
      },
      reviews: {
        total: reviews.total,
        hidden: reviews.hidden,
        last7Days: reviews.last_7d,
      },
      symptomChecks: {
        last24h: checks.last_24h,
        emergencies24h: checks.emergencies_24h,
      },
      topSpecialties30d: topSpecialties,
    };
  }
}
