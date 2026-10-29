import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AdminBroadcast } from './entities/admin-broadcast.entity';
import { audienceWhere, BroadcastAudience } from './broadcast-audience';
import { BroadcastView, CreateBroadcastDto } from './broadcasts.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { UserDevice } from '../users/entities/user-device.entity';
import { User } from '../users/entities/user.entity';
import { ServiceType } from '../businesses/business-types';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { ErrorCode } from '../../common/errors/codes';
import { PaginationQueryDto, paged } from '../../common/pagination/pagination';

const BATCH = 100;
/** Per admin, on top of the route throttle. */
const MAX_PER_HOUR = 5;

/**
 * Console broadcasts: push only (no in-app rows), through the same Expo
 * client and dead-token pruning as every other notification. The request
 * records the broadcast and returns; delivery runs right after, in batches,
 * updating the counts as it goes.
 */
@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    @InjectRepository(AdminBroadcast)
    private readonly repo: Repository<AdminBroadcast>,
    private readonly notifications: NotificationsService,
    private readonly audit: OperationalAuditService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    actorId: string,
    dto: CreateBroadcastDto,
  ): Promise<BroadcastView> {
    if (!this.notifications.pushEnabled) {
      throw new ServiceUnavailableException({
        code: ErrorCode.PUSH_DISABLED,
        message:
          'Push notifications are switched off on this server (PUSH_ENABLED), so nothing can be broadcast.',
      });
    }
    if (dto.service && dto.audience !== 'partners') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'A service narrows the partners audience only.',
        details: { fields: { service: ['only with audience partners'] } },
      });
    }
    const [{ count }] = (await this.dataSource.query(
      `SELECT count(*)::int AS count FROM admin_broadcasts
        WHERE created_by = $1 AND created_at > now() - interval '1 hour'`,
      [actorId],
    )) as Array<{ count: number }>;
    if (count >= MAX_PER_HOUR) {
      throw new HttpException(
        {
          code: ErrorCode.RATE_LIMITED,
          message: `At most ${MAX_PER_HOUR} broadcasts an hour. Please wait before sending another.`,
          details: { limit: MAX_PER_HOUR, windowSeconds: 3600 },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const row = await this.repo.save(
      this.repo.create({
        createdBy: actorId,
        audience: dto.audience,
        service: dto.service ?? null,
        title: dto.title,
        body: dto.body,
        deepLink: dto.deepLink ?? null,
        status: 'queued',
      }),
    );
    await this.audit.record({
      action: 'broadcast.send',
      targetType: 'broadcast',
      targetId: row.id,
      before: null,
      after: {
        audience: row.audience,
        service: row.service,
        title: row.title,
        body: row.body,
        deepLink: row.deepLink,
      },
    });
    this.track(this.deliver(row.id));
    return this.view(row, null);
  }

  async list(q: PaginationQueryDto) {
    const [rows, total] = await this.repo.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    const authors = rows.length
      ? await this.dataSource
          .getRepository(User)
          .createQueryBuilder('u')
          .select(['u.id', 'u.email', 'u.displayName'])
          .where('u.id IN (:...ids)', {
            ids: [...new Set(rows.map((r) => r.createdBy))],
          })
          .getMany()
      : [];
    const byId = new Map(authors.map((a) => [a.id, a]));
    return paged(
      rows.map((r) => this.view(r, byId.get(r.createdBy) ?? null)),
      total,
      q,
    );
  }

  /** Waits for every delivery in flight (tests; graceful shutdown). */
  async settle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  /** Sends one broadcast to its audience's devices, batch by batch. */
  async deliver(id: string): Promise<void> {
    const b = await this.repo.findOneByOrFail({ id });
    const where = audienceWhere(
      b.audience as BroadcastAudience,
      b.service as ServiceType | null,
    );
    try {
      const totals = await this.devices(where)
        .select('count(*)::int', 'devices')
        .addSelect('count(DISTINCT d.user_id)::int', 'recipients')
        .getRawOne<{ devices: number; recipients: number }>();
      await this.repo.update(
        { id },
        {
          status: 'sending',
          startedAt: new Date(),
          devices: totals?.devices ?? 0,
          recipients: totals?.recipients ?? 0,
        },
      );

      let after = '00000000-0000-0000-0000-000000000000';
      let delivered = 0;
      let failed = 0;
      for (;;) {
        const batch = await this.devices(where)
          .select(['d.id AS id', 'd.expo_push_token AS token'])
          .andWhere('d.id > :after', { after })
          .orderBy('d.id', 'ASC')
          .limit(BATCH)
          .getRawMany<{ id: string; token: string }>();
        if (!batch.length) break;
        after = batch[batch.length - 1].id;
        const result = await this.notifications.pushToDevices(
          batch.map((d) => ({
            to: d.token,
            title: b.title,
            body: b.body,
            sound: 'default' as const,
            data: {
              type: 'broadcast',
              broadcastId: b.id,
              ...(b.deepLink ? { deepLink: b.deepLink } : {}),
            },
          })),
        );
        delivered += result.ok;
        failed += result.failed;
        await this.repo.update({ id }, { delivered, failed });
      }
      await this.repo.update(
        { id },
        { status: 'sent', finishedAt: new Date() },
      );
    } catch (err) {
      this.logger.error(`Broadcast ${id} failed: ${(err as Error).message}`);
      await this.repo
        .update(
          { id },
          {
            status: 'failed',
            error: (err as Error).message.slice(0, 500),
            finishedAt: new Date(),
          },
        )
        .catch(() => undefined);
    }
  }

  private devices(where: { sql: string; params: Record<string, unknown> }) {
    return this.dataSource
      .getRepository(UserDevice)
      .createQueryBuilder('d')
      .innerJoin(User, 'u', 'u.id = d.user_id')
      .where(where.sql, where.params);
  }

  private track(p: Promise<void>): void {
    const tracked = p.finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
  }

  private view(
    r: AdminBroadcast,
    author: Pick<User, 'id' | 'email' | 'displayName'> | null,
  ): BroadcastView {
    return {
      id: r.id,
      audience: r.audience,
      service: r.service,
      title: r.title,
      body: r.body,
      deepLink: r.deepLink,
      status: r.status,
      recipients: r.recipients,
      devices: r.devices,
      delivered: r.delivered,
      failed: r.failed,
      error: r.error,
      createdBy: author
        ? {
            id: author.id,
            email: author.email,
            displayName: author.displayName,
          }
        : null,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
    };
  }
}
