import {
  Period,
  addDays,
  expandRange,
  localDayBounds,
  periodOfMinutes,
  shortDateLabel,
  todayIn,
  toZonedIso,
  weekdayLabel,
  weekdayOf,
} from '../common/time.util';

export interface WeeklyRange {
  weekday: number;
  /** Minutes since local midnight. */
  start: number;
  end: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  period: Period;
}

/**
 * Why a day has the slots it has: `open` (free slots), `full` (every slot
 * booked or past), `closed` (no hours that day, or today's are over),
 * `time_off` (time off covers every slot), `paused` (not taking new bookings),
 * `beyond_window` (past the doctor's booking window).
 */
export const DAY_STATUSES = [
  'open',
  'full',
  'closed',
  'time_off',
  'paused',
  'beyond_window',
] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export interface DaySlots {
  date: string;
  weekday: number;
  weekdayLabel: string;
  dateLabel: string;
  isAvailable: boolean;
  status: DayStatus;
  /** Slots the hours make that day, inside notice and window (booked or not). */
  totalSlots: number;
  slots: Slot[];
}

export interface EngineInput {
  tz: string;
  /** First local date to compute ("YYYY-MM-DD"); clamped to today. */
  fromDate: string;
  days: number;
  now: Date;
  minNoticeMinutes: number;
  /** Bookable dates are today … today + window − 1 (local). */
  bookingWindowDays: number;
  slotMinutes: number;
  /** A break after each slot at this location (0 = back to back). */
  bufferMinutes?: number;
  ranges: WeeklyRange[];
  /** The doctor's active appointments at ANY location (callers may add time off here too). */
  blocked: Interval[];
  /** Time off, kept apart so a day it covers reads `time_off`. */
  timeOff?: Interval[];
  /** Not taking new bookings: no slots, every day `paused`. */
  paused?: boolean;
}

const overlaps = (a: Interval, b: Interval) =>
  a.start < b.end && b.start < a.end;

/** The first bookable instant and the end of the booking window. */
export function bookingBounds(
  input: Pick<
    EngineInput,
    'tz' | 'now' | 'minNoticeMinutes' | 'bookingWindowDays'
  >,
) {
  const today = todayIn(input.tz, input.now);
  return {
    today,
    earliest: new Date(input.now.getTime() + input.minNoticeMinutes * 60_000),
    windowEnd: localDayBounds(addDays(today, input.bookingWindowDays), input.tz)
      .start,
  };
}

/** Slots a week of hours makes at this length and break (what the doctor's form counts). */
export function slotsPerWeek(
  ranges: WeeklyRange[],
  slotMinutes: number,
  bufferMinutes = 0,
): number {
  const step = slotMinutes + Math.max(0, bufferMinutes);
  return ranges.reduce(
    (n, r) =>
      n +
      (r.end - r.start >= slotMinutes
        ? Math.floor((r.end - r.start - slotMinutes) / step) + 1
        : 0),
    0,
  );
}

/**
 * Availability, computed — never stored:
 *   weekly ranges → slots of `slotMinutes` (+ the break) per local date
 *   − slots starting inside the notice period or beyond the booking window
 *   − slots overlapping time off or any active appointment of the doctor;
 * every day says why it has what it has (`status`).
 */
export function buildDays(input: EngineInput): DaySlots[] {
  const { today, earliest, windowEnd } = bookingBounds(input);
  const first = input.fromDate < today ? today : input.fromDate;
  const step = input.slotMinutes + Math.max(0, input.bufferMinutes ?? 0);
  const timeOff = input.timeOff ?? [];
  const out: DaySlots[] = [];
  for (let i = 0; i < input.days; i++) {
    const date = addDays(first, i);
    const weekday = weekdayOf(date);
    const beyond = localDayBounds(date, input.tz).start >= windowEnd;
    const dayRanges = input.ranges.filter((x) => x.weekday === weekday);
    const slots: Slot[] = [];
    let total = 0;
    let off = 0;
    for (const r of beyond ? [] : dayRanges) {
      for (const s of expandRange(
        date,
        r.start,
        r.end,
        input.slotMinutes,
        input.tz,
        step,
      )) {
        if (s.startsAt < earliest || s.startsAt >= windowEnd) continue;
        total++;
        const iv = { start: s.startsAt, end: s.endsAt };
        if (timeOff.some((b) => overlaps(iv, b))) {
          off++;
          continue;
        }
        if (input.blocked.some((b) => overlaps(iv, b))) continue;
        slots.push({
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          period: periodOfMinutes(s.wallMinutes),
        });
      }
    }
    slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const status: DayStatus = input.paused
      ? 'paused'
      : beyond
        ? 'beyond_window'
        : total === 0
          ? 'closed'
          : slots.length
            ? 'open'
            : off === total
              ? 'time_off'
              : 'full';
    const shown = input.paused ? [] : slots;
    out.push({
      date,
      weekday,
      weekdayLabel: weekdayLabel(weekday),
      dateLabel: shortDateLabel(date),
      isAvailable: shown.length > 0,
      status,
      totalSlots: total,
      slots: shown,
    });
  }
  return out;
}

/** The earliest free slot inside the booking window, or null (stops at the first day with one). */
export function firstFreeSlot(
  input: Omit<EngineInput, 'fromDate' | 'days'>,
): Slot | null {
  const { today } = bookingBounds(input);
  for (let i = 0; i < input.bookingWindowDays; i++) {
    const [day] = buildDays({ ...input, fromDate: addDays(today, i), days: 1 });
    if (day.slots.length) return day.slots[0];
  }
  return null;
}

/** API shape: instants as ISO strings with the location's offset. */
export const dayView = (d: DaySlots, tz: string) => ({
  date: d.date,
  weekday: d.weekday,
  weekdayLabel: d.weekdayLabel,
  dateLabel: d.dateLabel,
  isAvailable: d.isAvailable,
  status: d.status,
  totalSlots: d.totalSlots,
  slots: d.slots.map((s) => ({
    startsAt: toZonedIso(s.startsAt, tz),
    endsAt: toZonedIso(s.endsAt, tz),
    period: s.period,
  })),
});
