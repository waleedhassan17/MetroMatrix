import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { PantryService } from './pantry.service';

/** My Kitchen's daily reminder run: advisory-locked and idempotent; tests call `reminders(now)`. */
@Injectable()
export class MyKitchenJobsService {
  private readonly logger = new Logger(MyKitchenJobsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly pantry: PantryService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 9 * * *', { name: 'my-kitchen-reminders', timeZone: 'Asia/Karachi' })
  async cron() {
    if (this.config.get<boolean>('jobs.enabled') ?? true)
      await this.reminders();
  }

  async reminders(now = new Date()) {
    const result = await this.dataSource.transaction(async (m) => {
      const [{ locked }] = await m.query(
        `SELECT pg_try_advisory_xact_lock(hashtext('my-kitchen:reminders')) AS locked`,
      );
      return locked ? this.pantry.remind(m, now) : null;
    });
    if (!result) return { skipped: true };
    await this.pantry.send(result.notices);
    const { notices: _n, ...counts } = result;
    this.logger.log(`my-kitchen:reminders: ${JSON.stringify(counts)}`);
    return counts;
  }
}
