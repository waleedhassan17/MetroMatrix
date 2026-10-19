import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { KitchenAlertsService } from '../stock/kitchen-alerts.service';
import { CostingService } from '../costing/costing.service';
import { ForecastService } from '../forecast/forecast.service';
import { SurplusService } from '../surplus/surplus.service';
import { EngineeringService } from '../engineering/engineering.service';
import { addDays, todayIn } from '../../../common/time/time.util';
import { display } from '../stock/units';

type Work = (m: EntityManager) => Promise<Record<string, number>>;

/**
 * Kitchen scheduled work. Every job takes a transaction-scoped advisory lock
 * (a second dyno skips) and is idempotent; each is a plain method tests call
 * with a fixed `now` (JOBS_ENABLED=false in tests). Later phases add their
 * nightly steps to `nightly`.
 */
@Injectable()
export class KitchenJobsService {
  private readonly logger = new Logger(KitchenJobsService.name);
  readonly nightly: Array<{
    name: string;
    run: (now: Date) => Promise<unknown>;
  }> = [];

  constructor(
    private readonly dataSource: DataSource,
    private readonly alerts: KitchenAlertsService,
    private readonly costing: CostingService,
    private readonly config: ConfigService,
    private readonly forecasts: ForecastService,
    private readonly surplus: SurplusService,
    private readonly engineering: EngineeringService,
  ) {
    this.nightly.push(
      { name: 'forecasts', run: (now) => this.forecastAll(now) },
      { name: 'cost-snapshots', run: (now) => this.costSnapshots(now) },
      { name: 'experiments', run: (now) => this.experiments(now) },
    );
  }

  /** Menu experiments whose last day has passed: the result, stored once. */
  async experiments(now = new Date()) {
    return this.run('kitchen:experiments', (m) =>
      this.engineering.completeDue(m, now),
    );
  }

