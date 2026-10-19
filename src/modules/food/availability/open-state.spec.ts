import {
  openState,
  overlappingRanges,
  rangesOf,
  isWithinHours,
} from './open-state';
import { bandFor, deliveryQuote, etaLabel, etaMinutes } from './delivery-quote';

const TZ = 'Asia/Karachi';
/** A PKT wall time on a date → instant (PKT is UTC+5, no DST). */
const pkt = (date: string, hhmm: string) =>
  new Date(`${date}T${hhmm}:00+05:00`);
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

describe('open state', () => {
  const overnight = rangesOf(
    EVERY_DAY.map((weekday) => ({
      weekday,
      opensAt: '18:00',
      closesAt: '02:00',
    })),
  );

  it('18:00–02:00 is open at 01:00 and closed at 03:00 (QA #4)', () => {
    const at1 = openState({
      hours: overnight,
      closures: [],
      tz: TZ,
      now: pkt('2026-10-16', '01:00'),
    });
    expect(at1).toMatchObject({ open: true, label: 'Open until 2:00 AM' });
    const at3 = openState({
      hours: overnight,
      closures: [],
      tz: TZ,
      now: pkt('2026-10-16', '03:00'),
    });
    expect(at3).toMatchObject({ open: false, label: 'Opens 6:00 PM' });
    expect(at3.opensAt).toEqual(pkt('2026-10-16', '18:00'));
  });

  it('lunch and dinner ranges: closed between, open in each', () => {
    const split = rangesOf(
      EVERY_DAY.flatMap((weekday) => [
        { weekday, opensAt: '12:00', closesAt: '15:00' },
        { weekday, opensAt: '19:00', closesAt: '23:30' },
      ]),
    );
    const day = '2026-10-15';
    expect(
      openState({ hours: split, closures: [], tz: TZ, now: pkt(day, '13:00') })
        .label,
    ).toBe('Open until 3:00 PM');
    expect(
      openState({ hours: split, closures: [], tz: TZ, now: pkt(day, '16:00') })
        .label,
    ).toBe('Opens 7:00 PM');
    expect(
      openState({ hours: split, closures: [], tz: TZ, now: pkt(day, '23:45') })
        .label,
    ).toBe('Opens tomorrow 12:00 PM');
  });

  it('back-to-back ranges merge; closures and pause close it', () => {
    const joined = rangesOf([
      { weekday: 4, opensAt: '10:00', closesAt: '14:00' },
      { weekday: 4, opensAt: '14:00', closesAt: '22:00' },
    ]);
    const thu = '2026-10-15';
    expect(
      openState({ hours: joined, closures: [], tz: TZ, now: pkt(thu, '13:00') })
        .label,
    ).toBe('Open until 10:00 PM');
    const closure = { start: pkt(thu, '12:00'), end: pkt(thu, '16:00') };
    const closed = openState({
      hours: joined,
      closures: [closure],
      tz: TZ,
      now: pkt(thu, '13:00'),
    });
    expect(closed).toMatchObject({ open: false, label: 'Opens 4:00 PM' });
    expect(
      openState({
        hours: joined,
        closures: [],
        tz: TZ,
        now: pkt(thu, '13:00'),
        paused: true,
        pauseMessage: 'Back at 3',
      }),
    ).toMatchObject({ open: false, paused: true, label: 'Back at 3' });
    // Thursday-only hours: the next opening is a weekday name.
    expect(
      openState({ hours: joined, closures: [], tz: TZ, now: pkt(thu, '23:00') })
        .label,
    ).toBe('Opens Thu 10:00 AM');
    expect(
      openState({ hours: [], closures: [], tz: TZ, now: pkt(thu, '23:00') })
        .label,
    ).toBe('Closed');
  });

  it('scheduling checks a time against the hours; overlapping ranges are found (overnight too)', () => {
    expect(isWithinHours(overnight, [], TZ, pkt('2026-10-16', '01:30'))).toBe(
      true,
    );
    expect(isWithinHours(overnight, [], TZ, pkt('2026-10-16', '12:00'))).toBe(
      false,
    );
    expect(
      overlappingRanges(
        rangesOf([
          { weekday: 1, opensAt: '12:00', closesAt: '15:00' },
          { weekday: 1, opensAt: '14:00', closesAt: '16:00' },
        ]),
      ),
    ).not.toBeNull();
    expect(
      overlappingRanges(
        rangesOf([
          { weekday: 1, opensAt: '20:00', closesAt: '03:00' },
          { weekday: 2, opensAt: '02:00', closesAt: '05:00' },
        ]),
      ),
    ).not.toBeNull();
    expect(
      overlappingRanges(
        rangesOf([
          { weekday: 6, opensAt: '20:00', closesAt: '03:00' },
          { weekday: 0, opensAt: '02:00', closesAt: '05:00' },
        ]),
      ),
    ).not.toBeNull();
    expect(
      overlappingRanges(
        rangesOf([
          { weekday: 1, opensAt: '12:00', closesAt: '15:00' },
          { weekday: 1, opensAt: '15:00', closesAt: '23:00' },
        ]),
      ),
    ).toBeNull();
  });

  it('per-date hours (Ramadan) replace the weekly hours on those dates only', () => {
    const lunch = rangesOf(
      EVERY_DAY.map((weekday) => ({
        weekday,
        opensAt: '12:00',
        closesAt: '23:00',
      })),
    );
    const byDate = new Map([
      [
        '2026-10-17',
        [
          { opens: 120, closes: 300 }, // sehri 02:00–05:00
          { opens: 1020, closes: 1320 }, // iftar 17:00–22:00
        ],
      ],
    ]);
    const at = (d: string, t: string) =>
      isWithinHours(lunch, [], TZ, pkt(d, t), byDate);
    expect(at('2026-10-17', '03:00')).toBe(true);
    expect(at('2026-10-17', '13:00')).toBe(false);
    expect(at('2026-10-17', '18:00')).toBe(true);
    expect(at('2026-10-18', '13:00')).toBe(true);
    expect(at('2026-10-18', '03:00')).toBe(false);
    const s = openState({
      hours: lunch,
      closures: [],
      tz: TZ,
      now: pkt('2026-10-17', '13:00'),
      byDate,
    });
    expect(s).toMatchObject({ open: false, label: 'Opens 5:00 PM' });
  });
});

