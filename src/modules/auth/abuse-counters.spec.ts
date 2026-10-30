import { lockedForSeconds } from './abuse-counters';

describe('lockedForSeconds', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const minutesAgo = (m: number) => new Date(now - m * 60_000);

  it('is 0 below the cap or with no window', () => {
    expect(lockedForSeconds(9, minutesAgo(1), 10, now)).toBe(0);
    expect(lockedForSeconds(10, null, 10, now)).toBe(0);
  });

  it('counts down to the end of the 15-minute window that began at the first failure', () => {
    expect(lockedForSeconds(10, minutesAgo(5), 10, now)).toBe(600);
    expect(lockedForSeconds(12, minutesAgo(14.5), 10, now)).toBe(30);
  });

  it('is 0 once the window has passed', () => {
    expect(lockedForSeconds(10, minutesAgo(15), 10, now)).toBe(0);
    expect(lockedForSeconds(50, minutesAgo(60), 10, now)).toBe(0);
  });
});
