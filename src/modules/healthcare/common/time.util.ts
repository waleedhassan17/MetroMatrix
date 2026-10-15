import { DateTime, IANAZone } from 'luxon';

/**
 * The ONLY place Healthcare converts between instants and wall-clock time.
 *
 * - The database stores instants (`timestamptz`, UTC).
 * - Doctors author wall-clock hours (`time` + weekday) per location, and each
 *   location has an IANA zone (default Asia/Karachi).
 * - Responses carry ISO strings with the location's offset.
 *
 * Weekdays are 0 = Sunday … 6 = Saturday (JavaScript's convention).
 * DST: a wall time that doesn't exist (spring-forward gap) yields no slot; an
 * ambiguous one (fall-back overlap) resolves to its first occurrence.
 */

export const DEFAULT_TZ = 'Asia/Karachi';

export type Period = 'morning' | 'afternoon' | 'evening' | 'night';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const isValidZone = (tz: string): boolean => IANAZone.isValidZone(tz);

/** "HH:mm" or "HH:mm:ss" → minutes since midnight. */
export function parseTime(t: string): number {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m) throw new Error(`Bad time "${t}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0))
    throw new Error(`Bad time "${t}"`);
  return h * 60 + min;
}

/** Minutes since midnight → "HH:mm". */
export const formatMinutes = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const local = (instant: Date, tz: string) =>
  DateTime.fromJSDate(instant, { zone: tz });

/** The local calendar date of an instant: "YYYY-MM-DD". */
export const localDate = (instant: Date, tz: string): string =>
  local(instant, tz).toISODate()!;

/** Today's local date in a zone. */
export const todayIn = (tz: string, now: Date = new Date()): string =>
  localDate(now, tz);

/** Calendar arithmetic on "YYYY-MM-DD" (zone-independent). */
export const addDays = (date: string, n: number): string =>
  DateTime.fromISO(date, { zone: 'UTC' }).plus({ days: n }).toISODate()!;

/** 0 = Sunday … 6 = Saturday for a calendar date. */
export const weekdayOf = (date: string): number =>
  DateTime.fromISO(date, { zone: 'UTC' }).weekday % 7;

/** "Thu 15 Oct". */
export const shortDateLabel = (date: string): string =>
  DateTime.fromISO(date, { zone: 'UTC' }).toFormat('ccc d LLL');

export const weekdayLabel = (weekday: number): string => WEEKDAYS[weekday];

/**
 * The instant at which a wall-clock time occurs on a local date, or null if
 * that wall time does not exist there (a DST gap).
 */
export function wallTimeToInstant(
  date: string,
  minutes: number,
  tz: string,
): Date | null {
  const [y, mo, d] = date.split('-').map(Number);
  const dayOffset = Math.floor(minutes / 1440);
  const m = minutes % 1440;
  const base = DateTime.fromObject(
    { year: y, month: mo, day: d },
    { zone: tz },
  ).plus({ days: dayOffset });
  const dt = DateTime.fromObject(
    {
      year: base.year,
      month: base.month,
      day: base.day,
      hour: Math.floor(m / 60),
      minute: m % 60,
    },
    { zone: tz },
  );
  if (!dt.isValid || dt.hour !== Math.floor(m / 60) || dt.minute !== m % 60)
    return null;
  // Ambiguous wall times: luxon may pick the later offset; take the earlier instant.
  const earlier = dt.minus({ hours: 1 });
  if (
    earlier.hour === dt.hour &&
    earlier.minute === dt.minute &&
    earlier.day === dt.day
  ) {
    return earlier.toJSDate();
  }
  return dt.toJSDate();
}

/** Start and end (exclusive) instants of a local calendar day. */
export function localDayBounds(
  date: string,
  tz: string,
): { start: Date; end: Date } {
  const start = DateTime.fromISO(date, { zone: tz }).startOf('day');
  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
}

/**
 * Cut a wall-clock range on a local date into slots of `slotMinutes`, stepping
 * in wall time (what the doctor authored). Slots whose start falls in a DST
 * gap are skipped.
 */
export function expandRange(
  date: string,
  startMinutes: number,
  endMinutes: number,
  slotMinutes: number,
  tz: string,
): Array<{ startsAt: Date; endsAt: Date }> {
  const out: Array<{ startsAt: Date; endsAt: Date }> = [];
  for (let m = startMinutes; m + slotMinutes <= endMinutes; m += slotMinutes) {
    const startsAt = wallTimeToInstant(date, m, tz);
    const endsAt =
      wallTimeToInstant(date, m + slotMinutes, tz) ??
      (startsAt ? new Date(startsAt.getTime() + slotMinutes * 60_000) : null);
    if (!startsAt || !endsAt || endsAt <= startsAt) continue;
    out.push({ startsAt, endsAt });
  }
  return out;
}

/** Local minutes since midnight of an instant. */
export function localMinutes(instant: Date, tz: string): number {
  const dt = local(instant, tz);
  return dt.hour * 60 + dt.minute;
}

/** morning < 12:00 ≤ afternoon < 17:00 ≤ evening < 21:00 ≤ night (local). */
export function periodOf(instant: Date, tz: string): Period {
  const h = local(instant, tz).hour;
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

/** "6:00 PM" in the zone. */
export const formatTime12 = (instant: Date, tz: string): string =>
  local(instant, tz).toFormat('h:mm a');

/** ISO-8601 with the zone's offset: 2026-10-16T18:00:00.000+05:00. */
export const toZonedIso = (instant: Date, tz: string): string =>
  local(instant, tz).toISO()!;

/**
 * The card label for the next free slot, in the location's zone:
 *   "Available today, 6:00 PM" · "Available tomorrow from 2:00 PM" ·
 *   "Next available Thu 15 Oct".
 */
export function availabilityLabel(
  at: Date,
  tz: string,
  now: Date = new Date(),
): string {
  const day = localDate(at, tz);
  const today = todayIn(tz, now);
  if (day === today) return `Available today, ${formatTime12(at, tz)}`;
  if (day === addDays(today, 1))
    return `Available tomorrow from ${formatTime12(at, tz)}`;
  return `Next available ${shortDateLabel(day)}`;
}

/** Whole years between a year and now (for "12 years experience"). */
export const yearsSince = (year: number, now: Date = new Date()): number =>
  Math.max(0, now.getUTCFullYear() - year);
