import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationalAuditEvent } from './operational-audit-event.entity';
import { currentActor } from '../context/request-context';

export interface AuditRecordInput {
  /** Defaults to the signed-in user of the in-flight request, if any. */
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
}

@Injectable()
export class OperationalAuditService {
  private readonly logger = new Logger(OperationalAuditService.name);

  constructor(
    @InjectRepository(OperationalAuditEvent)
    private readonly repo: Repository<OperationalAuditEvent>,
  ) {}

  /**
   * Best-effort append. Auditing must never break the action it describes,
   * so failures are logged rather than thrown.
   */
  async record(input: AuditRecordInput): Promise<void> {
    const actor = currentActor();
    try {
      await this.repo.insert(
        this.repo.create({
          actorUserId:
            input.actorUserId !== undefined ? input.actorUserId : actor.userId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          details: input.details ?? null,
          ip: actor.ipAddress?.slice(0, 64) ?? null,
          userAgent: actor.userAgent?.slice(0, 255) ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to record audit event ${input.action}: ${(err as Error).message}`,
      );
    }
  }

  listForTarget(targetType: string, targetId: string, limit = 50) {
    return this.repo.find({
      where: { targetType, targetId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
