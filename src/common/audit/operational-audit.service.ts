import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationalAuditEvent } from './operational-audit-event.entity';
import { countAudit, currentActor } from '../context/request-context';

export interface AuditRecordInput {
  /** Defaults to the signed-in user of the in-flight request, if any. */
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
  /** The changed fields before the write (see changedFields). */
  before?: Record<string, unknown> | null;
  /** The same fields after it. */
  after?: Record<string, unknown> | null;
}

/**
 * Only the fields that actually changed, in both snapshots — what the audit
 * row's before/after carry. Values compare by their JSON form, so dates and
 * nested objects work.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[] = Object.keys(after),
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of keys) {
    if (
      JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)
    ) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return { before: b, after: a };
}

/** Pick `keys` from a row, for a before or after snapshot. */
export function snapshot<T extends object>(
  row: T,
  keys: (keyof T & string)[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
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
    // Full snapshots on both sides: keep only what changed.
    const diff =
      input.before && input.after
        ? changedFields(input.before, input.after, [
            ...new Set([
              ...Object.keys(input.before),
              ...Object.keys(input.after),
            ]),
          ])
        : null;
    try {
      await this.repo.insert(
        this.repo.create({
          actorUserId:
            input.actorUserId !== undefined ? input.actorUserId : actor.userId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          details: input.details ?? null,
          before: diff ? diff.before : (input.before ?? null),
          after: diff ? diff.after : (input.after ?? null),
          ip: actor.ipAddress?.slice(0, 64) ?? null,
          userAgent: actor.userAgent?.slice(0, 255) ?? null,
          requestId: actor.requestId?.slice(0, 128) ?? null,
        }),
      );
      countAudit();
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
