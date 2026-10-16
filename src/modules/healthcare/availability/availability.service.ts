import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Doctor } from '../doctors/entities/doctor.entity';
import { PracticeLocation } from '../practice/entities/practice-location.entity';
import { WeeklySchedule } from '../practice/entities/weekly-schedule.entity';
import { HealthEvents } from '../common/health-events';
import {
  DaySlots,
  Interval,
  WeeklyRange,
  bookingBounds,
  buildDays,
  dayView,
  firstFreeSlot,
} from './slot-engine';
import { parseTime, todayIn } from '../common/time.util';
import { ErrorCode } from '../../../common/errors/codes';

export const MAX_DAYS = 14;
const CACHE_MS = 30_000;

interface LocationContext {
  doctor: Pick<Doctor, 'id' | 'bookingWindowDays' | 'minNoticeMinutes'>;
  location: PracticeLocation;
  ranges: WeeklyRange[];
}

/**
 * Availability is computed from weekly hours − time off − the doctor's
 * active appointments (at every location), never stored — so there is no
 * slot horizon to run out.
 *
 * Patient-facing reads are cached for 30 s per (location, from, days) and
 * dropped whenever anything about the doctor changes. Booking never trusts
 * the cache: it recomputes inside its transaction, and the exclusion
 * constraint on appointments is the final word.
 */
