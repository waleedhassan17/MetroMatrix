import {
  PLAN_CONFIG,
  applyOverrides,
  getPlanConfig,
  normalizePlan,
} from './plan-config';

describe('plan config', () => {
  it('community is free, never expires and allows everything', () => {
    const p = getPlanConfig('community');
    expect(p).toMatchObject({
      priceMinorUnits: 0,
      durationMonths: null,
      isOffered: true,
    });
    expect(p.limits).toEqual({
      brands: 1,
      branches: 1,
      riders: 25,
      menu_items: 1000,
      promotions_active: 10,
      ai_actions_month: 300,
      voice_minutes_month: 120,
    });
    expect(Object.values(p.entitlements).every(Boolean)).toBe(true);
  });

  it('unknown keys fall back to community', () => {
    expect(normalizePlan('gold')).toBe('community');
    expect(normalizePlan(null)).toBe('community');
  });

  it('overrides change only valid limits and entitlements, never the base', () => {
    const base = PLAN_CONFIG.community;
    const p = applyOverrides(base, {
      limits: { riders: 1, branches: -1, brands: 1.5 as number },
      entitlements: { insights: false },
    });
    expect(p.limits.riders).toBe(1);
    expect(p.limits.branches).toBe(1);
    expect(p.limits.brands).toBe(1);
    expect(p.entitlements.insights).toBe(false);
    expect(base.limits.riders).toBe(25);
    expect(applyOverrides(base, null)).toBe(base);
  });
});
