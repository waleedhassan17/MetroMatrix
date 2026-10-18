import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { KitchenAlertsService } from '../stock/kitchen-alerts.service';

/**
 * Kitchen scheduled work (P1: the alert outbox safety net). Every job is a
 * plain method tests call directly; JOBS_ENABLED=false in tests.
 */
@Injectable()
export class KitchenJobsService {
  constructor(
    private readonly alerts: KitchenAlertsService,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<boolean>('jobs.enabled') ?? true;
  }

  @Cron('20 * * * * *', { name: 'kitchen-alerts' })
  async cronAlerts() {
    if (this.enabled) await this.alerts.flush();
  }
}
