import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import {
  DataSource,
  EntityManager,
  IsNull,
  LessThan,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { RevokedAccessToken } from './entities/revoked-access-token.entity';
import { ClientInfo } from '../../common/decorators/client-info.decorator';
import { ErrorCode } from '../../common/errors/codes';
import { randomToken, sha256Hex } from '../../common/crypto/hash';
import { durationMs } from '../../common/crypto/duration';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { UserRole } from '../../types';

export const ACCESS_AUDIENCE = 'access';
export const TOTP_AUDIENCE = 'totp';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  /** Refresh family = the signed-in device. */
  sid: string;
  /** users.token_version at issue time. */
  ver: number;
  jti: string;
  iat?: number;
  exp?: number;
}

export interface ChallengePayload {
  sub: string;
  jti: string;
  iat?: number;
  exp?: number;
}

type RotateOutcome =
  | { kind: 'rotated'; pair: TokenPair; user: User }
  | { kind: 'reused'; familyId: string; userId: string };

const refreshInvalid = () =>
  new UnauthorizedException({
    code: ErrorCode.REFRESH_INVALID,
    message: 'Your session has ended. Please sign in again.',
  });

/**
 * Sessions: access tokens, refresh-token families, revocation.
 *
 * Access token: short JWT, `aud: 'access'`. Refresh token: opaque random
 * string, SHA-256 at rest, never a JWT — FinMatrix signed its refresh tokens
 * like access tokens, so a 30-day refresh token passed the access-token check.
 */