  /** Every live kitchen: yesterday's accuracy, then the next 7 days. One lock per kitchen. */
  async forecastAll(now = new Date()) {
    const branches: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM branches WHERE status = 'active' ORDER BY id`,
    );
    let rows = 0;
    for (const b of branches) {
      const r = await this.forecastBranch(b.id, now);
      rows += typeof r.rows === 'number' ? r.rows : 0;
    }
    return { branches: branches.length, rows };
  }

  async forecastBranch(branchId: string, now = new Date()) {
    return this.run(`kitchen:forecast:${branchId}`, async (m) => {
      const mape = await this.forecasts.accuracy(m, branchId, now);
      const rows = await this.forecasts.generate(m, branchId, now);
      return { rows, scored: mape === null ? 0 : 1 };
    });
  }

  private get enabled(): boolean {
    return this.config.get<boolean>('jobs.enabled') ?? true;
  }

  @Cron('20 * * * * *', { name: 'kitchen-alerts' })
  async cronAlerts() {
    if (this.enabled) await this.alerts.flush();
  }

  @Cron('0 */5 * * * *', { name: 'kitchen-surplus-expiry' })
  async cronSurplus() {
    if (this.enabled) await this.expireSurplus();
  }

  @Cron('0 */15 * * * *', { name: 'kitchen-expiry-alerts' })
  async cronExpiry() {
    if (!this.enabled) return;
    await this.expiryAlerts();
    await this.alerts.flush();
  }

  /** Bachat Boxes past their pickup window, unsold → expired. */
  async expireSurplus(now = new Date()) {
    return this.run('kitchen:surplus-expiry', async (m) => ({
      expired: await this.surplus.expire(m, now),
    }));
  }

  /**
   * Stock about to expire: one alert at 3 days, one at 1 day, one when past
   * its date — per batch, each once (stock_batches.expiry_alerted 3 → 1 → -1).
   * Expired stock is flagged, never written off automatically.
   */
  async expiryAlerts(now = new Date()) {
    return this.run('kitchen:expiry-alerts', async (m) => {
      const rows: Array<{
        id: string;
        branch_id: string;
        timezone: string;
        name: string;
        base_unit: 'g' | 'ml' | 'piece';
        ingredient_id: string;
        qty_remaining: string;
        expires_on: string;
        expiry_alerted: number;
      }> = await m.query(
        `SELECT sb.id, ki.branch_id, br.timezone, ki.name, ki.base_unit, ki.id AS ingredient_id, sb.qty_remaining,
                to_char(sb.expires_on, 'YYYY-MM-DD') AS expires_on, sb.expiry_alerted
           FROM stock_batches sb JOIN kitchen_ingredients ki ON ki.id = sb.ingredient_id
           JOIN branches br ON br.id = ki.branch_id
          WHERE sb.qty_remaining > 0 AND sb.expires_on IS NOT NULL AND sb.expiry_alerted <> -1
            AND sb.expires_on <= ($1::timestamptz AT TIME ZONE br.timezone)::date + 3
          ORDER BY sb.expires_on FOR UPDATE OF sb SKIP LOCKED`,
        [now],
      );
      const counts = { three: 0, one: 0, expired: 0 };
      for (const b of rows) {
        const today = todayIn(b.timezone, now);
        const days = Math.round(
          (Date.parse(b.expires_on) - Date.parse(today)) / 86_400_000,
        );
        const level = days < 0 ? -1 : days <= 1 ? 1 : 3;
        // Levels go 0 → 3 → 1 → -1; never back.
        const rank = (l: number) =>
          l === 0 ? 0 : l === 3 ? 1 : l === 1 ? 2 : 3;
        if (rank(level) <= rank(b.expiry_alerted)) continue;
        const d = display(Number(b.qty_remaining), b.base_unit);
        const when =
          level === -1
            ? 'is past its date'
            : days === 0
              ? 'expires today'
              : days === 1
                ? 'expires tomorrow'
                : `expires in ${days} days`;
        await this.alerts.queue(
          m,
          b.branch_id,
          level === -1 ? 'expired' : 'expiring',
          `${b.name} ${when}`,
          level === -1
            ? `${d.qty} ${d.unit} past ${b.expires_on}. Check it, then log it as waste if it can't be used.`
            : `${d.qty} ${d.unit} (expires ${b.expires_on}). Use it first, or put it in today's specials or a Bachat Box.`,
          {
            ingredientId: b.ingredient_id,
            batchId: b.id,
            screen: 'kitchen.stock',
            until: addDays(today, Math.max(days, 0)),
          },
        );
        await m.query(
          `UPDATE stock_batches SET expiry_alerted = $2, updated_at = now() WHERE id = $1`,
          [b.id, level],
        );
        if (level === 3) counts.three++;
        else if (level === 1) counts.one++;
        else counts.expired++;
      }
      return counts;
    });
  }

  @Cron('30 2 * * *', { name: 'kitchen-nightly', timeZone: 'Asia/Karachi' })
  async cronNightly() {
    if (this.enabled) await this.runNightly();
  }

  async runNightly(now = new Date()) {
    const out: Record<string, unknown> = {};
    for (const step of this.nightly) {
      try {
        out[step.name] = await step.run(now);
      } catch (err) {
        this.logger.error(
          `kitchen nightly ${step.name}: ${(err as Error).message}`,
        );
        out[step.name] = { error: true };
      }
    }
    return out;
  }

  /** This week's cost baseline for every kitchen with a recipe card (once a week per dish and size). */
  async costSnapshots(now = new Date()) {
    return this.run('kitchen:cost-snapshots', async (m) => {
      const branches: Array<{ branch_id: string; brand_id: string }> =
        await m.query(
          `SELECT DISTINCT br.id AS branch_id, br.brand_id FROM branches br
           JOIN menu_items mi ON mi.brand_id = br.brand_id
           JOIN recipe_cards rc ON rc.menu_item_id = mi.id`,
        );
      let rows = 0;
      for (const b of branches)
        rows += await this.costing.snapshot(
          m,
          { branchId: b.branch_id, brandId: b.brand_id },
          now,
        );
      return { branches: branches.length, rows };
    });
  }

  async run(
    name: string,
    work: Work,
  ): Promise<Record<string, number | boolean>> {
    const result = await this.dataSource.transaction(async (m) => {
      const [{ locked }] = await m.query(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
        [name],
      );
      return locked ? work(m) : null;
    });
    if (!result) {
      this.logger.log(`${name}: another instance is running it; skipped`);
      return { skipped: true };
    }
    this.logger.log(`${name}: ${JSON.stringify(result)}`);
    return result;
  }
}
