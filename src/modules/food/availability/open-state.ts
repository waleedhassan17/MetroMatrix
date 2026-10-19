import {
  addDays,
  formatTime12,
  localDate,
  parseTime,
  wallTimeToInstant,
  weekdayOf,
} from '../../../common/time/time.util';

/** One weekly range in minutes since midnight. `closes <= opens` runs past midnight. */
export interface HoursRange {
  weekday: number;
  opens: number;
  closes: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface OpenState {
  open: boolean;
  paused: boolean;
  /** When the current open stretch ends (open) — contiguous ranges merged. */
  closesAt: Date | null;
  /** The next opening (closed), within the next 7 days. */
  opensAt: Date | null;
  /** "Open until 2:00 AM" · "Opens 6:00 PM" · "Opens tomorrow 12:00 PM" · "Opens Thu 12:00 PM" · "Closed" · pause message */
  label: string;
}

/** "18:00" → 1080; "24:00" → 1440. */
export const toMinutes = (t: string) => parseTime(t.slice(0, 5));

export function rangesOf(
  rows: Array<{ weekday: number; opensAt: string; closesAt: string }>,
): HoursRange[] {
  return rows.map((r) => ({
    weekday: r.weekday,
    opens: toMinutes(r.opensAt),
    closes: toMinutes(r.closesAt),
  }));
}

/**
 * Hours for particular dates that replace the weekly hours on those dates
 * (Chunk 5: Ramadan's sehri and iftar windows). Minutes from midnight.
 */
export type DateHours = Map<string, Array<{ opens: number; closes: number }>>;

/**
 * Open intervals (instants) for local dates `from-1` … `from+days`, closures
 * subtracted, contiguous stretches merged; `byDate` replaces a date's weekly hours. The day before is included so an
 * overnight range that started yesterday still counts at 01:00 today.
 */
export function openIntervals(
  hours: HoursRange[],
  closures: Interval[],
  tz: string,
  fromDate: string,
  days: number,
  byDate?: DateHours,
): Interval[] {
  const raw: Interval[] = [];
  for (let i = -1; i <= days; i++) {
    const date = addDays(fromDate, i);
    const wd = weekdayOf(date);
    const ranges = byDate?.get(date) ?? hours.filter((h) => h.weekday === wd);
    for (const r of ranges) {
      const endMinutes = r.closes > r.opens ? r.closes : r.closes + 1440;
      const start = wallTimeToInstant(date, r.opens, tz);
      const end = wallTimeToInstant(date, endMinutes, tz);
      if (start && end && end > start) raw.push({ start, end });
    }
  }
  raw.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end > last.end) last.end = iv.end;
    } else merged.push({ ...iv });
  }
  return subtract(merged, closures);
}

function subtract(intervals: Interval[], cuts: Interval[]): Interval[] {
  let out = intervals;
  for (const c of cuts) {
    const next: Interval[] = [];
    for (const iv of out) {
      if (c.end <= iv.start || c.start >= iv.end) {
        next.push(iv);
        continue;
      }
      if (c.start > iv.start) next.push({ start: iv.start, end: c.start });
      if (c.end < iv.end) next.push({ start: c.end, end: iv.end });
    }
    out = next;
  }
  return out;
}

/** Is it open now, until when, or when does it open next — and the label to show. */
export function openState(opts: {
  hours: HoursRange[];
  closures: Interval[];
  tz: string;
  now: Date;
  paused?: boolean;
  pauseMessage?: string | null;
  byDate?: DateHours;
}): OpenState {
  const today = localDate(opts.now, opts.tz);
  const intervals = openIntervals(
    opts.hours,
    opts.closures,
    opts.tz,
    today,
    7,
    opts.byDate,
  );
  const t = opts.now.getTime();
  const current = intervals.find(
    (iv) => iv.start.getTime() <= t && t < iv.end.getTime(),
  );
  const next = intervals.find((iv) => iv.start.getTime() > t) ?? null;
  if (opts.paused) {
    return {
      open: false,
      paused: true,
      closesAt: null,
      opensAt: null,
      label: opts.pauseMessage?.trim() || 'Not taking orders right now',
    };
  }
  if (current) {
    return {
      open: true,
      paused: false,
      closesAt: current.end,
      opensAt: null,
      label: `Open until ${formatTime12(current.end, opts.tz)}`,
    };
  }
  return {
    open: false,
    paused: false,
    closesAt: null,
    opensAt: next?.start ?? null,
    label: next
      ? `Opens ${dayWord(next.start, opts.tz, opts.now)}${formatTime12(next.start, opts.tz)}`
      : 'Closed',
  };
}

function dayWord(at: Date, tz: string, now: Date) {
  const d = localDate(at, tz);
  const today = localDate(now, tz);
  if (d === today) return '';
  if (d === addDays(today, 1)) return 'tomorrow ';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${names[weekdayOf(d)]} `;
}

/** Is `at` inside the weekly hours (and outside closures)? For scheduled orders. */
export function isWithinHours(
  hours: HoursRange[],
  closures: Interval[],
  tz: string,
  at: Date,
  byDate?: DateHours,
): boolean {
  const date = localDate(at, tz);
  return openIntervals(hours, closures, tz, date, 1, byDate).some(
    (iv) =>
      iv.start.getTime() <= at.getTime() && at.getTime() < iv.end.getTime(),
  );
}

/** Two ranges on the same weekday (overnight spill included) may not overlap. */
export function overlappingRanges(
  hours: HoursRange[],
): [HoursRange, HoursRange] | null {
  const spans = hours.map((h) => {
    const start = h.weekday * 1440 + h.opens;
    const end =
      h.weekday * 1440 + (h.closes > h.opens ? h.closes : h.closes + 1440);
    return { h, start, end };
  });
  const week = 7 * 1440;
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i];
      const b = spans[j];
      for (const shift of [-week, 0, week]) {
        if (a.start < b.end + shift && b.start + shift < a.end)
          return [a.h, b.h];
      }
    }
  }
  return null;
}