describe('delivery quote and ETA', () => {
  const bands = [
    { fromKm: 0, toKm: 3, fee: 99, minOrder: 500 },
    { fromKm: 3, toKm: 6, fee: 149, minOrder: 800 },
  ];

  it('fee bands by distance; past the last band the last applies; free over a threshold', () => {
    expect(bandFor(bands, 1.2)?.fee).toBe(99);
    expect(bandFor(bands, 3)?.fee).toBe(149);
    expect(bandFor(bands, 7)?.fee).toBe(149);
    expect(
      deliveryQuote({ bands, km: 4, freeDeliveryOver: 2000, subtotal: 1500 }),
    ).toMatchObject({ fee: 149, minOrder: 800 });
    expect(
      deliveryQuote({ bands, km: 4, freeDeliveryOver: 2000, subtotal: 2000 })
        .fee,
    ).toBe(0);
    expect(
      deliveryQuote({ bands: [], km: 4, freeDeliveryOver: null }),
    ).toMatchObject({ fee: 0, minOrder: 0 });
  });

  it('ETA = prep + busy + ride at 22 km/h + 5, as a 10-minute range; pickup is prep only', () => {
    const eta = etaMinutes({
      prepMinutes: 20,
      busyExtraMinutes: 0,
      km: 4.4,
      fulfilment: 'delivery',
    });
    expect(eta).toEqual({ min: 37, max: 47 });
    expect(etaLabel(eta)).toBe('37–47 min');
    expect(
      etaMinutes({
        prepMinutes: 20,
        busyExtraMinutes: 15,
        km: 4.4,
        fulfilment: 'delivery',
      }),
    ).toEqual({ min: 52, max: 62 });
    expect(
      etaMinutes({
        prepMinutes: 20,
        busyExtraMinutes: 0,
        km: 4.4,
        fulfilment: 'pickup',
      }),
    ).toEqual({ min: 20, max: 30 });
  });
});
