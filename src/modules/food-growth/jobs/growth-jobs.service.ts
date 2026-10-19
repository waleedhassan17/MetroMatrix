import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { TiffinService } from '../tiffin/tiffin.service';
import { CateringService } from '../catering/catering.service';
import { DemandService } from '../demand/demand.service';

/**
 * Food-growth scheduled work. Advisory-locked and idempotent like every job;
 * plain methods tests call with a fixed `now` (JOBS_ENABLED=false in tests).
 */
@Injectable()
export class GrowthJobsService {
  private readonly logger = new Logger(GrowthJobsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tiffin: TiffinService,
    private readonly config: ConfigService,
    private readonly cateringService: CateringService,
    private readonly demandService: DemandService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<boolean>('jobs.enabled') ?? true;
  }

  @Cron('0 */5 * * * *', { name: 'growth-tiffin' })
  async cronTiffin() {
    if (!this.enabled) return;
    await this.generateTiffin();
    await this.catering();
  }

  /** Catering: event-day orders (once each) and expired quotes. */
  async catering(now = new Date()) {
    let orders: string[] = [];
    let expired: Array<{ user_id: string; code: string }> = [];
    const counts = await this.run('growth:catering', async (m) => {
      orders = await this.cateringService.eventDayOrders(m, now);
      const e = await this.cateringService.expire(m, now);
      expired = e.quotes;
      return {
        orders: orders.length,
        expired: e.quotes.length,
        stale: e.stale,
      };
    });
    await this.cateringService.announce(orders, expired);
    return counts;
  }

  @Cron('10 0 * * *', { name: 'growth-daily', timeZone: 'Asia/Karachi' })
  async cronDaily() {
    if (this.enabled) await this.daily();
  }

  /** Tiffin orders for every day whose skip cut-off has passed — once per subscription and day. */
  async generateTiffin(now = new Date()) {
    let result: Awaited<ReturnType<TiffinService['generate']>> | null = null;
    const counts = await this.run('growth:tiffin', async (m) => {
      result = await this.tiffin.generate(m, now);
      return { orders: result.orders.length, skipped: result.skipped };
    });
    if (result) await this.tiffin.announce(result);
    return counts;
  }

  @Cron('45 2 * * *', { name: 'growth-demand', timeZone: 'Asia/Karachi' })
  async cronDemand() {
    if (this.enabled) await this.demand();
  }

  /** demand_cells for this week and last (rebuilt, so a rerun is harmless); old search events purged. */
  async demand(now = new Date()) {
    return this.run('growth:demand', (m) => this.demandService.rebuild(m, now));
  }

  async daily(now = new Date()) {
    return this.run('growth:daily', async (m) => ({
      ...(await this.tiffin.rollover(m, now)),
    }));
  }

  async run(
    name: string,
    work: (m: EntityManager) => Promise<Record<string, number>>,
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
