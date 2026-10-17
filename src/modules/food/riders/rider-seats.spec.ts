import { planRiderSeats } from './rider-seats';
import {
  buildRiderUsernameBase,
  riderEmail,
  slugifyRiderName,
} from './rider-username';

const c = (
  userId: string,
  days: number,
  open = false,
  status: 'active' | 'plan_locked' = 'active',
) => ({
  userId,
  status,
  hasOpenDelivery: open,
  createdAt: new Date(Date.UTC(2026, 0, days)),
});

describe('rider seats (ported from FinMatrix)', () => {
  it('keeps a mid-delivery rider, then the longest-serving', () => {
    const plan = planRiderSeats([c('a', 1), c('b', 2), c('c', 3, true)], 1);
    expect(plan).toEqual({ lock: ['a', 'b'], unlock: [] });
  });

  it('restores locked riders first when the limit rises, oldest first', () => {
    const plan = planRiderSeats(
      [
        c('a', 1, false, 'plan_locked'),
        c('b', 2, false, 'plan_locked'),
        c('c', 3),
      ],
      2,
    );
    expect(plan).toEqual({ lock: ['c'], unlock: ['a', 'b'] });
    expect(planRiderSeats([c('a', 1, false, 'plan_locked')], 5)).toEqual({
      lock: [],
      unlock: ['a'],
    });
  });

  it('is deterministic on ties', () => {
    expect(planRiderSeats([c('y', 1), c('x', 1)], 1)).toEqual({
      lock: ['y'],
      unlock: [],
    });
  });
});

describe('rider usernames (ported from FinMatrix)', () => {
  it('builds <brand>.<first name>, folded and trimmed', () => {
    expect(slugifyRiderName('Imran Alí')).toBe('imranali');
    expect(
      buildRiderUsernameBase({
        brandSlug: 'Karahi House',
        fullName: 'Imran Alí Khan',
      }),
    ).toBe('karahihouse.imran');
    expect(
      buildRiderUsernameBase({
        brandSlug: 'karahi-house-lahore',
        fullName: 'Bilal',
      }),
    ).toBe('karahi-house-lahore.bilal');
    expect(buildRiderUsernameBase({ brandSlug: '', fullName: '' })).toBe(
      'rider.rider',
    );
  });

  it('gives riders an address nobody can deliver to', () => {
    expect(riderEmail('karahi-house.imran')).toBe(
      'karahi-house.imran@riders.metromatrix.invalid',
    );
  });
});
