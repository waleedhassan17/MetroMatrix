import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Coupon } from './entities/coupon.entity';
import { CouponRedemption } from './entities/coupon-redemption.entity';
import {
  CouponQueryDto,
  CouponState,
  CreateCouponDto,
  UpdateCouponDto,
} from './dto/coupon.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { couponDiscount } from '../checkout/pricing';
import { SqlParams } from '../common/catalog-sql';

/** A reason a coupon can't be used right now — reported, not necessarily thrown. */
export interface CouponIssue {
  code:
    | typeof ErrorCode.COUPON_INVALID
    | typeof ErrorCode.COUPON_EXPIRED
    | typeof ErrorCode.COUPON_MIN_ORDER
    | typeof ErrorCode.COUPON_LIMIT_REACHED;
  message: string;
  details?: Record<string, unknown>;
}

export type CouponCheck =
  | { ok: true; coupon: Coupon; discount: number }
  | { ok: false; issue: CouponIssue };

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Coupon not found.',
  });

const invalid = (field: string, message: string) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] } },
  });

export function couponState(c: Coupon, now = new Date()): CouponState {
  if (!c.isActive) return 'inactive';
  if (c.endsAt <= now) return 'expired';
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return 'exhausted';
  if (c.startsAt > now) return 'scheduled';
  return 'active';
}

export const couponView = (c: Coupon, now = new Date()) => ({
  id: c.id,
  code: c.code,
  type: c.type,
  value: c.value,
  minOrder: c.minOrder,
  maxDiscount: c.maxDiscount,
  startsAt: c.startsAt,
  endsAt: c.endsAt,
  usageLimit: c.usageLimit,
  perUserLimit: c.perUserLimit,
  usedCount: c.usedCount,
  isActive: c.isActive,
  state: couponState(c, now),
  createdAt: c.createdAt,
});

/** SQL for each state, matching couponState(). Alias c. */
const STATE_SQL: Record<CouponState, string> = {
  inactive: 'NOT c.is_active',
  expired: 'c.is_active AND c.ends_at <= now()',
  exhausted:
    'c.is_active AND c.ends_at > now() AND c.usage_limit IS NOT NULL AND c.used_count >= c.usage_limit',
  scheduled:
    'c.is_active AND c.ends_at > now() AND (c.usage_limit IS NULL OR c.used_count < c.usage_limit) AND c.starts_at > now()',
  active:
    'c.is_active AND c.ends_at > now() AND (c.usage_limit IS NULL OR c.used_count < c.usage_limit) AND c.starts_at <= now()',
};

/**
 * Store coupons. Partners manage their own (scoped by store id); checkout and
 * preview ask `evaluate()` whether a code applies — one rule set for both.
 */
