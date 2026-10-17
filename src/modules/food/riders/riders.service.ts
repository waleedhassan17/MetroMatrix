import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { Rider } from './entities/rider.entity';
import {
  CreateRiderDto,
  RiderStatusDto,
  UpdateRiderDto,
} from './dto/rider.dto';
import {
  allocateRiderUsername,
  buildRiderUsernameBase,
  riderEmail,
} from './rider-username';
import { User } from '../../users/entities/user.entity';
import { PasswordHasher } from '../../auth/password-hasher';
import { PlanService } from '../../plans/plans.service';
import type { VendorRef } from '../vendor/food-vendor.service';
import { ErrorCode } from '../../../common/errors/codes';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';

const notFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Rider not found.',
  });

/** 10 characters with a lower-case letter, an upper-case letter and a digit; no look-alikes. */
export function generateRiderPassword(): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digit = '23456789';
  const all = lower + upper + digit;
  const pick = (s: string) => s[randomInt(s.length)];
  const chars = [
    pick(lower),
    pick(upper),
    pick(digit),
    ...Array.from({ length: 7 }, () => pick(all)),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * Riders a vendor issues (FinMatrix pattern): a generated username, a password
 * shown exactly once (at creation or reset), and seats counted against the
 * plan. A rider never self-registers and has no email.
 */
@Injectable()
export class RidersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly plans: PlanService,
    private readonly audit: OperationalAuditService,
  ) {}

  view(r: Rider & { username?: string | null }, liveWindowMs = 2 * 60_000) {
    return {
      id: r.id,
      fullName: r.fullName,
      phone: r.phone,
      vehicle: r.vehicle,
      status: r.status,
      onDuty: r.onDuty,
      username: r.username ?? null,
      activeOrderCount: r.activeOrderCount,
      lastGeo: r.lastGeo
        ? { lat: r.lastGeo.coordinates[1], lng: r.lastGeo.coordinates[0] }
        : null,
      locationUpdatedAt: r.locationUpdatedAt,
      locationLive:
        !!r.locationUpdatedAt &&
        Date.now() - r.locationUpdatedAt.getTime() < liveWindowMs,
      createdAt: r.createdAt,
    };
  }

  private async withUsername(m: EntityManager, rows: Rider[]) {
    if (!rows.length) return [];
    const users: Array<{ id: string; username: string }> = await m.query(
      `SELECT id, username FROM users WHERE id = ANY($1::uuid[])`,
      [rows.map((r) => r.userId)],
    );
    const byId = new Map(users.map((u) => [u.id, u.username]));
    return rows.map((r) =>
      this.view({ ...r, username: byId.get(r.userId) ?? null } as Rider & {
        username: string | null;
      }),
    );
  }

  private async owned(
    m: EntityManager,
    v: VendorRef,
    id: string,
    lock = false,
  ) {
    const r = await m.findOne(Rider, {
      where: { id, businessId: v.businessId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!r) throw notFound();
    return r;
  }

  private async activeCount(
    m: EntityManager,
    businessId: string,
    exceptId?: string,
  ) {
    const [{ n }] = await m.query(
      `SELECT count(*)::int AS n FROM riders WHERE business_id = $1 AND status = 'active' AND ($2::uuid IS NULL OR id <> $2)`,
      [businessId, exceptId ?? null],
    );
    return n as number;
  }

  async list(v: VendorRef) {
    const rows = await this.dataSource.manager.find(Rider, {
      where: { businessId: v.businessId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return this.withUsername(this.dataSource.manager, rows);
  }

  async get(v: VendorRef, id: string) {
    const r = await this.owned(this.dataSource.manager, v, id);
    return (await this.withUsername(this.dataSource.manager, [r]))[0];
  }

  async create(v: VendorRef, dto: CreateRiderDto) {
    const password = generateRiderPassword();
    const passwordHash = await this.hasher.hash(password);
    const { rider, username } = await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `riders:${v.businessId}`,
      ]);
      await this.plans.assertWithin(
        m,
        v.businessId,
        'riders',
        (await this.activeCount(m, v.businessId)) + 1,
      );
      const [brand] = await m.query(
        `SELECT slug FROM food_brands WHERE id = $1`,
        [v.brandId],
      );
      const username = await allocateRiderUsername(
        m,
        buildRiderUsernameBase({
          brandSlug: brand.slug,
          fullName: dto.fullName,
        }),
      );
      const user = await m.save(
        m.create(User, {
          email: riderEmail(username),
          username,
          passwordHash,
          displayName: dto.fullName,
          role: 'rider',
          isEmailVerified: true,
          phone: dto.phone ?? null,
        }),
      );
      const rider = await m.save(
        m.create(Rider, {
          userId: user.id,
          businessId: v.businessId,
          fullName: dto.fullName,
          phone: dto.phone ?? null,
          vehicle: dto.vehicle ?? 'bike',
          status: 'active',
        }),
      );
      return { rider, username };
    });
    await this.audit.record({
      action: 'food.rider.create',
      targetType: 'rider',
      targetId: rider.id,
      details: { username },
    });
    return {
      rider: (await this.withUsername(this.dataSource.manager, [rider]))[0],
      // Shown once. MetroMatrix never stores or shows it again.
      credential: { username, password },
    };
  }

  async update(v: VendorRef, id: string, dto: UpdateRiderDto) {
    await this.dataSource.transaction(async (m) => {
      const r = await this.owned(m, v, id, true);
      await m.update(
        Rider,
        { id: r.id },
        {
          fullName: dto.fullName ?? r.fullName,
          phone: dto.phone !== undefined ? dto.phone : r.phone,
          vehicle: dto.vehicle ?? r.vehicle,
        },
      );
      if (dto.fullName)
        await m.update(User, { id: r.userId }, { displayName: dto.fullName });
    });
    return this.get(v, id);
  }

  /** Activation takes a seat (409 PLAN_LIMIT_REACHED when none is free); deactivation signs the rider out. */
  async setStatus(v: VendorRef, id: string, dto: RiderStatusDto) {
    await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `riders:${v.businessId}`,
      ]);
      const r = await this.owned(m, v, id, true);
      if (dto.status === r.status) return;
      if (dto.status === 'active') {
        await this.plans.assertWithin(
          m,
          v.businessId,
          'riders',
          (await this.activeCount(m, v.businessId, r.id)) + 1,
        );
      } else if (r.activeOrderCount > 0) {
        throw new ConflictException({
          code: ErrorCode.INVALID_TRANSITION,
          message: 'This rider is on a delivery. Reassign or finish it first.',
          details: {
            from: r.status,
            to: dto.status,
            activeOrders: r.activeOrderCount,
          },
        });
      }
      await m.update(
        Rider,
        { id: r.id },
        {
          status: dto.status,
          ...(dto.status !== 'active' ? { onDuty: false } : {}),
        },
      );
      if (dto.status !== 'active') {
        await m.query(
          `UPDATE users SET token_version = token_version + 1 WHERE id = $1`,
          [r.userId],
        );
      }
    });
    await this.audit.record({
      action: 'food.rider.status',
      targetType: 'rider',
      targetId: id,
      details: { status: dto.status },
    });
    return this.get(v, id);
  }

  /** A new password, shown once; every session of that rider ends. */
  async resetPassword(v: VendorRef, id: string) {
    const password = generateRiderPassword();
    const passwordHash = await this.hasher.hash(password);
    const username = await this.dataSource.transaction(async (m) => {
      const r = await this.owned(m, v, id, true);
      await m.query(
        `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now() WHERE id = $1`,
        [r.userId, passwordHash],
      );
      const [u] = await m.query(`SELECT username FROM users WHERE id = $1`, [
        r.userId,
      ]);
      return u.username as string;
    });
    await this.audit.record({
      action: 'food.rider.reset_password',
      targetType: 'rider',
      targetId: id,
    });
    return { username, password };
  }

  /** The sign-in name (the password is never retrievable — reset it instead). */
  async credential(v: VendorRef, id: string) {
    const r = await this.get(v, id);
    return {
      username: r.username,
      passwordAvailable: false,
      hint: 'Passwords are shown once. Reset it to issue a new one.',
    };
  }

  /** The rider's own view (GET /food/rider/me). */
  async me(userId: string) {
    const r = await this.dataSource.manager.findOneByOrFail(Rider, { userId });
    const [vendor] = await this.dataSource.query(
      `SELECT fb.id, fb.name, fb.logo_url, br.phone, br.address_line, br.area, br.city
         FROM food_brands fb JOIN branches br ON br.business_id = fb.business_id WHERE fb.business_id = $1`,
      [r.businessId],
    );
    return {
      rider: (await this.withUsername(this.dataSource.manager, [r]))[0],
      vendor: {
        id: vendor.id,
        name: vendor.name,
        logoUrl: vendor.logo_url,
        phone: vendor.phone,
        addressLine: vendor.address_line,
        area: vendor.area,
        city: vendor.city,
      },
    };
  }
}
