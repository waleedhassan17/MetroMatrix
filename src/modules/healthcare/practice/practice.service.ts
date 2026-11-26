import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, MoreThan } from 'typeorm';
import { PracticeLocation } from './entities/practice-location.entity';
import { WeeklySchedule } from './entities/weekly-schedule.entity';
import { TimeOff } from './entities/time-off.entity';
import { ScheduleOverride } from './entities/schedule-override.entity';
import {
  CreateLocationDto,
  CreateTimeOffDto,
  ScheduleOverrideDto,
  ScheduleRangeDto,
  UpdateLocationDto,
} from './dto/practice.dto';
import { DoctorsService } from '../doctors/doctors.service';
import { HealthEvents } from '../common/health-events';
import {
  DEFAULT_TZ,
  addDays,
  formatMinutes,
  isValidZone,
  localDate,
  localMinutes,
  parseTime,
  todayIn,
  toZonedIso,
  weekdayLabel,
  weekdayOf,
} from '../common/time.util';
import { slotsPerWeek } from '../availability/slot-engine';
import { overridesOf } from '../availability/availability.service';
import { BookingRef } from '../common/health-events';

interface WantedRange {
  weekday: number;
  start: number;
  end: number;
}

/** A window of these hours that another location of the other kind also offers (booking one closes the other). */
export interface SharedHours {
  locationId: string;
  locationName: string;
  kind: string;
  weekday: number;
  weekdayLabel: string;
  /** Only for a day's own hours: the date they share. */
  date?: string;
  start: string;
  end: string;
}

/** HH:mm, with 24:00 for the end of the day. */
const hhmm = (mins: number) => (mins === 1440 ? '24:00' : formatMinutes(mins));

const overrideView = (o: ScheduleOverride) => ({
  date: o.date,
  closed: o.closed,
  ranges: o.ranges,
  note: o.note,
});
import { ErrorCode } from '../../../common/errors/codes';

const notFound = (what = 'Location') =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

const invalid = (
  field: string,
  message: string,
  details?: Record<string, unknown>,
) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] }, ...details },
  });

export const locationView = (l: PracticeLocation) => ({
  id: l.id,
  kind: l.kind,
  name: l.name,
  addressLine: l.addressLine,
  area: l.area,
  city: l.city,
  lat: l.lat,
  lng: l.lng,
  phone: l.phone,
  timezone: l.timezone,
  fee: l.fee,
  slotMinutes: l.slotMinutes,
  bufferMinutes: l.bufferMinutes,
  instructions: l.instructions,
  isActive: l.isActive,
  nextAvailableAt: l.nextAvailableAt
    ? toZonedIso(l.nextAvailableAt, l.timezone)
    : null,
});

const rangeView = (w: WeeklySchedule) => ({
  weekday: w.weekday,
  weekdayLabel: weekdayLabel(w.weekday),
  start: w.startTime.slice(0, 5),
  end: w.endTime.slice(0, 5),
});

const bookingList = (
  rows: Array<{ code: string; startsAt: Date; patientName: string }>,
  tz: string,
) =>
  rows.map((r) => ({
    code: r.code,
    startsAt: toZonedIso(r.startsAt, tz),
    patientName: r.patientName,
  }));

/**
 * A doctor's practice set-up: where (locations), when (weekly hours, per
 * location, in its own zone) and when not (time off). Every change refreshes
 * availability and re-checks the listing.
 */
