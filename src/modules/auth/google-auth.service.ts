import { ForbiddenException, Injectable } from '@nestjs/common';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { GoogleIdentity, GoogleTokenVerifier } from './google-token-verifier';
import { AuthService, isUniqueViolation } from './auth.service';
import { TokenService } from './token.service';
import { AuthResult } from './auth-result';
import { wrongPortalMessage } from './signin-portal';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { ClientInfo } from '../../common/decorators/client-info.decorator';
import { ErrorCode } from '../../common/errors/codes';

/**
 * "Continue with Google" — customer portal only.
 *
 *  1. An account already linked to this Google `sub` signs in.
 *  2. Otherwise Google must vouch for the email (`email_verified`), or we
 *     refuse: an unverified address proves nothing about who owns it.
 *  3. An existing customer with that email is linked and marked verified.
 *     A partner or admin with that email is refused (WRONG_PORTAL) — Google
 *     must never become a side door into those accounts.
 *  4. Otherwise a new, verified customer is created.
 */
@Injectable()
export class GoogleAuthService {
  /** Refuses a new customer while sign-ups are paused (PlatformSettingsService). */
  signupGate: (role: 'customer') => Promise<void> = async () => {};

  constructor(
    private readonly verifier: GoogleTokenVerifier,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly audit: OperationalAuditService,
  ) {}

  async signIn(idToken: string, client: ClientInfo): Promise<AuthResult> {
    const google = await this.verifier.verify(idToken);

    const linked = await this.users.findByGoogleSub(google.sub);
    if (linked) {
      this.assertCustomer(linked);
      return this.auth.completeSignin(linked, client, {
        portal: 'customer',
        method: 'google',
      });
    }

    if (!google.emailVerified) {
      throw new ForbiddenException({
        code: ErrorCode.EMAIL_NOT_VERIFIED,
        message:
          'Your Google account email is not verified. Verify it with Google, or sign up with email and password.',
      });
    }

    const byEmail = await this.users.findByEmail(google.email);
    if (byEmail) {
      this.assertCustomer(byEmail);
      if (byEmail.googleSub && byEmail.googleSub !== google.sub) {
        throw new ForbiddenException({
          code: ErrorCode.INVALID_CREDENTIALS,
          message: 'This account is linked to a different Google account.',
        });
      }
      byEmail.googleSub = google.sub;
      // Google has just proven the address belongs to this person.
      byEmail.isEmailVerified = true;
      byEmail.avatarUrl ??= google.picture;
      await this.users.save(byEmail);
      await this.audit.record({
        actorUserId: byEmail.id,
        action: 'auth.google_linked',
        targetType: 'user',
        targetId: byEmail.id,
      });
      return this.auth.completeSignin(byEmail, client, {
        portal: 'customer',
        method: 'google',
      });
    }

    return this.createCustomer(google, client);
  }

  private async createCustomer(
    google: GoogleIdentity,
    client: ClientInfo,
  ): Promise<AuthResult> {
    // Only a brand-new account is paused; linking and signing in still work.
    await this.signupGate('customer');
    let user = this.users.createEntity({
      email: google.email,
      passwordHash: null,
      displayName: (google.name ?? google.email.split('@')[0]).slice(0, 80),
      role: 'customer',
      isEmailVerified: true,
      googleSub: google.sub,
      avatarUrl: google.picture,
      status: 'active',
      lastLoginAt: new Date(),
    });
    try {
      user = await this.users.save(user);
    } catch (err) {
      // The same Google account signing up twice at once: the unique index
      // decides, and the loser signs in to the winner's account.
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.users.findByGoogleSub(google.sub);
      if (!winner) throw err;
      return this.auth.completeSignin(winner, client, {
        portal: 'customer',
        method: 'google',
      });
    }
    const tokens = await this.tokens.startSession(user, client);
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.signup',
      targetType: 'user',
      targetId: user.id,
      details: { role: 'customer', method: 'google' },
    });
    return this.auth.result(user, tokens);
  }

  private assertCustomer(user: User): void {
    if (user.role !== 'customer') {
      throw new ForbiddenException({
        code: ErrorCode.WRONG_PORTAL,
        message: wrongPortalMessage(user.role),
        details: { accountType: user.role, portal: 'customer' },
      });
    }
    if (user.status === 'disabled') {
      throw new ForbiddenException({
        code: ErrorCode.ACCOUNT_DISABLED,
        message: 'This account has been disabled. Contact MetroMatrix support.',
      });
    }
  }
}
