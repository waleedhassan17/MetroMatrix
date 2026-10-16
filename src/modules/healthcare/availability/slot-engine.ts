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

export interface DaySlots {
  date: string;
  weekday: number;
  weekdayLabel: string;
  dateLabel: string;
  isAvailable: boolean;
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
  ranges: WeeklyRange[];
  /** Time off and the doctor's active appointments at ANY location. */
  blocked: Interval[];
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

/**
 * Availability, computed — never stored:
 *   weekly ranges → slots of `slotMinutes` per local date
 *   − slots starting inside the notice period or beyond the booking window
 *   − slots overlapping time off or any active appointment of the doctor.
 */
export function buildDays(input: EngineInput): DaySlots[] {
  const { today, earliest, windowEnd } = bookingBounds(input);
  const first = input.fromDate < today ? today : input.fromDate;
  const out: DaySlots[] = [];
  for (let i = 0; i < input.days; i++) {
    const date = addDays(first, i);
    const weekday = weekdayOf(date);
    const slots: Slot[] = [];
    for (const r of input.ranges.filter((x) => x.weekday === weekday)) {
      for (const s of expandRange(
        date,
        r.start,
        r.end,
        input.slotMinutes,
        input.tz,
      )) {
        if (s.startsAt < earliest || s.startsAt >= windowEnd) continue;
        const iv = { start: s.startsAt, end: s.endsAt };
        if (input.blocked.some((b) => overlaps(iv, b))) continue;
        slots.push({
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          period: periodOfMinutes(s.wallMinutes),
        });
      }
    }
    slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    out.push({
      date,
      weekday,
      weekdayLabel: weekdayLabel(weekday),
      dateLabel: shortDateLabel(date),
      isAvailable: slots.length > 0,
      slots,
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
  slots: d.slots.map((s) => ({
    startsAt: toZonedIso(s.startsAt, tz),
    endsAt: toZonedIso(s.endsAt, tz),
    period: s.period,
  })),
});
