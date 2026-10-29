import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { ClientInfo } from '../../common/decorators/client-info.decorator';
import { ErrorCode } from '../../common/errors/codes';
import { SignupDto } from './dto/signup.dto';
import { SigninDto } from './dto/signin.dto';
import { isRoleAllowedOnPortal, wrongPortalMessage } from './signin-portal';
import { TokenPair, TokenService } from './token.service';
import { AccountViewService } from './account-view.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordHasher } from './password-hasher';
import { TotpService } from './totp.service';
import { AdminTotpDto } from './dto/totp.dto';
import { isAdminRole } from '../../types';
import type { SessionClient } from './web/admin-web-session';
import { AccountView, AuthResult, TotpChallengeResult } from './auth-result';

const INVALID_CREDENTIALS_MESSAGE = 'Incorrect email or password.';

export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err as QueryFailedError & { driverError?: { code?: string } }).driverError
      ?.code === '23505'
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Refuses a new account of `role` while its sign-ups are paused (403
   * SIGNUPS_PAUSED). Set by PlatformSettingsService at module init.
   */
  signupGate: (role: 'customer' | 'partner') => Promise<void> = async () => {};

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly accounts: AccountViewService,
    private readonly emailVerification: EmailVerificationService,
    private readonly audit: OperationalAuditService,
    private readonly hasher: PasswordHasher,
    private readonly totp: TotpService,
  ) {}

  // ── Sign-up / sign-in ─────────────────────────────────────────────────────

  async signup(dto: SignupDto, client: ClientInfo): Promise<AuthResult> {
    await this.signupGate(dto.role);
    if (await this.users.findByEmail(dto.email)) throw this.emailExists();

    let user = this.users.createEntity({
      email: dto.email,
      passwordHash: await this.hasher.hash(dto.password),
      displayName: dto.displayName,
      phone: dto.phone ?? null,
      role: dto.role,
      isEmailVerified: false,
      status: 'active',
    });
    try {
      user = await this.users.save(user);
    } catch (err) {
      // Two sign-ups racing for one address: the unique index decides.
      if (isUniqueViolation(err)) throw this.emailExists();
      throw err;
    }

    const tokens = await this.tokens.startSession(user, client);
    await this.emailVerification.issue(user);
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.signup',
      targetType: 'user',
      targetId: user.id,
      details: { role: user.role, method: 'password' },
    });
    return this.result(user, tokens);
  }

  async signin(
    dto: SigninDto,
    client: ClientInfo,
  ): Promise<AuthResult | TotpChallengeResult> {
    // `identifier` (username or email) or the original `email` field.
    const byUsername = !!dto.identifier && !dto.identifier.includes('@');
    const user = dto.identifier
      ? await this.users.findByIdentifier(dto.identifier)
      : await this.users.findByEmail(dto.email!);
    const passwordOk = await this.hasher.verify(
      dto.password,
      user?.passwordHash,
    );
    if (!user || !passwordOk) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: byUsername
          ? 'Incorrect username or password.'
          : INVALID_CREDENTIALS_MESSAGE,
      });
    }

    // Only once the password matched: from here on the caller has proven they
    // own the account, so telling them its state leaks nothing.
    if (user.status === 'disabled') {
      throw new ForbiddenException({
        code: ErrorCode.ACCOUNT_DISABLED,
        message: 'This account has been disabled. Contact MetroMatrix support.',
      });
    }

    // Portal gate: each door admits its own kind of account. Before any token
    // exists.
    if (!isRoleAllowedOnPortal(dto.portal, user.role)) {
      this.logger.warn(
        `Sign-in blocked (wrong portal: ${user.role} on ${dto.portal})`,
      );
      throw new ForbiddenException({
        code: ErrorCode.WRONG_PORTAL,
        message: wrongPortalMessage(user.role),
        details: { accountType: user.role, portal: dto.portal },
      });
    }

    // Admins never get tokens for a password alone.
    if (dto.portal === 'admin') {
      return {
        totpRequired: true,
        enrolmentRequired: !user.totpEnabled,
        challengeToken: await this.tokens.signChallenge(user),
      };
    }

    return this.completeSignin(user, client, {
      portal: dto.portal,
      method: 'password',
    });
  }

  /**
   * Admin sign-in step 2: the challenge from step 1 plus a TOTP code (or a
   * recovery code). The challenge is single-use.
   */
  async adminTotp(
    dto: AdminTotpDto,
    client: ClientInfo,
    kind: SessionClient = 'app',
  ): Promise<AuthResult> {
    const expired = () =>
      new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message:
          'This sign-in has expired. Enter your email and password again.',
      });
    const challenge = this.tokens.verifyChallenge(dto.challengeToken);
    if (!challenge?.exp || (await this.tokens.isRevoked(challenge.jti))) {
      throw expired();
    }
    const user = await this.users.findById(challenge.sub);
    if (!user || user.status !== 'active' || !isAdminRole(user.role)) {
      throw expired();
    }
    if (!dto.code && !dto.recoveryCode) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          'Enter the code from your authenticator app, or a recovery code.',
      });
    }
    const method = await this.totp.verifySignin(user, dto);
    await this.tokens.denylist(challenge.jti, user.id, challenge.exp);
    return this.completeSignin(
      user,
      client,
      {
        portal: 'admin',
        method,
        ...(kind === 'admin_web' ? { client: kind } : {}),
      },
      kind,
    );
  }

  /** Issue the session for an account that has passed every check. */
  async completeSignin(
    user: User,
    client: ClientInfo,
    details: Record<string, unknown>,
    kind: SessionClient = 'app',
  ): Promise<AuthResult> {
    user.lastLoginAt = new Date();
    await this.users.save(user);
    const tokens = await this.tokens.startSession(user, client, kind);
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.signin',
      targetType: 'user',
      targetId: user.id,
      details,
    });
    return this.result(user, tokens);
  }

  refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, client);
  }

  /**
   * Sign out by bearer token (POST /auth/logout, alias /auth/signout). The
   * route is public and this method authenticates the token itself, so an
   * expired, malformed or already-revoked token is a no-op success: sign-out
   * is idempotent and never leaks whether the token was valid.
   *
   * A valid token denylists its own jti (rejected at once, not at expiry) and
   * revokes its device's refresh family. Other devices stay signed in.
   */
  async signoutByToken(authorization?: string): Promise<{ signedOut: true }> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const payload = token
      ? this.tokens.verifyAccess(token, { ignoreExpiration: true })
      : null;
    if (payload?.sub) {
      if (payload.jti && payload.exp) {
        await this.tokens.denylist(payload.jti, payload.sub, payload.exp);
      }
      if (payload.sid) await this.tokens.revokeFamily(payload.sid);
    }
    return { signedOut: true };
  }

  async me(userId: string): Promise<AccountView> {
    const user = await this.users.getByIdOrFail(userId);
    return this.accounts.view(user);
  }

  // ── Email verification ────────────────────────────────────────────────────

  async verifyEmail(userId: string, otp: string): Promise<AccountView> {
    const user = await this.users.getByIdOrFail(userId);
    return this.accounts.view(await this.emailVerification.verify(user, otp));
  }

  async resendVerification(userId: string) {
    const user = await this.users.getByIdOrFail(userId);
    return this.emailVerification.resend(user);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  async result(user: User, tokens: TokenPair): Promise<AuthResult> {
    const view = await this.accounts.view(user);
    return { ...view, tokens };
  }

  private emailExists() {
    return new ConflictException({
      code: ErrorCode.EMAIL_EXISTS,
      message: 'An account with this email already exists.',
    });
  }
}
