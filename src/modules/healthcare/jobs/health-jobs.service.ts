import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { Appointment } from '../appointments/entities/appointment.entity';
import {
  AppointmentTransitionsService,
  SYSTEM,
} from '../appointments/appointment-transitions.service';
import { AvailabilityService } from '../availability/availability.service';
import { HealthEvents } from '../common/health-events';
import {
  NotificationsService,
  NotifyPayload,
} from '../../notifications/notifications.service';
import { formatTime12 } from '../common/time.util';

const BATCH = 200;
const UNPAID_REASON = 'The video consultation fee was not received in time.';
type Notice = { userId: string; payload: NotifyPayload };

/**
 * Healthcare's scheduled work, on the same rules as Shopping's: a
 * transaction-scoped advisory lock per job (a second dyno skips),
 * conditional updates through the transitions service (a second run finds
 * nothing), notifications after commit, counts logged. Each job is also a
 * plain method that tests and ops call directly.
 */
@Injectable()
export class HealthJobsService {
  private readonly logger = new Logger(HealthJobsService.name);
  /** Filled in by reviews/aggregates (P5) and the symptom checker (P6). */
  nightly: Array<
    (m: EntityManager, now: Date) => Promise<Record<string, number>>
  > = [];

  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: AppointmentTransitionsService,
    private readonly availability: AvailabilityService,
    private readonly events: HealthEvents,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<boolean>('jobs.enabled') ?? true;
  }

  @Cron('*/5 * * * *', { name: 'health-every-5-min' })
  async cronFive() {
    if (!this.enabled) return;
    await this.cancelUnpaidPrepay();
    await this.autoNoShow();
    await this.reminders();
  }

  @Cron('*/15 * * * *', { name: 'health-every-15-min' })
  async cronFifteen() {
    if (!this.enabled) return;
    await this.refreshNextAvailable();
    await this.doctorDigest();
  }

  @Cron('0 2 * * *', { name: 'health-nightly', timeZone: 'Asia/Karachi' })
  async cronNightly() {
    if (this.enabled) await this.nightlyRun();
  }

  /** Prepaid video appointments still awaiting transfer at pay_by: cancelled, slot freed, both told. */
  async cancelUnpaidPrepay(now = new Date()) {
    const doctors = new Set<string>();
    const result = await this.run('health:cancel-unpaid', async (m) => {
      const due = await m
        .createQueryBuilder(Appointment, 'a')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where(`a.status = 'booked'`)
        .andWhere(`a.payment_status = 'awaiting_transfer'`)
        .andWhere('a.pay_by < :now', { now })
        .orderBy('a.payBy', 'ASC')
        .limit(BATCH)
        .getMany();
      const notices: Notice[] = [];
      for (const a of due) {
        await this.transitions.moveStatus(m, a, 'cancelled', SYSTEM, {
          note: UNPAID_REASON,
          patch: { cancelledBy: 'system', cancelReason: UNPAID_REASON },
        });
        doctors.add(a.doctorId);
        notices.push(
          {
            userId: a.patientUserId,
            payload: {
              type: 'health.appointment.cancelled',
              title: `${a.code} cancelled`,
              body: UNPAID_REASON,
              data: { appointmentCode: a.code },
            },
          },
          {
            userId: await this.owner(m, a.doctorId),
            payload: {
              type: 'health.appointment.cancelled',
              title: `${a.code} cancelled — unpaid`,
              body: 'The slot is free again.',
              data: { appointmentCode: a.code },
            },
          },
        );
      }
      return { counts: { cancelled: due.length }, notices };
    });
    for (const d of doctors) await this.events.availabilityChanged(d);
    return result;
  }

  /** Booked visits never started 2 h after their end: the system marks them no-show. */
  async autoNoShow(now = new Date()) {
    const doctors = new Set<string>();
    const result = await this.run('health:auto-no-show', async (m) => {
      const due = await m
        .createQueryBuilder(Appointment, 'a')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where(`a.status = 'booked'`)
        .andWhere(`a.ends_at < :cutoff`, {
          cutoff: new Date(now.getTime() - 2 * 3_600_000),
        })
        .orderBy('a.endsAt', 'ASC')
        .limit(BATCH)
        .getMany();
      for (const a of due) {
        await this.transitions.moveStatus(m, a, 'no_show', SYSTEM, {
          note: 'Not checked in',
        });
        doctors.add(a.doctorId);
      }
      return { counts: { noShows: due.length }, notices: [] };
    });
    for (const d of doctors) await this.events.availabilityChanged(d);
    return result;
  }

  /** 24 h and 1 h before: once each. */
  async reminders(now = new Date()) {
    return this.run('health:reminders', async (m) => {
      const notices: Notice[] = [];
      let counts = { day: 0, hour: 0 };
      for (const [col, ms, key] of [
        ['reminded_24h_at', 24 * 3_600_000, 'day'],
        ['reminded_1h_at', 3_600_000, 'hour'],
      ] as const) {
        const [rows] = await m.query(
          `UPDATE appointments a SET ${col} = now()
             FROM practice_locations l
            WHERE l.id = a.location_id AND a.status = 'booked' AND a.${col} IS NULL
              AND a.starts_at > $1 AND a.starts_at <= $2
          RETURNING a.code, a.patient_user_id, a.kind, a.starts_at, l.name, l.area, l.timezone`,
          [now, new Date(now.getTime() + ms)],
        );
        counts = { ...counts, [key]: rows.length };
        for (const r of rows) {
          const when = formatTime12(r.starts_at, r.timezone);
          notices.push({
            userId: r.patient_user_id,
            payload: {
              type: 'health.appointment.reminder',
              title:
                key === 'day' ? `Tomorrow at ${when}` : `In an hour: ${when}`,
              body:
                r.kind === 'video'
                  ? 'Join from the app 10 minutes before.'
                  : `${r.name}${r.area ? `, ${r.area}` : ''}`,
              data: { appointmentCode: r.code },
            },
          });
        }
      }
      return { counts, notices };
    });
  }

  async refreshNextAvailable(now = new Date()) {
    return this.run('health:next-available', async () => ({
      counts: { doctors: await this.availability.refreshAllListed(now) },
      notices: [],
    }));
  }

  /** 07:00 local: each doctor with appointments today hears how many (once a day). */
  async doctorDigest(now = new Date()) {
    return this.run('health:doctor-digest', async (m) => {
      const [rows] = await m.query(
        `WITH due AS (
           SELECT d.id, b.owner_user_id,
                  (SELECT count(*)::int FROM appointments a JOIN practice_locations l ON l.id = a.location_id
                    WHERE a.doctor_id = d.id AND a.status IN ('booked', 'checked_in')
                      AND (a.starts_at AT TIME ZONE l.timezone)::date = ($1::timestamptz AT TIME ZONE 'Asia/Karachi')::date) AS n
             FROM doctors d JOIN businesses b ON b.id = d.business_id
            WHERE d.is_listed AND b.status = 'approved'
              AND extract(hour FROM ($1::timestamptz AT TIME ZONE 'Asia/Karachi')) >= 7
              AND (d.daily_digest_on IS NULL OR d.daily_digest_on < ($1::timestamptz AT TIME ZONE 'Asia/Karachi')::date)
         )
         UPDATE doctors SET daily_digest_on = ($1::timestamptz AT TIME ZONE 'Asia/Karachi')::date
           FROM due WHERE doctors.id = due.id
         RETURNING due.owner_user_id, due.n`,
        [now],
      );
      const notices: Notice[] = rows
        .filter((r: any) => r.n > 0)
        .map((r: any) => ({
          userId: r.owner_user_id,
          payload: {
            type: 'health.doctor.today',
            title: `${r.n} appointment${r.n === 1 ? '' : 's'} today`,
            body: 'Your queue is ready.',
            data: { screen: 'today' },
          },
        }));
      return {
        counts: { doctors: rows.length, notified: notices.length },
        notices,
      };
    });
  }

  /** 02:00 PKT: aggregates, top-booked, data retention (each registered by its owner). */
  async nightlyRun(now = new Date()) {
    return this.run('health:nightly', async (m) => {
      let counts: Record<string, number> = {};
      for (const job of this.nightly)
        counts = { ...counts, ...(await job(m, now)) };
      return { counts, notices: [] };
    });
  }

  private async owner(m: EntityManager, doctorId: string): Promise<string> {
    const [r] = await m.query(
      `SELECT b.owner_user_id FROM doctors d JOIN businesses b ON b.id = d.business_id WHERE d.id = $1`,
      [doctorId],
    );
    return r.owner_user_id;
  }

  private async run(
    name: string,
    work: (
      m: EntityManager,
    ) => Promise<{ counts: Record<string, number>; notices: Notice[] }>,
  ): Promise<Record<string, number | boolean>> {
    const result = await this.dataSource.transaction(async (m) => {
      const [{ locked }] = await m.query(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
        [name],
      );
      return locked ? work(m) : null;
    });
    if (!result) {
      this.logger.log(`${name}: another instance is running it; skipped`);
      return { skipped: true };
    }
    for (const n of result.notices) {
      try {
        await this.notifications.notify(n.userId, n.payload);
      } catch (err) {
        this.logger.warn(
          `${name}: notification failed: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(`${name}: ${JSON.stringify(result.counts)}`);
    return result.counts;
  }
}
