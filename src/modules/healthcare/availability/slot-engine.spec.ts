import { buildDays, firstFreeSlot, EngineInput } from './slot-engine';
import { parseTime, wallTimeToInstant } from '../common/time.util';

const PKT = 'Asia/Karachi';
const at = (date: string, hhmm: string, tz = PKT) =>
  wallTimeToInstant(date, parseTime(hhmm), tz)!;
// Friday 16 Oct 2026, 10:00 in Karachi.
const NOW = at('2026-10-16', '10:00');

const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  tz: PKT,
  fromDate: '2026-10-16',
  days: 3,
  now: NOW,
  minNoticeMinutes: 60,
  bookingWindowDays: 14,
  slotMinutes: 30,
  // Every day 09:00–13:00 and 17:00–22:00.
  ranges: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
    { weekday, start: parseTime('09:00'), end: parseTime('13:00') },
    { weekday, start: parseTime('17:00'), end: parseTime('22:00') },
  ]),
  blocked: [],
  ...over,
});

const times = (d: { slots: Array<{ startsAt: Date }> }) =>
  d.slots.map((s) =>
    s.startsAt.toLocaleTimeString('en-GB', {
      timeZone: PKT,
      hour: '2-digit',
      minute: '2-digit',
    }),
  );

describe('slot engine', () => {
  it('expands weekly ranges into slots and drops those inside the notice period', () => {
    const [today, tomorrow] = buildDays(base());
    expect(today).toMatchObject({
      date: '2026-10-16',
      weekday: 5,
      weekdayLabel: 'Fri',
      isAvailable: true,
    });
    // Now 10:00 + 60 min notice: 11:00 is the first bookable slot today.
    expect(times(today)).toEqual([
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '17:00',
      '17:30',
      '18:00',
      '18:30',
      '19:00',
      '19:30',
      '20:00',
      '20:30',
      '21:00',
      '21:30',
    ]);
    expect(times(tomorrow)[0]).toBe('09:00');
    expect(tomorrow.slots).toHaveLength(18);
  });

  it('buckets slots by local period', () => {
    const [today] = buildDays(base());
    const byPeriod = (p: string) =>
      today.slots.filter((s) => s.period === p).length;
    expect([
      byPeriod('morning'),
      byPeriod('afternoon'),
      byPeriod('evening'),
      byPeriod('night'),
    ]).toEqual([2, 2, 8, 2]);
  });

  it('never offers past dates or anything beyond the booking window', () => {
    const past = buildDays(base({ fromDate: '2026-10-10', days: 1 }));
    expect(past[0].date).toBe('2026-10-16'); // clamped to today
    // Window 3 days: 16, 17, 18 bookable; 19 is not.
    const days = buildDays(base({ bookingWindowDays: 3, days: 5 }));
    expect(days.map((d) => [d.date, d.isAvailable])).toEqual([
      ['2026-10-16', true],
      ['2026-10-17', true],
      ['2026-10-18', true],
      ['2026-10-19', false],
      ['2026-10-20', false],
    ]);
  });

  it('drops slots inside time off and a whole day off shows isAvailable false', () => {
    const friday = {
      start: at('2026-10-23', '00:00'),
      end: at('2026-10-24', '00:00'),
    };
    const days = buildDays(
      base({ fromDate: '2026-10-22', days: 3, blocked: [friday] }),
    );
    expect(days.map((d) => [d.weekdayLabel, d.isAvailable])).toEqual([
      ['Thu', true],
      ['Fri', false],
      ['Sat', true],
    ]);
    const lunch = {
      start: at('2026-10-17', '11:15'),
      end: at('2026-10-17', '12:00'),
    };
    const [, sat] = buildDays(base({ blocked: [lunch] }));
    expect(times(sat).slice(0, 6)).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '12:00',
      '12:30',
    ]);
  });

  it('a booking at another location blocks the same time here (the doctor is in one place)', () => {
    const elsewhere = {
      start: at('2026-10-17', '17:00'),
      end: at('2026-10-17', '17:15'),
    };
    const [, sat] = buildDays(base({ blocked: [elsewhere] }));
    expect(times(sat)).not.toContain('17:00');
    expect(times(sat)).toContain('17:30');
  });

  it('respects slot length and finds the first free slot', () => {
    const [today] = buildDays(base({ slotMinutes: 45 }));
    expect(times(today).slice(0, 2)).toEqual(['11:15', '12:00']);
    const first = firstFreeSlot({ ...base(), blocked: [] });
    expect(first!.startsAt.toISOString()).toBe(
      at('2026-10-16', '11:00').toISOString(),
    );
    // Fully booked window → null.
    expect(
      firstFreeSlot({
        ...base({ bookingWindowDays: 1 }),
        blocked: [{ start: NOW, end: at('2026-10-17', '00:00') }],
      }),
    ).toBeNull();
  });

  it('works in a DST zone: no slot in the spring-forward gap', () => {
    const NY = 'America/New_York';
    const days = buildDays({
      ...base(),
      tz: NY,
      fromDate: '2026-03-08',
      days: 1,
      now: wallTimeToInstant('2026-03-07', parseTime('12:00'), NY)!,
      minNoticeMinutes: 0,
      ranges: [
        { weekday: 0, start: parseTime('01:00'), end: parseTime('04:00') },
      ],
    });
    expect(days[0].slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-03-08T06:00:00.000Z',
      '2026-03-08T06:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T07:30:00.000Z',
    ]);
  });
});