@Injectable()
export class PracticeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly doctors: DoctorsService,
    private readonly events: HealthEvents,
  ) {}

  // ── Locations ────────────────────────────────────────────────────────────

  async locations(doctorId: string) {
    const rows = await this.dataSource.manager.find(PracticeLocation, {
      where: { doctorId },
      order: { isActive: 'DESC', kind: 'ASC', createdAt: 'ASC' },
    });
    return rows.map(locationView);
  }

  async createLocation(doctorId: string, dto: CreateLocationDto) {
    const tz = dto.timezone ?? DEFAULT_TZ;
    if (!isValidZone(tz))
      throw invalid('timezone', 'Use an IANA zone such as Asia/Karachi.');
    if (dto.kind === 'clinic') {
      for (const k of ['name', 'addressLine', 'area', 'city'] as const) {
        if (!dto[k]) throw invalid(k, `${k} is required for a clinic`);
      }
    }
    const loc = this.dataSource.manager.create(PracticeLocation, {
      doctorId,
      kind: dto.kind,
      name: dto.name ?? (dto.kind === 'video' ? 'Video consultation' : ''),
      addressLine: dto.kind === 'clinic' ? dto.addressLine! : null,
      area: dto.kind === 'clinic' ? dto.area! : null,
      city: dto.kind === 'clinic' ? dto.city! : null,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      phone: dto.phone ?? null,
      timezone: tz,
      fee: dto.fee,
      slotMinutes: dto.slotMinutes ?? 15,
      bufferMinutes: dto.bufferMinutes ?? 0,
      instructions: dto.instructions ?? null,
    });
    try {
      const saved = await this.dataSource.manager.save(loc);
      return locationView(saved);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: 'You already have an active video consultation location.',
        });
      }
      throw err;
    }
  }

  /**
   * Change a location. Switching one back on, or moving its zone, re-checks
   * its hours against the doctor's other locations; the answer lists the
   * booked visits its hours no longer cover (`outsideHours`: they stay booked).
   */
  async updateLocation(doctorId: string, id: string, dto: UpdateLocationDto) {
    let outsideHours: ReturnType<typeof bookingList> = [];
    let notifyListing: () => Promise<void> = async () => undefined;
    await this.dataSource.transaction(async (m) => {
      const loc = await m.findOne(PracticeLocation, {
        where: { id, doctorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!loc) throw notFound();
      if (dto.timezone !== undefined && !isValidZone(dto.timezone)) {
        throw invalid('timezone', 'Use an IANA zone such as Asia/Karachi.');
      }
      if (dto.isActive === false && loc.isActive)
        await this.assertNoFutureBookings(m, loc);
      const changes: Partial<PracticeLocation> = {};
      for (const k of [
        'name',
        'lat',
        'lng',
        'phone',
        'timezone',
        'fee',
        'slotMinutes',
        'bufferMinutes',
        'instructions',
        'isActive',
      ] as const) {
        if (dto[k] !== undefined)
          (changes as Record<string, unknown>)[k] = dto[k];
      }
      if (loc.kind === 'clinic') {
        for (const k of ['addressLine', 'area', 'city'] as const)
          if (dto[k] !== undefined) changes[k] = dto[k];
      }
      const reactivated = dto.isActive === true && !loc.isActive;
      const rezoned =
        dto.timezone !== undefined && dto.timezone !== loc.timezone;
      if (reactivated || rezoned) {
        await this.lockSchedules(m, doctorId);
        const after = { ...loc, ...changes } as PracticeLocation;
        await this.sharedHours(m, doctorId, after, await this.rangesOf(m, id));
      }
      try {
        await m.update(PracticeLocation, { id }, changes);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException({
            code: ErrorCode.CONFLICT,
            message: 'You already have an active video consultation location.',
          });
        }
        throw err;
      }
      if (rezoned) {
        const after = { ...loc, ...changes } as PracticeLocation;
        outsideHours = bookingList(
          await this.visitsOutside(m, after, await this.rangesOf(m, id)),
          after.timezone,
        );
      }
      notifyListing = await this.doctors.enforceListing(m, doctorId);
    });
    await notifyListing();
    await this.events.availabilityChanged(doctorId);
    const loc = await this.dataSource.manager.findOneByOrFail(
      PracticeLocation,
      { id },
    );
    return { ...locationView(loc), outsideHours };
  }

  /** Serialise schedule edits per doctor so two locations can't race past the overlap check. */
  private async lockSchedules(m: EntityManager, doctorId: string) {
    await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `doctor-schedule:${doctorId}`,
    ]);
  }

  private async rangesOf(m: EntityManager, locationId: string) {
    const rows = await m.find(WeeklySchedule, { where: { locationId } });
    return rows.map((w) => ({
      weekday: w.weekday,
      start: parseTime(w.startTime),
      end: parseTime(w.endTime),
    }));
  }

  /**
   * The doctor's other active locations against these hours. Two of the same
   * kind (two clinics) can't overlap: a doctor can't be in two places at once.
   * A clinic and the video consultation may share hours in the same zone —
   * either can be booked, and booking one closes the other (appointments at
   * any location block the doctor). Different zones can't share.
   */
  private async sharedHours(
    m: EntityManager,
    doctorId: string,
    loc: PracticeLocation,
    wanted: WantedRange[],
  ): Promise<SharedHours[]> {
    const others: Array<{
      location_id: string;
      name: string;
      kind: string;
      timezone: string;
      weekday: number;
      start_time: string;
      end_time: string;
    }> = await m.query(
      `SELECT w.location_id, l.name, l.kind, l.timezone, w.weekday, w.start_time::text, w.end_time::text
           FROM weekly_schedules w JOIN practice_locations l ON l.id = w.location_id
          WHERE l.doctor_id = $1 AND l.is_active AND l.id <> $2
          ORDER BY w.weekday, w.start_time`,
      [doctorId, loc.id],
    );
    const shared: SharedHours[] = [];
    // Other locations' day-specific hours, on dates this location keeps its weekly hours.
    const own = await overridesOf(m, loc.id, loc.timezone);
    const theirDays: Array<{
      location_id: string;
      name: string;
      kind: string;
      timezone: string;
      date: string;
      closed: boolean;
      ranges: Array<{ start: string; end: string }>;
    }> = await m.query(
      `SELECT o.location_id, l.name, l.kind, l.timezone, to_char(o.date, 'YYYY-MM-DD') AS date, o.closed, o.ranges
         FROM schedule_overrides o JOIN practice_locations l ON l.id = o.location_id
        WHERE l.doctor_id = $1 AND l.is_active AND l.id <> $2 AND o.date >= $3 AND NOT o.closed
        ORDER BY o.date`,
      [doctorId, loc.id, todayIn(loc.timezone)],
    );
    for (const day of theirDays) {
      if (own.has(day.date)) continue;
      const weekday = weekdayOf(day.date);
      for (const r of wanted.filter((x) => x.weekday === weekday)) {
        for (const x of day.ranges) {
          const oStart = parseTime(x.start);
          const oEnd = parseTime(x.end);
          if (!(r.start < oEnd && oStart < r.end)) continue;
          const conflict = {
            locationId: day.location_id,
            locationName: `${day.name} on ${day.date}`,
            weekday,
            start: oStart,
            end: oEnd,
          };
          if (day.kind === loc.kind) throw this.overlap(loc, r, conflict);
          if (day.timezone !== loc.timezone)
            throw this.overlap(loc, r, conflict, 'timezone');
          shared.push({
            locationId: day.location_id,
            locationName: day.name,
            kind: day.kind,
            weekday,
            weekdayLabel: weekdayLabel(weekday),
            date: day.date,
            start: hhmm(Math.max(r.start, oStart)),
            end: hhmm(Math.min(r.end, oEnd)),
          });
        }
      }
    }
    for (const r of wanted) {
      for (const o of others) {
        const oStart = parseTime(o.start_time);
        const oEnd = parseTime(o.end_time);
        if (o.weekday !== r.weekday || !(r.start < oEnd && oStart < r.end))
          continue;
        const conflict = {
          locationId: o.location_id,
          locationName: o.name,
          weekday: o.weekday,
          start: oStart,
          end: oEnd,
        };
        if (o.kind === loc.kind) throw this.overlap(loc, r, conflict);
        if (o.timezone !== loc.timezone)
          throw this.overlap(loc, r, conflict, 'timezone');
        shared.push({
          locationId: o.location_id,
          locationName: o.name,
          kind: o.kind,
          weekday: r.weekday,
          weekdayLabel: weekdayLabel(r.weekday),
          start: hhmm(Math.max(r.start, oStart)),
          end: hhmm(Math.min(r.end, oEnd)),
        });
      }
    }
    return shared;
  }

  /**
   * A day's own hours at this location against the doctor's other active
   * locations' hours that date (their own hours for it, else their weekly
   * ones): the same rules as the week.
   */
  private async sharedHoursOn(
    m: EntityManager,
    doctorId: string,
    loc: PracticeLocation,
    date: string,
    wanted: Array<{ start: number; end: number }>,
  ): Promise<SharedHours[]> {
    const weekday = weekdayOf(date);
    const others = await m.find(PracticeLocation, {
      where: { doctorId, isActive: true },
    });
    const shared: SharedHours[] = [];
    for (const o of others.filter((x) => x.id !== loc.id)) {
      const theirs =
        (await overridesOf(m, o.id, o.timezone)).get(date) ??
        (await this.rangesOf(m, o.id)).filter((r) => r.weekday === weekday);
      for (const r of wanted) {
        for (const x of theirs) {
          if (!(r.start < x.end && x.start < r.end)) continue;
          const conflict = {
            locationId: o.id,
            locationName: o.name,
            weekday,
            start: x.start,
            end: x.end,
          };
          const range = { weekday, start: r.start, end: r.end };
          if (o.kind === loc.kind) throw this.overlap(loc, range, conflict);
          if (o.timezone !== loc.timezone)
            throw this.overlap(loc, range, conflict, 'timezone');
          shared.push({
            locationId: o.id,
            locationName: o.name,
            kind: o.kind,
            weekday,
            weekdayLabel: weekdayLabel(weekday),
            date,
            start: hhmm(Math.max(r.start, x.start)),
            end: hhmm(Math.min(r.end, x.end)),
          });
        }
      }
    }
    return shared;
  }

  // ── Day-specific hours ───────────────────────────────────────────────────

  /** A location's own hours for some dates (default today … 60 days on, its zone). */
  async overrides(
    doctorId: string,
    locationId: string,
    from?: string,
    to?: string,
  ) {
    const loc = await this.dataSource.manager.findOne(PracticeLocation, {
      where: { id: locationId, doctorId },
    });
    if (!loc) throw notFound();
    const first = from ?? todayIn(loc.timezone);
    const last = to ?? addDays(first, 60);
    const rows = await this.dataSource.manager
      .createQueryBuilder(ScheduleOverride, 'o')
      .where(
        'o.location_id = :locationId AND o.date BETWEEN :first AND :last',
        {
          locationId,
          first,
          last,
        },
      )
      .orderBy('o.date', 'ASC')
      .getMany();
    return {
      locationId,
      timezone: loc.timezone,
      items: rows.map(overrideView),
    };
  }

  /**
   * Different hours on one date: extra hours, shorter hours, or `closed`.
   * They replace the date's weekly hours at this location. Checked like the
   * week (SCHEDULE_OVERLAP; a clinic and video may share); the answer counts
   * the day's slots and lists booked visits the new hours leave out
   * (`outsideHours`: they stay booked). `dryRun` reports without saving.
   */
  async setOverride(
    doctorId: string,
    locationId: string,
    date: string,
    dto: ScheduleOverrideDto,
    opts: { dryRun?: boolean } = {},
  ) {
    let notifyListing: () => Promise<void> = async () => undefined;
    const result = await this.dataSource.transaction(async (m) => {
      const loc = await m.findOne(PracticeLocation, {
        where: { id: locationId, doctorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!loc) throw notFound();
      const today = todayIn(loc.timezone);
      if (date < today) throw invalid('date', 'Choose today or a later day.');
      if (date > addDays(today, 365))
        throw invalid('date', 'Choose a day within the next year.');
      const closed = !!dto.closed;
      const wanted = closed
        ? []
        : (dto.ranges ?? []).map((r) => ({
            start: parseTime(r.start),
            end: parseTime(r.end),
          }));
      if (!closed && !wanted.length)
        throw invalid('ranges', 'Give the day’s hours, or close it.');
      wanted.forEach((r, i) => {
        if (r.end <= r.start)
          throw invalid(`ranges.${i}.end`, 'end must be after start');
      });
      const sorted = [...wanted].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end)
          throw invalid('ranges', 'The day’s hours overlap each other.');
      }
      await this.lockSchedules(m, doctorId);
      const sharedWith = loc.isActive
        ? await this.sharedHoursOn(m, doctorId, loc, date, sorted)
        : [];
      const booked = await this.events.futureBookingsAtLocation(m, loc.id);
      const outside = booked.filter((b) => {
        if (localDate(b.startsAt, loc.timezone) !== date) return false;
        const start = localMinutes(b.startsAt, loc.timezone);
        const end =
          start + (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000;
        return !sorted.some((r) => r.start <= start && end <= r.end);
      });
      const ranges = sorted.map((r) => ({
        start: formatMinutes(r.start),
        end: hhmm(r.end),
      }));
      const report = {
        date,
        closed,
        ranges,
        note: dto.note ?? null,
        sharedWith,
        outsideHours: bookingList(outside, loc.timezone),
        slots: slotsPerWeek(
          sorted.map((r) => ({ weekday: 0, ...r })),
          loc.slotMinutes,
          loc.bufferMinutes,
        ),
        dryRun: !!opts.dryRun,
      };
      if (opts.dryRun) return report;
      await m
        .createQueryBuilder()
        .insert()
        .into(ScheduleOverride)
        .values({ locationId, date, closed, ranges, note: dto.note ?? null })
        .orUpdate(
          ['closed', 'ranges', 'note', 'updated_at'],
          ['location_id', 'date'],
        )
        .execute();
      notifyListing = await this.doctors.enforceListing(m, doctorId);
      return report;
    });
    if (!opts.dryRun) {
      await notifyListing();
      await this.events.availabilityChanged(doctorId);
    }
    return result;
  }

  /** Back to the weekly hours on that date; lists booked visits they leave out. */
  async removeOverride(doctorId: string, locationId: string, date: string) {
    const outside = await this.dataSource.transaction(async (m) => {
      const loc = await m.findOne(PracticeLocation, {
        where: { id: locationId, doctorId },
      });
      if (!loc) throw notFound();
      const res = await m.delete(ScheduleOverride, { locationId, date });
      if (!res.affected) throw notFound('Those hours');
      const weekday = weekdayOf(date);
      const weekly = (await this.rangesOf(m, locationId)).filter(
        (r) => r.weekday === weekday,
      );
      const booked = await this.events.futureBookingsAtLocation(m, loc.id);
      return bookingList(
        booked.filter((b) => {
          if (localDate(b.startsAt, loc.timezone) !== date) return false;
          const start = localMinutes(b.startsAt, loc.timezone);
          const end =
            start + (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000;
          return !weekly.some((r) => r.start <= start && end <= r.end);
        }),
        loc.timezone,
      );
    });
    await this.events.availabilityChanged(doctorId);
    return { removed: true, outsideHours: outside };
  }

  /** Booked visits at a location from now on that these hours (in its zone) no longer cover. */
  private async visitsOutside(
    m: EntityManager,
    loc: PracticeLocation,
    wanted: WantedRange[],
  ): Promise<BookingRef[]> {
    const booked = await this.events.futureBookingsAtLocation(m, loc.id);
    const own = await overridesOf(m, loc.id, loc.timezone);
    return booked.filter((b) => {
      const date = localDate(b.startsAt, loc.timezone);
      const weekday = weekdayOf(date);
      const start = localMinutes(b.startsAt, loc.timezone);
      const end = start + (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000;
      // A date with its own hours keeps them, whatever the week says.
      const day = own.get(date);
      if (day) return !day.some((r) => r.start <= start && end <= r.end);
      return !wanted.some(
        (r) => r.weekday === weekday && r.start <= start && end <= r.end,
      );
    });
  }

  /** Delete a location (and its hours). Refused while patients are booked there. */
  async removeLocation(doctorId: string, id: string) {
    let notifyListing: () => Promise<void> = async () => undefined;
    await this.dataSource.transaction(async (m) => {
      const loc = await m.findOne(PracticeLocation, {
        where: { id, doctorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!loc) throw notFound();
      await this.assertNoFutureBookings(m, loc);
      const used = await this.events.locationUsed(m, id);
      // A location past appointments point at is kept, inactive, for their history.
      if (used) await m.update(PracticeLocation, { id }, { isActive: false });
      else await m.delete(PracticeLocation, { id });
      notifyListing = await this.doctors.enforceListing(m, doctorId);
    });
    await notifyListing();
    await this.events.availabilityChanged(doctorId);
    return { removed: true };
  }

  private async assertNoFutureBookings(
    m: EntityManager,
    loc: PracticeLocation,
  ) {
    const booked = await this.events.futureBookingsAtLocation(m, loc.id);
    if (booked.length) {
      throw new ConflictException({
        code: ErrorCode.LOCATION_HAS_BOOKINGS,
        message: `${booked.length} patient(s) are booked here. Cancel or move them first.`,
        details: { appointments: bookingList(booked, loc.timezone) },
      });
    }
  }

  // ── Weekly schedule ──────────────────────────────────────────────────────

  async schedule(doctorId: string, locationId: string) {
    const loc = await this.dataSource.manager.findOne(PracticeLocation, {
      where: { id: locationId, doctorId },
    });
    if (!loc) throw notFound();
    const rows = await this.dataSource.manager.find(WeeklySchedule, {
      where: { locationId },
      order: { weekday: 'ASC', startTime: 'ASC' },
    });
    return { locationId, timezone: loc.timezone, ranges: rows.map(rangeView) };
  }

  /**
   * Replace a location's week. Ranges may not overlap each other, nor a range
   * at another active location of the same kind (a doctor can't be in two
   * clinics at once); a clinic and the video consultation may share hours
   * (`sharedWith`). The answer also counts the week's slots and lists booked
   * visits the new hours leave out (`outsideHours`: they stay booked, never
   * cancelled). `dryRun` checks and reports without saving.
   */
  async replaceSchedule(
    doctorId: string,
    locationId: string,
    ranges: ScheduleRangeDto[],
    opts: { dryRun?: boolean } = {},
  ) {
    let report: {
      sharedWith: SharedHours[];
      outsideHours: ReturnType<typeof bookingList>;
      slotsPerWeek: number;
    } = { sharedWith: [], outsideHours: [], slotsPerWeek: 0 };
    let preview: ReturnType<typeof rangeView>[] = [];
    let timezone = DEFAULT_TZ;
    let notifyListing: () => Promise<void> = async () => undefined;
    await this.dataSource.transaction(async (m) => {
      const loc = await m.findOne(PracticeLocation, {
        where: { id: locationId, doctorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!loc) throw notFound();
      timezone = loc.timezone;
      await this.lockSchedules(m, doctorId);

      const wanted = ranges.map((r) => ({
        weekday: r.weekday,
        start: parseTime(r.start),
        end: parseTime(r.end),
      }));
      wanted.forEach((r, i) => {
        if (r.end <= r.start)
          throw invalid(`${i}.end`, 'end must be after start', {
            range: ranges[i],
          });
      });
      const sorted = [...wanted].sort(
        (a, b) => a.weekday - b.weekday || a.start - b.start,
      );
      for (let i = 1; i < sorted.length; i++) {
        const [a, b] = [sorted[i - 1], sorted[i]];
        if (a.weekday === b.weekday && b.start < a.end) {
          throw this.overlap(loc, b, {
            locationId: loc.id,
            locationName: loc.name,
            weekday: a.weekday,
            start: a.start,
            end: a.end,
          });
        }
      }
      const sharedWith = loc.isActive
        ? await this.sharedHours(m, doctorId, loc, wanted)
        : [];
      report = {
        sharedWith,
        outsideHours: bookingList(
          await this.visitsOutside(m, loc, wanted),
          loc.timezone,
        ),
        slotsPerWeek: slotsPerWeek(wanted, loc.slotMinutes, loc.bufferMinutes),
      };
      if (opts.dryRun) {
        preview = sorted.map((r) => ({
          weekday: r.weekday,
          weekdayLabel: weekdayLabel(r.weekday),
          start: formatMinutes(r.start),
          end: r.end === 1440 ? '24:00' : formatMinutes(r.end),
        }));
        return;
      }
      await m.delete(WeeklySchedule, { locationId });
      if (wanted.length) {
        await m.insert(
          WeeklySchedule,
          wanted.map((r) => ({
            locationId,
            weekday: r.weekday,
            startTime: formatMinutes(r.start),
            endTime: r.end === 1440 ? '24:00' : formatMinutes(r.end),
          })),
        );
      }
      notifyListing = await this.doctors.enforceListing(m, doctorId);
    });
    if (opts.dryRun)
      return {
        locationId,
        timezone,
        ranges: preview,
        dryRun: true,
        ...report,
      };
    await notifyListing();
    await this.events.availabilityChanged(doctorId);
    return {
      ...(await this.schedule(doctorId, locationId)),
      dryRun: false,
      ...report,
    };
  }

  private overlap(
    loc: PracticeLocation,
    r: { weekday: number; start: number; end: number },
    conflict: {
      locationId: string;
      locationName: string;
      weekday: number;
      start: number;
      end: number;
    },
    reason: 'same_kind' | 'timezone' = 'same_kind',
  ) {
    const clash = `${weekdayLabel(r.weekday)} ${formatMinutes(r.start)}–${formatMinutes(r.end)} overlaps ${conflict.locationName} ${formatMinutes(conflict.start)}–${formatMinutes(conflict.end)}`;
    return new ConflictException({
      code: ErrorCode.SCHEDULE_OVERLAP,
      message:
        reason === 'timezone'
          ? `${clash}, which is in another time zone. Use one zone to share hours.`
          : `${clash}.`,
      details: {
        reason,
        range: {
          locationId: loc.id,
          weekday: r.weekday,
          start: formatMinutes(r.start),
          end: formatMinutes(r.end),
        },
        conflict: {
          ...conflict,
          start: formatMinutes(conflict.start),
          end: formatMinutes(conflict.end),
        },
      },
    });
  }

  // ── Time off ─────────────────────────────────────────────────────────────

  async timeOff(doctorId: string) {
    const rows = await this.dataSource.manager.find(TimeOff, {
      where: {
        doctorId,
        endsAt: MoreThan(new Date(Date.now() - 30 * 86_400_000)),
      },
      order: { startsAt: 'ASC' },
    });
    return rows.map((t) => ({
      id: t.id,
      locationId: t.locationId,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      reason: t.reason,
    }));
  }

  /**
   * Block time. Booked appointments inside it are listed (TIME_OFF_CONFLICTS)
   * unless cancelAffected, which cancels them as the system and tells patients.
   */
  async addTimeOff(doctorId: string, dto: CreateTimeOffDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt)
      throw invalid('endsAt', 'endsAt must be after startsAt');
    let notify: () => Promise<void> = async () => undefined;
    const saved = await this.dataSource.transaction(async (m) => {
      let tz = DEFAULT_TZ;
      if (dto.locationId) {
        const loc = await m.findOne(PracticeLocation, {
          where: { id: dto.locationId, doctorId },
        });
        if (!loc) throw notFound();
        tz = loc.timezone;
      }
      const affected = await this.events.bookingsOverlapping(
        m,
        doctorId,
        dto.locationId ?? null,
        startsAt,
        endsAt,
      );
      if (affected.length && !dto.cancelAffected) {
        throw new ConflictException({
          code: ErrorCode.TIME_OFF_CONFLICTS,
          message: `${affected.length} patient(s) are booked in that time. Send cancelAffected: true to cancel them.`,
          details: { appointments: bookingList(affected, tz) },
        });
      }
      if (affected.length) {
        notify = await this.events.cancelForTimeOff(
          m,
          affected.map((a) => a.id),
          dto.reason || 'The doctor is unavailable at this time.',
        );
      }
      return m.save(
        m.create(TimeOff, {
          doctorId,
          locationId: dto.locationId ?? null,
          startsAt,
          endsAt,
          reason: dto.reason ?? null,
        }),
      );
    });
    await notify();
    await this.events.availabilityChanged(doctorId);
    return {
      id: saved.id,
      locationId: saved.locationId,
      startsAt: saved.startsAt,
      endsAt: saved.endsAt,
      reason: saved.reason,
    };
  }

  async removeTimeOff(doctorId: string, id: string) {
    const res = await this.dataSource.manager.delete(TimeOff, { id, doctorId });
    if (!res.affected) throw notFound('Time off');
    await this.events.availabilityChanged(doctorId);
    return { removed: true };
  }

  /** Ranges of all active locations, for availability and profiles. */
  async weeklyRanges(m: EntityManager, locationIds: string[]) {
    if (!locationIds.length) return [];
    return m.find(WeeklySchedule, {
      where: { locationId: In(locationIds) },
      order: { weekday: 'ASC', startTime: 'ASC' },
    });
  }
}