@Injectable()
export class TokenService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;
  private readonly graceMs: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
    private readonly audit: OperationalAuditService,
    config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
    @InjectRepository(RevokedAccessToken)
    private readonly revokedRepo: Repository<RevokedAccessToken>,
  ) {
    this.accessTtlSeconds =
      durationMs(config.get<string>('jwt.accessExpiresIn', '15m')) / 1000;
    this.refreshTtlMs = durationMs(
      config.get<string>('jwt.refreshExpiresIn', '30d'),
    );
    this.graceMs =
      config.get<number>('jwt.refreshReuseGraceSeconds', 10) * 1000;
  }

  /**
   * Sign-in: a new device, so a new refresh family. `manager` puts it in the
   * caller's transaction (a password change revokes and re-issues together).
   */
  async startSession(
    user: User,
    client: ClientInfo,
    manager: EntityManager = this.refreshRepo.manager,
  ): Promise<TokenPair> {
    const { pair } = await this.issue(manager, user, randomUUID(), client);
    return pair;
  }

  /**
   * Exchange a refresh token for a new pair in the same family.
   *
   * - unknown / expired → REFRESH_INVALID
   * - revoked by a rotation less than the grace window ago, while the family
   *   is still alive → a fresh pair (two tabs refreshing at once)
   * - revoked otherwise → the token is being replayed: revoke the whole
   *   family and answer REFRESH_REUSED
   *
   * The row is locked for the duration so two concurrent refreshes of one
   * token are serialised rather than both rotating it.
   */
  async rotate(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    const tokenHash = sha256Hex(refreshToken);
    const outcome = await this.dataSource.transaction(
      async (m): Promise<RotateOutcome> => {
        const row = await m.findOne(RefreshToken, {
          where: { tokenHash },
          lock: { mode: 'pessimistic_write' },
        });
        if (!row) throw refreshInvalid();

        const user = await m.findOne(User, { where: { id: row.userId } });
        if (!user || user.status === 'deleted') throw refreshInvalid();
        if (user.status === 'disabled') {
          throw new ForbiddenException({
            code: ErrorCode.ACCOUNT_DISABLED,
            message: 'This account has been disabled.',
          });
        }

        if (row.revokedAt) {
          const withinGrace =
            row.replacedById !== null &&
            Date.now() - row.revokedAt.getTime() <= this.graceMs;
          const familyAlive =
            withinGrace &&
            (await m.exists(RefreshToken, {
              where: {
                familyId: row.familyId,
                revokedAt: IsNull(),
                expiresAt: MoreThan(new Date()),
              },
            }));
          if (withinGrace && familyAlive) {
            const { pair } = await this.issue(m, user, row.familyId, client);
            return { kind: 'rotated', pair, user };
          }
          await this.revokeFamilyWith(m, row.familyId);
          return { kind: 'reused', familyId: row.familyId, userId: user.id };
        }

        if (row.expiresAt.getTime() <= Date.now()) throw refreshInvalid();

        const next = await this.issue(m, user, row.familyId, client);
        await m.update(
          RefreshToken,
          { id: row.id },
          { revokedAt: new Date(), replacedById: next.rowId },
        );
        return { kind: 'rotated', pair: next.pair, user };
      },
    );

    if (outcome.kind === 'reused') {
      // Recorded after the commit so the family revocation is never rolled
      // back by the error below.
      await this.audit.record({
        actorUserId: null,
        action: 'auth.refresh_reused',
        targetType: 'user',
        targetId: outcome.userId,
        details: { familyId: outcome.familyId },
      });
      throw new UnauthorizedException({
        code: ErrorCode.REFRESH_REUSED,
        message:
          'This session was signed out because its refresh token was used twice. Please sign in again.',
      });
    }
    return outcome.pair;
  }

  /** Sign out one device. */
  async revokeFamily(familyId: string): Promise<void> {
    await this.revokeFamilyWith(this.refreshRepo.manager, familyId);
  }

  /** Sign out every device, or every device but the caller's. */
  async revokeAllForUser(
    userId: string,
    exceptFamilyId?: string,
    manager: EntityManager = this.refreshRepo.manager,
  ): Promise<void> {
    await manager.update(
      RefreshToken,
      {
        userId,
        revokedAt: IsNull(),
        ...(exceptFamilyId ? { familyId: Not(exceptFamilyId) } : {}),
      },
      { revokedAt: new Date() },
    );
  }

  /** Put an access token's jti on the denylist until it would expire anyway. */
  async denylist(jti: string, userId: string, exp: number): Promise<void> {
    if (exp * 1000 <= Date.now()) return;
    // orIgnore(): signing out twice with one token must not 500 on the PK.
    await this.revokedRepo
      .createQueryBuilder()
      .insert()
      .values({ jti, userId, expiresAt: new Date(exp * 1000) })
      .orIgnore()
      .execute();
  }

  isRevoked(jti: string): Promise<boolean> {
    return this.revokedRepo.exists({ where: { jti } });
  }

  /**
   * Verify a bearer access token outside the guard (sign-out). Signature and
   * audience are always checked; expiry optionally, so an expired token can
   * still sign its own device out.
   */
  verifyAccess(
    token: string,
    opts: { ignoreExpiration?: boolean } = {},
  ): AccessTokenPayload | null {
    try {
      return this.jwt.verify<AccessTokenPayload>(token, {
        audience: ACCESS_AUDIENCE,
        ignoreExpiration: opts.ignoreExpiration ?? false,
      });
    } catch {
      return null;
    }
  }

  /** Admin sign-in step 1 → a short-lived ticket for the TOTP step. */
  signChallenge(user: User): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, jti: randomUUID() },
      { audience: TOTP_AUDIENCE, expiresIn: '5m' },
    );
  }

  verifyChallenge(token: string): ChallengePayload | null {
    try {
      return this.jwt.verify<ChallengePayload>(token, {
        audience: TOTP_AUDIENCE,
      });
    } catch {
      return null;
    }
  }

  /** Daily housekeeping (AuthMaintenanceService). */
  async prune(): Promise<{ denylist: number; refresh: number }> {
    const now = new Date();
    const denylist = await this.revokedRepo.delete({
      expiresAt: LessThan(now),
    });
    const refresh = await this.refreshRepo.delete({
      expiresAt: LessThan(new Date(now.getTime() - 30 * 86_400_000)),
    });
    return { denylist: denylist.affected ?? 0, refresh: refresh.affected ?? 0 };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async issue(
    manager: EntityManager,
    user: User,
    familyId: string,
    client: ClientInfo,
  ): Promise<{ pair: TokenPair; rowId: string }> {
    const refreshToken = randomToken(32);
    const row = await manager.save(
      manager.create(RefreshToken, {
        userId: user.id,
        familyId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
        revokedAt: null,
        replacedById: null,
        userAgent: client.userAgent?.slice(0, 255) ?? null,
        ip: client.ip?.slice(0, 64) ?? null,
      }),
    );
    const payload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      sid: familyId,
      ver: user.tokenVersion,
      jti: randomUUID(),
    };
    const accessToken = await this.jwt.signAsync(payload, {
      audience: ACCESS_AUDIENCE,
      expiresIn: this.accessTtlSeconds,
    });
    return {
      pair: { accessToken, refreshToken, expiresIn: this.accessTtlSeconds },
      rowId: row.id,
    };
  }

  private async revokeFamilyWith(
    manager: EntityManager,
    familyId: string,
  ): Promise<void> {
    await manager.update(
      RefreshToken,
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }
}
