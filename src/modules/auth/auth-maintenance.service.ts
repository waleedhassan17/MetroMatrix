import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { TokenService } from './token.service';
import { IdempotencyRecord } from '../../common/interceptors/idempotency-record.entity';

/**
 * Daily housekeeping for the auth tables. Every row it deletes is already
 * meaningless: expired denylist entries (the JWT is rejected by `exp`
 * anyway), long-dead refresh tokens, stale idempotency records.
 */
@Injectable()
export class AuthMaintenanceService {
  private readonly logger = new Logger(AuthMaintenanceService.name);

  constructor(
    private readonly tokens: TokenService,
    @InjectRepository(IdempotencyRecord)
    private readonly idempotencyRepo: Repository<IdempotencyRecord>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'auth-maintenance' })
  async prune(): Promise<Record<string, number>> {
    const tokens = await this.tokens.prune();
    const idempotency = await this.idempotencyRepo.delete({
      createdAt: LessThan(new Date(Date.now() - 86_400_000)),
    });
    const counts = { ...tokens, idempotency: idempotency.affected ?? 0 };
    this.logger.log(`Pruned ${JSON.stringify(counts)}`);
    return counts;
  }
}
