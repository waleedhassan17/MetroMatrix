/**
 * PLAN CONFIG — the single, server-side source of truth for what a partner's
 * plan allows (ported from FinMatrix-Backend `billing/plan-config.ts`).
 * Amounts are in MINOR UNITS (paisa) as in FinMatrix, though nothing is
 * charged today: every Food vendor is on `community` (free, no expiry), and
 * nothing is paywalled. Paid plans later are a new entry here plus a billing
 * flow (docs/SUBSCRIPTIONS_LATER.md), not a rewrite.
 *
 * Per-vendor admin overrides live in `business_plans.overrides` and are
 * merged by `applyOverrides` — limits and entitlements only; the key, price
 * and duration are never overridable.
 */

export const PLAN_LIMIT_KEYS = [
  'brands',
  'branches',
  'riders',
  'menu_items',
  'promotions_active',
  // Chunk 5: AI is metered per business per calendar month (Asia/Karachi).
  'ai_actions_month',
  'voice_minutes_month',
] as const;
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export const PLAN_ENTITLEMENT_KEYS = [
  'riders',
  'promotions',
  'insights',
  'preorders',
] as const;
export type PlanEntitlementKey = (typeof PLAN_ENTITLEMENT_KEYS)[number];

export type PlanKey = 'community';
export const PLAN_KEYS: PlanKey[] = ['community'];

export interface PlanConfig {
  key: PlanKey;
  label: string;
  /** Total price in paisa for the whole duration (0 = free). */
  priceMinorUnits: number;
  /** null = never expires. */
  durationMonths: number | null;
  currency: 'PKR';
  /** Sold to new partners. */
  isOffered: boolean;
  limits: Record<PlanLimitKey, number>;
  entitlements: Record<PlanEntitlementKey, boolean>;
}

export const PLAN_CONFIG: Record<PlanKey, PlanConfig> = {
  community: {
    key: 'community',
    label: 'Community',
    priceMinorUnits: 0,
    durationMonths: null,
    currency: 'PKR',
    isOffered: true,
    limits: {
      // One brand and one branch per vendor at launch; chains come later.
      brands: 1,
      branches: 1,
      riders: 25,
      menu_items: 1000,
      promotions_active: 10,
      ai_actions_month: 300,
      voice_minutes_month: 120,
    },
    entitlements: {
      riders: true,
      promotions: true,
      insights: true,
      preorders: true,
    },
  },
};

/**
 * Customers have no business plan: their AI allowance is this constant
 * (recipe suggestions, voice search). Voice counts as one action each.
 */
export const CUSTOMER_AI_LIMITS = { ai_actions_month: 60 } as const;

/** What an admin may override for one vendor. */
export interface PlanOverrides {
  limits?: Partial<Record<PlanLimitKey, number>>;
  entitlements?: Partial<Record<PlanEntitlementKey, boolean>>;
}

export const isPlanKey = (v: unknown): v is PlanKey =>
  typeof v === 'string' && (PLAN_KEYS as string[]).includes(v);

/** Unknown or retired keys resolve to the free plan, as in FinMatrix. */
export const normalizePlan = (raw: string | null | undefined): PlanKey =>
  isPlanKey(raw) ? raw : 'community';

export function getPlanConfig(raw: string | null | undefined): PlanConfig {
  return PLAN_CONFIG[normalizePlan(raw)];
}

/** The plan with one vendor's overrides applied. Unknown keys are ignored. */
export function applyOverrides(
  base: PlanConfig,
  overrides: PlanOverrides | null | undefined,
): PlanConfig {
  if (!overrides) return base;
  const limits = { ...base.limits };
  for (const k of PLAN_LIMIT_KEYS) {
    const v = overrides.limits?.[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) limits[k] = v;
  }
  const entitlements = { ...base.entitlements };
  for (const k of PLAN_ENTITLEMENT_KEYS) {
    const v = overrides.entitlements?.[k];
    if (typeof v === 'boolean') entitlements[k] = v;
  }
  return { ...base, limits, entitlements };
}
