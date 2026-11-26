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

/** As far as the longest booking window (doctors choose 1–30 days). */
export const MAX_DAYS = 30;
const CACHE_MS = 30_000;

interface LocationContext {
  doctor: Pick<
    Doctor,
    'id' | 'bookingWindowDays' | 'minNoticeMinutes' | 'isAccepting'
  >;
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
      select: {
        id: true,
        bookingWindowDays: true,
        minNoticeMinutes: true,
        isAccepting: true,
      },
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

  /** Time off (doctor-wide or at this location) and every active appointment of the doctor, apart. */
  async blockedParts(
    m: EntityManager,
    doctorId: string,
    locationId: string,
    from: Date,
    to: Date,
  ): Promise<{ timeOff: Interval[]; booked: Interval[] }> {
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
    return {
      timeOff: off.map((o) => ({ start: o.starts_at, end: o.ends_at })),
      booked: booked.map((b) => ({ start: b.startsAt, end: b.endsAt })),
    };
  }

  /** Time off and every active appointment of the doctor, together. */
  async blocked(
    m: EntityManager,
    doctorId: string,
    locationId: string,
    from: Date,
    to: Date,
  ): Promise<Interval[]> {
    const { timeOff, booked } = await this.blockedParts(
      m,
      doctorId,
      locationId,
      from,
      to,
    );
    return [...timeOff, ...booked];
  }

  /**
   * Days of slots for a location (raw instants). `fresh` bypasses the cache;
   * `ignorePause` shows a paused doctor their own hours (patients see none).
   */
  async days(
    doctorId: string,
    locationId: string,
    fromDate: string | undefined,
    days: number,
    opts: {
      m?: EntityManager;
      fresh?: boolean;
      now?: Date;
      ignorePause?: boolean;
    } = {},
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
    const paused = !ctx.doctor.isAccepting && !opts.ignorePause;
    const key = `${locationId}:${from}:${days}:${paused ? 'p' : ''}`;
    const hit = this.cache.get(key);
    if (!opts.fresh && hit && now.getTime() - hit.at < CACHE_MS)
      return { ctx, days: hit.days };

    const { earliest, windowEnd } = bookingBounds({
      tz,
      now,
      minNoticeMinutes: ctx.doctor.minNoticeMinutes,
      bookingWindowDays: ctx.doctor.bookingWindowDays,
    });
    const { timeOff, booked } = await this.blockedParts(
      m,
      doctorId,
      locationId,
      earliest,
      windowEnd,
    );
    const result = buildDays({
      tz,
      fromDate: from,
      days,
      now,
      minNoticeMinutes: ctx.doctor.minNoticeMinutes,
      bookingWindowDays: ctx.doctor.bookingWindowDays,
      slotMinutes: ctx.location.slotMinutes,
      bufferMinutes: ctx.location.bufferMinutes,
      ranges: ctx.ranges,
      blocked: booked,
      timeOff,
      paused,
    });
    if (!opts.fresh)
      this.cache.set(key, { at: now.getTime(), doctorId, days: result });
    return { ctx, days: result };
  }

  /** The patient view of a location's slots (a paused doctor: `accepting: false`, no slots). */
  async slots(
    doctorId: string,
    locationId: string,
    fromDate: string | undefined,
    days: number,
    opts: { ignorePause?: boolean } = {},
  ) {
    const { ctx, days: result } = await this.days(
      doctorId,
      locationId,
      fromDate,
      days,
      opts,
    );
    const l = ctx.location;
    return {
      doctorId,
      accepting: ctx.doctor.isAccepting,
      bookingWindowDays: ctx.doctor.bookingWindowDays,
      location: {
        id: l.id,
        kind: l.kind,
        name: l.name,
        area: l.area,
        city: l.city,
        timezone: l.timezone,
        fee: l.fee,
        slotMinutes: l.slotMinutes,
        bufferMinutes: l.bufferMinutes,
      },
      days: result.map((d) => dayView(d, l.timezone)),
    };
  }

  /**
   * Booking's check, never cached: is `startsAt` on the doctor's grid at this
   * location (hours, notice, window, time off) — and is it still free of the
   * doctor's other appointments? Run inside the booking transaction.
   */
  async checkSlot(
    m: EntityManager,
    doctorId: string,
    locationId: string,
    startsAt: Date,
    now = new Date(),
  ) {
    const ctx = await this.context(m, doctorId, locationId);
    const tz = ctx.location.timezone;
    const { earliest, windowEnd } = bookingBounds({
      tz,
      now,
      minNoticeMinutes: ctx.doctor.minNoticeMinutes,
      bookingWindowDays: ctx.doctor.bookingWindowDays,
    });
    const off: Array<{ starts_at: Date; ends_at: Date }> = await m.query(
      `SELECT starts_at, ends_at FROM time_off
        WHERE doctor_id = $1 AND (location_id IS NULL OR location_id = $2) AND starts_at < $4 AND ends_at > $3`,
      [doctorId, locationId, earliest, windowEnd],
    );
    const [day] = buildDays({
      tz,
      fromDate: todayIn(tz, startsAt),
      days: 1,
      now,
      minNoticeMinutes: ctx.doctor.minNoticeMinutes,
      bookingWindowDays: ctx.doctor.bookingWindowDays,
      slotMinutes: ctx.location.slotMinutes,
      bufferMinutes: ctx.location.bufferMinutes,
      ranges: ctx.ranges,
      blocked: [],
      timeOff: off.map((o) => ({ start: o.starts_at, end: o.ends_at })),
    });
    const slot =
      day?.slots.find((s) => s.startsAt.getTime() === startsAt.getTime()) ??
      null;
    if (!slot) return { ctx, slot: null, free: false };
    const clash = await this.events.bookingsOverlapping(
      m,
      doctorId,
      null,
      slot.startsAt,
      slot.endsAt,
    );
    return { ctx, slot, free: clash.length === 0 };
  }

  /**
   * What patients will see, per active location — works before publishing
   * too. A paused doctor sees their hours as they'd be (`paused: true`):
   * patients see none of them until bookings are switched back on.
   */
  async preview(doctorId: string, fromDate: string | undefined, days: number) {
    const [doctor] = await this.dataSource.query(
      `SELECT is_accepting FROM doctors WHERE id = $1`,
      [doctorId],
    );
    const locations: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM practice_locations WHERE doctor_id = $1 AND is_active ORDER BY kind, created_at`,
      [doctorId],
    );
    return {
      paused: doctor ? !doctor.is_accepting : false,
      locations: await Promise.all(
        locations.map(async (l) => {
          const { location, days: list } = await this.slots(
            doctorId,
            l.id,
            fromDate,
            days,
            { ignorePause: true },
          );
          return { location, days: list };
        }),
      ),
    };
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
      // A paused doctor has no next slot for patients.
      if (l.isActive && doctor.isAccepting) {
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
              bufferMinutes: l.bufferMinutes,
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
