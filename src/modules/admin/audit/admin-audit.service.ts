import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationalAuditEvent } from '../../../common/audit/operational-audit-event.entity';
import { User } from '../../users/entities/user.entity';
import { ErrorCode } from '../../../common/errors/codes';
import { likeEscape } from '../../../common/pagination/pagination';
import { AuditEventView, AuditQueryDto } from './admin-audit.dto';

/**
 * `createdAt|id`, base64url: where the next page starts (newest first). The
 * time is Postgres's own microsecond text — a JS Date keeps milliseconds
 * only, and would skip rows written within the same millisecond.
 */
const encodeCursor = (e: { cursorAt: string; id: string }) =>
  Buffer.from(`${e.cursorAt}|${e.id}`).toString('base64url');

const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function decodeCursor(cursor: string): { at: string; id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!id || !CURSOR_AT.test(at ?? '') || !/^[0-9a-f-]{36}$/.test(id)) {
    throw new BadRequestException({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'That cursor is not valid. Start from the first page.',
      details: { fields: { cursor: ['invalid'] } },
    });
  }
  return { at, id };
}

/** GET /admin/audit — read-only by construction: there is no write path. */
@Injectable()
export class AdminAuditService {
  constructor(
    @InjectRepository(OperationalAuditEvent)
    private readonly repo: Repository<OperationalAuditEvent>,
  ) {}

  async list(q: AuditQueryDto) {
    const qb = this.repo
      .createQueryBuilder('e')
      .leftJoin(User, 'u', 'u.id = e.actor_user_id')
      .select([
        'e.id AS id',
        'e.action AS action',
        'e.target_type AS "targetType"',
        'e.target_id AS "targetId"',
        'e.actor_user_id AS "actorUserId"',
        'e.details AS details',
        'e.before AS before',
        'e.after AS after',
        'e.ip AS ip',
        'e.user_agent AS "userAgent"',
        'e.request_id AS "requestId"',
        'e.created_at AS "createdAt"',
        `to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"`,
        'u.email AS "actorEmail"',
        'u.display_name AS "actorName"',
        'u.role AS "actorRole"',
      ]);
    if (q.actorUserId) {
      qb.andWhere('e.actor_user_id = :actor', { actor: q.actorUserId });
    }
    if (q.action?.endsWith('*')) {
      qb.andWhere(`e.action LIKE :action ESCAPE '\\'`, {
        action: `${likeEscape(q.action.slice(0, -1))}%`,
      });
    } else if (q.action) {
      qb.andWhere('e.action = :action', { action: q.action });
    }
    if (q.targetType) {
      qb.andWhere('e.target_type = :tt', { tt: q.targetType });
    }
    if (q.targetId) qb.andWhere('e.target_id = :tid', { tid: q.targetId });
    if (q.from) qb.andWhere('e.created_at >= :from', { from: q.from });
    if (q.to) qb.andWhere('e.created_at < :to', { to: q.to });
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      qb.andWhere('(e.created_at, e.id) < (:at::timestamptz, :cid::uuid)', {
        at: c.at,
        cid: c.id,
      });
    }
    const rows = await qb
      .orderBy('e.created_at', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .limit(q.limit + 1)
      .getRawMany<AuditRow>();
    const page = rows.slice(0, q.limit);
    const items = page.map((r): AuditEventView => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      actorUserId: r.actorUserId,
      actor:
        r.actorUserId && r.actorEmail
          ? {
              id: r.actorUserId,
              email: r.actorEmail,
              displayName: r.actorName,
              role: r.actorRole!,
            }
          : null,
      details: r.details,
      before: r.before,
      after: r.after,
      ip: r.ip,
      userAgent: r.userAgent,
      requestId: r.requestId,
      createdAt: r.createdAt,
    }));
    return {
      items,
      nextCursor:
        rows.length > q.limit ? encodeCursor(page[page.length - 1]) : null,
    };
  }
}

interface AuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actorUserId: string | null;
  details: Record<string, unknown> | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
  cursorAt: string;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
}
