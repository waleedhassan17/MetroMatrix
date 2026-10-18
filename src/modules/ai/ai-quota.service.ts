import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DateTime } from 'luxon';
import { PlanService } from '../plans/plans.service';
import { CUSTOMER_AI_LIMITS } from '../plans/plan-config';

export interface AiActor {
  /** Set for vendor calls: the business's plan meters them. */
  businessId: string | null;
  userId: string;
}

export interface QuotaRefusal {
  key: 'ai_actions_month' | 'voice_minutes_month';
  limit: number;
  resetsOn: string;
}

const TZ = 'Asia/Karachi';
/** Rows that cost something this month. */
const COUNTED = `NOT cached AND status <> 'quota'`;

/** Calendar months in Pakistan time; the allowance resets on the 1st. */
export function monthWindow(now: Date): { start: Date; resetsOn: string } {
  const start = DateTime.fromJSDate(now, { zone: TZ }).startOf('month');
  return {
    start: start.toJSDate(),
    resetsOn: start.plus({ months: 1 }).toISODate()!,
  };
}

/**
 * AI allowances: vendors by their plan (`ai_actions_month`,
 * `voice_minutes_month`, admin-overridable), customers by a constant.
 */
@Injectable()
export class AiQuotaService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly plans: PlanService,
  ) {}

  onModuleInit(): void {
    this.plans.registerCounter('ai_actions_month', async (m, businessId) =>
      this.actionsUsed(m, { businessId, userId: '' }, new Date()),
    );
    this.plans.registerCounter('voice_minutes_month', async (m, businessId) =>
      Math.ceil((await this.voiceSecondsUsed(m, businessId, new Date())) / 60),
    );
  }

  async actionsUsed(
    m: EntityManager,
    actor: AiActor,
    now: Date,
  ): Promise<number> {
    const { start } = monthWindow(now);
    const [{ n }] = actor.businessId
      ? await m.query(
          `SELECT count(*)::int AS n FROM ai_usage WHERE business_id = $1 AND created_at >= $2 AND ${COUNTED}`,
          [actor.businessId, start],
        )
      : await m.query(
          `SELECT count(*)::int AS n FROM ai_usage WHERE user_id = $1 AND business_id IS NULL AND created_at >= $2 AND ${COUNTED}`,
          [actor.userId, start],
        );
    return n;
  }

  async voiceSecondsUsed(
    m: EntityManager,
    businessId: string,
    now: Date,
  ): Promise<number> {
    const { start } = monthWindow(now);
    const [{ s }] = await m.query(
      `SELECT coalesce(sum(audio_seconds), 0)::int AS s FROM ai_usage
        WHERE business_id = $1 AND feature = 'voice' AND created_at >= $2 AND ${COUNTED}`,
      [businessId, start],
    );
    return s;
  }

  private async limits(actor: AiActor) {
    if (!actor.businessId)
      return {
        actions: CUSTOMER_AI_LIMITS.ai_actions_month,
        voiceMinutes: null,
      };
    const { plan } = await this.plans.effective(actor.businessId);
    return {
      actions: plan.limits.ai_actions_month,
      voiceMinutes: plan.limits.voice_minutes_month,
    };
  }

  /** Null when one more call (of `audioSeconds`) fits this month, else why not. */
  async refusal(
    actor: AiActor,
    audioSeconds = 0,
    now = new Date(),
  ): Promise<QuotaRefusal | null> {
    const m = this.dataSource.manager;
    const { resetsOn } = monthWindow(now);
    const lim = await this.limits(actor);
    if ((await this.actionsUsed(m, actor, now)) + 1 > lim.actions)
      return { key: 'ai_actions_month', limit: lim.actions, resetsOn };
    if (audioSeconds > 0 && actor.businessId && lim.voiceMinutes !== null) {
      const used = await this.voiceSecondsUsed(m, actor.businessId, now);
      if (used + audioSeconds > lim.voiceMinutes * 60)
        return {
          key: 'voice_minutes_month',
          limit: lim.voiceMinutes,
          resetsOn,
        };
    }
    return null;
  }

  async summary(actor: AiActor, now = new Date()) {
    const m = this.dataSource.manager;
    const lim = await this.limits(actor);
    const { resetsOn } = monthWindow(now);
    return {
      aiActions: {
        used: await this.actionsUsed(m, actor, now),
        limit: lim.actions,
      },
      voiceMinutes:
        actor.businessId && lim.voiceMinutes !== null
          ? {
              used: Math.ceil(
                (await this.voiceSecondsUsed(m, actor.businessId, now)) / 60,
              ),
              limit: lim.voiceMinutes,
            }
          : null,
      resetsOn,
    };
  }
}
