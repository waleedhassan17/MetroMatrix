import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { TiffinService } from '../tiffin/tiffin.service';

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
  ) {}

  private get enabled(): boolean {
    return this.config.get<boolean>('jobs.enabled') ?? true;
  }

  @Cron('0 */5 * * * *', { name: 'growth-tiffin' })
  async cronTiffin() {
    if (this.enabled) await this.generateTiffin();
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
