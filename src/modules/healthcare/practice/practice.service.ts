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
import {
  CreateLocationDto,
  CreateTimeOffDto,
  ScheduleRangeDto,
  UpdateLocationDto,
} from './dto/practice.dto';
import { DoctorsService } from '../doctors/doctors.service';
import { HealthEvents } from '../common/health-events';
import {
  DEFAULT_TZ,
  formatMinutes,
  isValidZone,
  parseTime,
  toZonedIso,
  weekdayLabel,
} from '../common/time.util';
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

  async updateLocation(doctorId: string, id: string, dto: UpdateLocationDto) {
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
      await this.doctors.enforceListing(m, doctorId);
    });
    await this.events.availabilityChanged(doctorId);
    const loc = await this.dataSource.manager.findOneByOrFail(
      PracticeLocation,
      { id },
    );
    return locationView(loc);
  }

  /** Delete a location (and its hours). Refused while patients are booked there. */
  async removeLocation(doctorId: string, id: string) {
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
      await this.doctors.enforceListing(m, doctorId);
    });
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
   * Replace a location's week. Ranges may not overlap each other, nor any
   * range at the doctor's other active locations on the same weekday — a
   * doctor can't be in two places at once.
   */
  async replaceSchedule(
    doctorId: string,
    locationId: string,
    ranges: ScheduleRangeDto[],
  ) {
    await this.dataSource.transaction(async (m) => {
      const loc = await m.findOne(PracticeLocation, {
        where: { id: locationId, doctorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!loc) throw notFound();
      // Serialise schedule edits per doctor so two locations can't race past the overlap check.
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `doctor-schedule:${doctorId}`,
      ]);

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
      const others: Array<{
        location_id: string;
        name: string;
        weekday: number;
        start_time: string;
        end_time: string;
      }> = await m.query(
        `SELECT w.location_id, l.name, w.weekday, w.start_time::text, w.end_time::text
             FROM weekly_schedules w JOIN practice_locations l ON l.id = w.location_id
            WHERE l.doctor_id = $1 AND l.is_active AND l.id <> $2`,
        [doctorId, locationId],
      );
      for (const r of wanted) {
        for (const o of others) {
          const oStart = parseTime(o.start_time);
          const oEnd = parseTime(o.end_time);
          if (o.weekday === r.weekday && r.start < oEnd && oStart < r.end) {
            throw this.overlap(loc, r, {
              locationId: o.location_id,
              locationName: o.name,
              weekday: o.weekday,
              start: oStart,
              end: oEnd,
            });
          }
        }
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
      await this.doctors.enforceListing(m, doctorId);
    });
    await this.events.availabilityChanged(doctorId);
    return this.schedule(doctorId, locationId);
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
  ) {
    return new ConflictException({
      code: ErrorCode.SCHEDULE_OVERLAP,
      message: `${weekdayLabel(r.weekday)} ${formatMinutes(r.start)}–${formatMinutes(r.end)} overlaps ${conflict.locationName} ${formatMinutes(conflict.start)}–${formatMinutes(conflict.end)}.`,
      details: {
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
