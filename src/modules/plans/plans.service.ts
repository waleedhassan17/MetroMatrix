import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BusinessPlan } from './entities/business-plan.entity';
import {
  PLAN_LIMIT_KEYS,
  PlanConfig,
  PlanEntitlementKey,
  PlanLimitKey,
  PlanOverrides,
  applyOverrides,
  getPlanConfig,
  isPlanKey,
} from './plan-config';
import { ErrorCode } from '../../common/errors/codes';

/** Counts a business's current use of one limit (registered by the owning module). */
export type UsageCounter = (
  m: EntityManager,
  businessId: string,
) => Promise<number>;

/** Runs inside the plan-change transaction with the new effective plan (e.g. rider seats). */
export type PlanChangedHook = (
  m: EntityManager,
  businessId: string,
  plan: PlanConfig,
) => Promise<void>;

const LIMIT_LABELS: Record<PlanLimitKey, string> = {
  brands: 'brand',
  branches: 'branch',
  riders: 'active rider',
  menu_items: 'menu item',
  promotions_active: 'active promotion',
};

/**
 * What a business's plan allows, and the one place limits are enforced
 * (`assertWithin` → 409 PLAN_LIMIT_REACHED). Every partner without a row is
 * on `community`; the row is created on first use.
 */
@Injectable()
export class PlanService {
  private readonly counters = new Map<PlanLimitKey, UsageCounter>();
  private readonly changedHooks: PlanChangedHook[] = [];

  constructor(private readonly dataSource: DataSource) {}

  registerCounter(key: PlanLimitKey, counter: UsageCounter): void {
    this.counters.set(key, counter);
  }

  onPlanChanged(hook: PlanChangedHook): void {
    this.changedHooks.push(hook);
  }

  /** The business's plan row, created as `community` if missing. */
  async ensure(m: EntityManager, businessId: string): Promise<BusinessPlan> {
    await m.query(
      `INSERT INTO business_plans (business_id, plan_key, started_at)
       VALUES ($1, 'community', now()) ON CONFLICT (business_id) DO NOTHING`,
      [businessId],
    );
    return m.findOneByOrFail(BusinessPlan, { businessId });
  }

  async effective(
    businessId: string,
    m: EntityManager = this.dataSource.manager,
  ) {
    const row = await this.ensure(m, businessId);
    return {
      row,
      plan: applyOverrides(getPlanConfig(row.planKey), row.overrides),
    };
  }

  async usage(businessId: string, m: EntityManager = this.dataSource.manager) {
    const out = {} as Record<PlanLimitKey, number>;
    for (const k of PLAN_LIMIT_KEYS) {
      const c = this.counters.get(k);
      out[k] = c ? await c(m, businessId) : 0;
    }
    return out;
  }

  /** `{ planKey, label, limits, usage, entitlements, startedAt, expiresAt, overrides }` */
  async view(businessId: string) {
    const { row, plan } = await this.effective(businessId);
    return {
      planKey: plan.key,
      label: plan.label,
      priceMinorUnits: plan.priceMinorUnits,
      currency: plan.currency,
      limits: plan.limits,
      usage: await this.usage(businessId),
      entitlements: plan.entitlements,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      overrides: row.overrides,
    };
  }

  /** 409 PLAN_LIMIT_REACHED when `nextCount` would exceed the plan's limit. */
  async assertWithin(
    m: EntityManager,
    businessId: string,
    key: PlanLimitKey,
    nextCount: number,
  ): Promise<void> {
    const { plan } = await this.effective(businessId, m);
    const limit = plan.limits[key];
    if (nextCount > limit) {
      throw new ConflictException({
        code: ErrorCode.PLAN_LIMIT_REACHED,
        message: `Your ${plan.label} plan allows ${limit} ${LIMIT_LABELS[key]}${limit === 1 ? '' : 's'}.`,
        details: { key, limit, used: nextCount - 1, planKey: plan.key },
      });
    }
  }

  /** 409 PLAN_LIMIT_REACHED when the plan doesn't include `key` (every key is on today). */
  async assertEntitled(
    m: EntityManager,
    businessId: string,
    key: PlanEntitlementKey,
  ): Promise<void> {
    const { plan } = await this.effective(businessId, m);
    if (!plan.entitlements[key]) {
      throw new ConflictException({
        code: ErrorCode.PLAN_LIMIT_REACHED,
        message: `Your ${plan.label} plan doesn't include ${key}.`,
        details: { entitlement: key, planKey: plan.key },
      });
    }
  }

  /** Admin change of plan and/or overrides; plan-change hooks run in the same transaction. */
  async change(
    businessId: string,
    patch: { planKey?: string; overrides?: PlanOverrides | null },
  ) {
    await this.dataSource.transaction(async (m) => {
      const row = await this.ensure(m, businessId);
      await m.query(`SELECT 1 FROM business_plans WHERE id = $1 FOR UPDATE`, [
        row.id,
      ]);
      const planKey =
        patch.planKey && isPlanKey(patch.planKey) ? patch.planKey : row.planKey;
      const overrides =
        patch.overrides === undefined ? row.overrides : (patch.overrides ?? {});
      await m.update(
        BusinessPlan,
        { id: row.id },
        {
          planKey,
          overrides,
          ...(planKey !== row.planKey ? { startedAt: new Date() } : {}),
        },
      );
      const plan = applyOverrides(getPlanConfig(planKey), overrides);
      for (const hook of this.changedHooks) await hook(m, businessId, plan);
    });
    return this.view(businessId);
  }
}