@Injectable()
export class AvailabilityService implements OnModuleInit {
  private readonly logger = new Logger(AvailabilityService.name);
  private readonly cache = new Map<
    string,
    { at: number; doctorId: string; days: DaySlots[] }
  >();

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: HealthEvents,
  ) {}

  onModuleInit(): void {
    this.events.availabilityChanged = async (doctorId) => {
      this.invalidate(doctorId);
      await this.refreshNextAvailable(doctorId);
    };
  }

  invalidate(doctorId: string): void {
    for (const [key, v] of this.cache)
      if (v.doctorId === doctorId) this.cache.delete(key);
  }

  private async context(
    m: EntityManager,
    doctorId: string,
    locationId: string,
  ): Promise<LocationContext> {
    const doctor = await m.findOne(Doctor, {
      where: { id: doctorId },
      select: { id: true, bookingWindowDays: true, minNoticeMinutes: true },
    });
    const location = await m.findOne(PracticeLocation, {
      where: { id: locationId, doctorId, isActive: true },
    });
    if (!doctor || !location) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Location not found.',
      });
    }
    const rows = await m.find(WeeklySchedule, { where: { locationId } });
    return {
      doctor,
      location,
      ranges: rows.map((r) => ({
        weekday: r.weekday,
        start: parseTime(r.startTime),
        end: parseTime(r.endTime),
      })),
    };
  }

  /** Time off (doctor-wide or at this location) and every active appointment of the doctor. */
  async blocked(
    m: EntityManager,
    doctorId: string,
    locationId: string,
    from: Date,
    to: Date,
  ): Promise<Interval[]> {
    const off: Array<{ starts_at: Date; ends_at: Date }> = await m.query(
      `SELECT starts_at, ends_at FROM time_off
        WHERE doctor_id = $1 AND (location_id IS NULL OR location_id = $2)
          AND starts_at < $4 AND ends_at > $3`,
      [doctorId, locationId, from, to],
    );
    const booked = await this.events.bookingsOverlapping(
      m,
      doctorId,
      null,
      from,
      to,
    );
    return [
      ...off.map((o) => ({ start: o.starts_at, end: o.ends_at })),
      ...booked.map((b) => ({ start: b.startsAt, end: b.endsAt })),
    ];
  }

  /** Days of slots for a location (raw instants). `fresh` bypasses the cache. */
  async days(
    doctorId: string,
    locationId: string,
    fromDate: string | undefined,
    days: number,
    opts: { m?: EntityManager; fresh?: boolean; now?: Date } = {},
  ): Promise<{ ctx: LocationContext; days: DaySlots[] }> {
    if (days < 1 || days > MAX_DAYS) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `days must be 1–${MAX_DAYS}.`,
      });
    }
    const m = opts.m ?? this.dataSource.manager;
    const now = opts.now ?? new Date();
    const ctx = await this.context(m, doctorId, locationId);
    const tz = ctx.location.timezone;
    const from = fromDate ?? todayIn(tz, now);
    const key = `${locationId}:${from}:${days}`;
    const hit = this.cache.get(key);
    if (!opts.fresh && hit && now.getTime() - hit.at < CACHE_MS)
      return { ctx, days: hit.days };

    const { earliest, windowEnd } = bookingBounds({
      tz,
      now,
      minNoticeMinutes: ctx.doctor.minNoticeMinutes,
      bookingWindowDays: ctx.doctor.bookingWindowDays,
    });
    const result = buildDays({
      tz,
      fromDate: from,
      days,
      now,
      minNoticeMinutes: ctx.doctor.minNoticeMinutes,
      bookingWindowDays: ctx.doctor.bookingWindowDays,
      slotMinutes: ctx.location.slotMinutes,
      ranges: ctx.ranges,
      blocked: await this.blocked(m, doctorId, locationId, earliest, windowEnd),
    });
    if (!opts.fresh)
      this.cache.set(key, { at: now.getTime(), doctorId, days: result });
    return { ctx, days: result };
  }

  /** The patient view of a location's slots. */
  async slots(
    doctorId: string,
    locationId: string,
    fromDate: string | undefined,
    days: number,
  ) {
    const { ctx, days: result } = await this.days(
      doctorId,
      locationId,
      fromDate,
      days,
    );
    const l = ctx.location;
    return {
      doctorId,
      location: {
        id: l.id,
        kind: l.kind,
        name: l.name,
        area: l.area,
        city: l.city,
        timezone: l.timezone,
        fee: l.fee,
        slotMinutes: l.slotMinutes,
      },
      days: result.map((d) => dayView(d, l.timezone)),
    };
  }

  /** Is this exact instant a real, free slot right now? (Booking; never cached.) */
  async isRealSlot(
    m: EntityManager,
    doctorId: string,
    locationId: string,
    startsAt: Date,
    now = new Date(),
  ) {
    const ctx = await this.context(m, doctorId, locationId);
    const date = todayIn(ctx.location.timezone, startsAt);
    const { days } = await this.days(doctorId, locationId, date, 1, {
      m,
      fresh: true,
      now,
    });
    const slot =
      days[0]?.slots.find((s) => s.startsAt.getTime() === startsAt.getTime()) ??
      null;
    return { ctx, slot };
  }

  /** The n free slots nearest to an instant (offered when a slot was just taken). */
  async nearest(
    doctorId: string,
    locationId: string,
    around: Date,
    n = 3,
    now = new Date(),
  ) {
    const ctx = await this.context(
      this.dataSource.manager,
      doctorId,
      locationId,
    );
    const { today } = bookingBounds({
      tz: ctx.location.timezone,
      now,
      minNoticeMinutes: 0,
      bookingWindowDays: 1,
    });
    const { days } = await this.days(
      doctorId,
      locationId,
      today,
      Math.min(MAX_DAYS, ctx.doctor.bookingWindowDays),
      { fresh: true, now },
    );
    return days
      .flatMap((d) => d.slots)
      .sort(
        (a, b) =>
          Math.abs(a.startsAt.getTime() - around.getTime()) -
          Math.abs(b.startsAt.getTime() - around.getTime()),
      )
      .slice(0, n)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  /** Recompute next_available_at for each active location and for the doctor. */
  async refreshNextAvailable(
    doctorId: string,
    now = new Date(),
  ): Promise<Date | null> {
    const m = this.dataSource.manager;
    const doctor = await m.findOne(Doctor, { where: { id: doctorId } });
    if (!doctor) return null;
    const locations = await m.find(PracticeLocation, { where: { doctorId } });
    let best: Date | null = null;
    for (const l of locations) {
      let next: Date | null = null;
      if (l.isActive) {
        const rows = await m.find(WeeklySchedule, {
          where: { locationId: l.id },
        });
        const tz = l.timezone;
        const { earliest, windowEnd } = bookingBounds({
          tz,
          now,
          minNoticeMinutes: doctor.minNoticeMinutes,
          bookingWindowDays: doctor.bookingWindowDays,
        });
        const slot = rows.length
          ? firstFreeSlot({
              tz,
              now,
              minNoticeMinutes: doctor.minNoticeMinutes,
              bookingWindowDays: doctor.bookingWindowDays,
              slotMinutes: l.slotMinutes,
              ranges: rows.map((r) => ({
                weekday: r.weekday,
                start: parseTime(r.startTime),
                end: parseTime(r.endTime),
              })),
              blocked: await this.blocked(
                m,
                doctorId,
                l.id,
                earliest,
                windowEnd,
              ),
            })
          : null;
        next = slot?.startsAt ?? null;
      }
      if (
        (l.nextAvailableAt?.getTime() ?? null) !== (next?.getTime() ?? null)
      ) {
        await m.update(
          PracticeLocation,
          { id: l.id },
          { nextAvailableAt: next },
        );
      }
      if (next && (!best || next < best)) best = next;
    }
    await m.update(Doctor, { id: doctorId }, { nextAvailableAt: best });
    return best;
  }

  /** Job: time passes, so every listed doctor's next slot moves on. */
  async refreshAllListed(now = new Date()): Promise<number> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM doctors WHERE is_listed`,
    );
    for (const r of rows) {
      try {
        this.invalidate(r.id);
        await this.refreshNextAvailable(r.id, now);
      } catch (err) {
        this.logger.warn(`next-available ${r.id}: ${(err as Error).message}`);
      }
    }
    return rows.length;
  }
}
