import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { KitchenAlertsService } from '../stock/kitchen-alerts.service';
import { CostingService } from '../costing/costing.service';

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
  ) {
    this.nightly.push({
      name: 'cost-snapshots',
      run: (now) => this.costSnapshots(now),
    });
  }

  private get enabled(): boolean {
    return this.config.get<boolean>('jobs.enabled') ?? true;
  }

  @Cron('20 * * * * *', { name: 'kitchen-alerts' })
  async cronAlerts() {
    if (this.enabled) await this.alerts.flush();
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
