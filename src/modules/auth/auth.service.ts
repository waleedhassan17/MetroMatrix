import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// bcryptjs (pure JS) as in FinMatrix: no native build step on Heroku/Alpine.
import * as bcrypt from 'bcryptjs';
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
  private readonly bcryptRounds: number;
  /** Compared against when the email is unknown, so timing reveals nothing. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly accounts: AccountViewService,
    private readonly emailVerification: EmailVerificationService,
    private readonly audit: OperationalAuditService,
    config: ConfigService,
  ) {
    this.bcryptRounds = config.get<number>('app.bcryptRounds', 12);
  }

  // ── Sign-up / sign-in ─────────────────────────────────────────────────────

  async signup(dto: SignupDto, client: ClientInfo): Promise<AuthResult> {
    if (await this.users.findByEmail(dto.email)) throw this.emailExists();

    let user = this.users.createEntity({
      email: dto.email,
      passwordHash: await this.hashPassword(dto.password),
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
    const user = await this.users.findByEmail(dto.email);
    const passwordOk = user?.passwordHash
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : await this.burnCompare(dto.password);
    if (!user || !passwordOk) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: INVALID_CREDENTIALS_MESSAGE,
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

  /** Issue the session for an account that has passed every check. */
  async completeSignin(
    user: User,
    client: ClientInfo,
    details: Record<string, unknown>,
  ): Promise<AuthResult> {
    user.lastLoginAt = new Date();
    await this.users.save(user);
    const tokens = await this.tokens.startSession(user, client);
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

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.bcryptRounds);
  }

  async result(user: User, tokens: TokenPair): Promise<AuthResult> {
    const view = await this.accounts.view(user);
    return { user: view.user, tokens, business: view.business };
  }

  /** A real bcrypt comparison that always fails — same cost as a hit. */
  private async burnCompare(password: string): Promise<false> {
    this.dummyHash ??= bcrypt.hash('metromatrix-timing-pad', this.bcryptRounds);
    await bcrypt.compare(password, await this.dummyHash);
    return false;
  }

  private emailExists() {
    return new ConflictException({
      code: ErrorCode.EMAIL_EXISTS,
      message: 'An account with this email already exists.',
    });
  }
}
