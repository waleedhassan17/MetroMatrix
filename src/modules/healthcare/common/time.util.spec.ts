import {
  addDays,
  availabilityLabel,
  expandRange,
  formatTime12,
  localDate,
  localDayBounds,
  parseTime,
  periodOf,
  toZonedIso,
  wallTimeToInstant,
  weekdayOf,
} from './time.util';

const PKT = 'Asia/Karachi';
const NY = 'America/New_York';

describe('healthcare time util', () => {
  it('runs with the process in UTC (as on Heroku)', () => {
    expect(new Date('2026-10-16T00:00:00Z').getTimezoneOffset()).toBe(0);
  });

  it('turns Karachi wall time into the right instant (UTC+5, no DST)', () => {
    expect(
      wallTimeToInstant('2026-10-16', parseTime('18:00'), PKT)!.toISOString(),
    ).toBe('2026-10-16T13:00:00.000Z');
    expect(
      wallTimeToInstant('2026-06-16', parseTime('09:30'), PKT)!.toISOString(),
    ).toBe('2026-06-16T04:30:00.000Z');
    expect(toZonedIso(new Date('2026-10-16T13:00:00Z'), PKT)).toBe(
      '2026-10-16T18:00:00.000+05:00',
    );
  });

  it('knows the local date, weekday and day bounds', () => {
    // 20:30 UTC on the 15th is already the 16th in Karachi.
    expect(localDate(new Date('2026-10-15T20:30:00Z'), PKT)).toBe('2026-10-16');
    expect(weekdayOf('2026-10-16')).toBe(5); // Friday
    expect(weekdayOf('2026-10-18')).toBe(0); // Sunday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    const { start, end } = localDayBounds('2026-10-16', PKT);
    expect([start.toISOString(), end.toISOString()]).toEqual([
      '2026-10-15T19:00:00.000Z',
      '2026-10-16T19:00:00.000Z',
    ]);
  });

  it('expands a range into slots and buckets them by local period', () => {
    const slots = expandRange(
      '2026-10-16',
      parseTime('11:30'),
      parseTime('12:30'),
      15,
      PKT,
    );
    expect(slots.map((s) => formatTime12(s.startsAt, PKT))).toEqual([
      '11:30 AM',
      '11:45 AM',
      '12:00 PM',
      '12:15 PM',
    ]);
    expect(slots.map((s) => periodOf(s.startsAt, PKT))).toEqual([
      'morning',
      'morning',
      'afternoon',
      'afternoon',
    ]);
    expect(
      periodOf(wallTimeToInstant('2026-10-16', parseTime('17:00'), PKT)!, PKT),
    ).toBe('evening');
    expect(
      periodOf(wallTimeToInstant('2026-10-16', parseTime('21:00'), PKT)!, PKT),
    ).toBe('night');
    // A slot that doesn't fit is dropped.
    expect(
      expandRange(
        '2026-10-16',
        parseTime('09:00'),
        parseTime('09:20'),
        15,
        PKT,
      ),
    ).toHaveLength(1);
  });

  it('spring forward: wall times in the gap produce no slot', () => {
    // 2026-03-08 02:00 → 03:00 in New York.
    expect(wallTimeToInstant('2026-03-08', parseTime('02:30'), NY)).toBeNull();
    const slots = expandRange(
      '2026-03-08',
      parseTime('01:00'),
      parseTime('04:00'),
      30,
      NY,
    );
    expect(slots.map((s) => formatTime12(s.startsAt, NY))).toEqual([
      '1:00 AM',
      '1:30 AM',
      '3:00 AM',
      '3:30 AM',
    ]);
    // 1:30 AM EST is 06:30Z; 3:00 AM EDT is 07:00Z.
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-03-08T06:00:00.000Z',
      '2026-03-08T06:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T07:30:00.000Z',
    ]);
  });

  it('fall back: an ambiguous wall time resolves to its first occurrence', () => {
    // 2026-11-01 02:00 EDT → 01:00 EST; 01:30 happens twice.
    expect(
      wallTimeToInstant('2026-11-01', parseTime('01:30'), NY)!.toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
    const slots = expandRange(
      '2026-11-01',
      parseTime('00:30'),
      parseTime('02:30'),
      30,
      NY,
    );
    expect(slots.map((s) => formatTime12(s.startsAt, NY))).toEqual([
      '12:30 AM',
      '1:00 AM',
      '1:30 AM',
      '2:00 AM',
    ]);
  });

  it('labels the next free slot in the location zone, whatever the server zone', () => {
    const now = new Date('2026-10-16T05:00:00Z'); // 10:00 in Karachi
    expect(availabilityLabel(new Date('2026-10-16T13:00:00Z'), PKT, now)).toBe(
      'Available today, 6:00 PM',
    );
    expect(availabilityLabel(new Date('2026-10-17T09:00:00Z'), PKT, now)).toBe(
      'Available tomorrow from 2:00 PM',
    );
    expect(availabilityLabel(new Date('2026-10-22T05:00:00Z'), PKT, now)).toBe(
      'Next available Thu 22 Oct',
    );
    // 21:00 UTC on the 16th is the 17th in Karachi → "tomorrow".
    expect(availabilityLabel(new Date('2026-10-16T21:00:00Z'), PKT, now)).toBe(
      'Available tomorrow from 2:00 AM',
    );
  });
});