@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(Coupon) private readonly coupons: Repository<Coupon>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Partner ───────────────────────────────────────────────────────────────

  async list(storeId: string, q: CouponQueryDto) {
    const params = new SqlParams();
    const where = [`c.store_id = ${params.add(storeId)}`];
    if (q.state) where.push(`(${STATE_SQL[q.state]})`);
    const whereSql = where.join(' AND ');
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM coupons c WHERE ${whereSql}`,
      params.values,
    );
    const ids: Array<{ id: string }> = await this.dataSource.query(
      `SELECT c.id FROM coupons c WHERE ${whereSql}
        ORDER BY c.created_at DESC, c.id
        LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    const rows = ids.length
      ? await this.coupons.findBy(ids.map((r) => ({ id: r.id })))
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const now = new Date();
    return paged(
      ids.map((r) => couponView(byId.get(r.id)!, now)),
      total,
      q,
    );
  }

  async get(storeId: string, id: string) {
    return couponView(await this.owned(storeId, id));
  }

  async create(storeId: string, dto: CreateCouponDto) {
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const endsAt = new Date(dto.endsAt);
    this.checkTerms(dto.type, dto.value, startsAt, endsAt);
    if (endsAt <= new Date())
      throw invalid('endsAt', 'The end time must be in the future.');
    const exists = await this.coupons.exists({
      where: { storeId, code: dto.code },
    });
    if (exists) throw this.duplicate();
    try {
      const saved = await this.coupons.save(
        this.coupons.create({
          storeId,
          code: dto.code,
          type: dto.type,
          value: dto.value,
          minOrder: dto.minOrder ?? 0,
          maxDiscount: dto.maxDiscount ?? null,
          startsAt,
          endsAt,
          usageLimit: dto.usageLimit ?? null,
          perUserLimit: dto.perUserLimit ?? 1,
        }),
      );
      return couponView(saved);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw this.duplicate();
      throw err;
    }
  }

  async update(storeId: string, id: string, dto: UpdateCouponDto) {
    return this.dataSource.transaction(async (m) => {
      const c = await m.findOne(Coupon, {
        where: { id, storeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!c) throw notFound();
      const termsChange =
        (dto.type !== undefined && dto.type !== c.type) ||
        (dto.value !== undefined && dto.value !== c.value);
      if (termsChange && c.usedCount > 0) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message:
            'This coupon has been used, so its type and value are fixed. Create a new coupon instead.',
        });
      }
      const type = dto.type ?? c.type;
      const value = dto.value ?? c.value;
      const startsAt = dto.startsAt ? new Date(dto.startsAt) : c.startsAt;
      const endsAt = dto.endsAt ? new Date(dto.endsAt) : c.endsAt;
      this.checkTerms(type, value, startsAt, endsAt);
      if (
        dto.usageLimit !== undefined &&
        dto.usageLimit !== null &&
        dto.usageLimit < c.usedCount
      ) {
        throw invalid(
          'usageLimit',
          `It has already been used ${c.usedCount} times.`,
        );
      }
      Object.assign(c, {
        type,
        value,
        startsAt,
        endsAt,
        minOrder: dto.minOrder ?? c.minOrder,
        maxDiscount:
          dto.maxDiscount !== undefined ? dto.maxDiscount : c.maxDiscount,
        usageLimit:
          dto.usageLimit !== undefined ? dto.usageLimit : c.usageLimit,
        perUserLimit: dto.perUserLimit ?? c.perUserLimit,
        isActive: dto.isActive ?? c.isActive,
      });
      return couponView(await m.save(c));
    });
  }

  async deactivate(storeId: string, id: string) {
    const c = await this.owned(storeId, id);
    if (c.isActive) {
      c.isActive = false;
      await this.coupons.save(c);
    }
    return couponView(c);
  }

  private async owned(storeId: string, id: string) {
    const c = await this.coupons.findOne({ where: { id, storeId } });
    if (!c) throw notFound();
    return c;
  }

  private checkTerms(
    type: string,
    value: number,
    startsAt: Date,
    endsAt: Date,
  ) {
    if (type === 'percent' && value > 100) {
      throw invalid('value', 'A percent coupon is at most 100.');
    }
    if (endsAt <= startsAt) {
      throw invalid('endsAt', 'The end time must be after the start time.');
    }
  }

  private duplicate() {
    return new ConflictException({
      code: ErrorCode.CONFLICT,
      message: 'You already have a coupon with this code.',
      details: {
        fields: { code: ['Already used by another of your coupons.'] },
      },
    });
  }

  // ── Checkout / preview ────────────────────────────────────────────────────

  /**
   * Can this customer use this code on this store subtotal right now? Reads
   * only; checkout claims the use separately with `claim()`.
   */
  async evaluate(
    m: EntityManager,
    storeId: string,
    rawCode: string,
    userId: string,
    subtotal: number,
    now = new Date(),
  ): Promise<CouponCheck> {
    const code = rawCode.trim().toUpperCase();
    const c = await m.findOne(Coupon, { where: { storeId, code } });
    if (!c || !c.isActive) {
      return fail(
        ErrorCode.COUPON_INVALID,
        `"${code}" is not a valid code for this store.`,
        { code },
      );
    }
    if (c.startsAt > now) {
      return fail(ErrorCode.COUPON_INVALID, `"${code}" can't be used yet.`, {
        code,
        startsAt: c.startsAt,
      });
    }
    if (c.endsAt <= now) {
      return fail(ErrorCode.COUPON_EXPIRED, `"${code}" has expired.`, {
        code,
        endsAt: c.endsAt,
      });
    }
    if (c.usageLimit !== null && c.usedCount >= c.usageLimit) {
      return fail(
        ErrorCode.COUPON_LIMIT_REACHED,
        `"${code}" has been fully used.`,
        {
          code,
          scope: 'coupon',
        },
      );
    }
    const mine = await m.count(CouponRedemption, {
      where: { couponId: c.id, userId },
    });
    if (mine >= c.perUserLimit) {
      return fail(
        ErrorCode.COUPON_LIMIT_REACHED,
        `You have already used "${code}"${c.perUserLimit > 1 ? ` ${c.perUserLimit} times` : ''}.`,
        { code, scope: 'customer', perUserLimit: c.perUserLimit },
      );
    }
    if (subtotal < c.minOrder) {
      return fail(
        ErrorCode.COUPON_MIN_ORDER,
        `Add Rs ${c.minOrder - subtotal} more from this store to use "${code}".`,
        {
          code,
          minOrder: c.minOrder,
          subtotal,
          shortBy: c.minOrder - subtotal,
        },
      );
    }
    return { ok: true, coupon: c, discount: couponDiscount(c, subtotal) };
  }

  /** Coupons a customer could use at this store now, with what each would save on their cart. */
  async available(storeId: string, userId: string, storeSubtotal: number) {
    const rows: Coupon[] = await this.dataSource
      .getRepository(Coupon)
      .createQueryBuilder('c')
      .where('c.storeId = :storeId', { storeId })
      .andWhere(STATE_SQL.active)
      .andWhere(
        `(SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.user_id = :userId) < c.per_user_limit`,
        { userId },
      )
      .orderBy('c.endsAt', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .getMany();
    return rows.map((c) => {
      const eligible = storeSubtotal >= c.minOrder && storeSubtotal > 0;
      return {
        code: c.code,
        type: c.type,
        value: c.value,
        minOrder: c.minOrder,
        maxDiscount: c.maxDiscount,
        endsAt: c.endsAt,
        eligible,
        shortBy: Math.max(0, c.minOrder - storeSubtotal),
        discount: eligible ? couponDiscount(c, storeSubtotal) : 0,
      };
    });
  }
}

function fail(
  code: CouponIssue['code'],
  message: string,
  details?: Record<string, unknown>,
): CouponCheck {
  return { ok: false, issue: { code, message, details } };
}
