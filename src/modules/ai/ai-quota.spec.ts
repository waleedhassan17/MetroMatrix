import { monthWindow } from './ai-quota.service';

describe('AI allowance month', () => {
  it('is the calendar month in Pakistan time', () => {
    // 2026-10-31 20:00 UTC is already 1 November in Karachi (UTC+5).
    expect(monthWindow(new Date('2026-10-31T20:00:00Z'))).toEqual({
      start: new Date('2026-10-31T19:00:00Z'),
      resetsOn: '2026-12-01',
    });
    expect(monthWindow(new Date('2026-10-15T10:00:00Z')).resetsOn).toBe(
      '2026-11-01',
    );
    expect(monthWindow(new Date('2026-12-20T10:00:00Z')).resetsOn).toBe(
      '2027-01-01',
    );
  });
});
