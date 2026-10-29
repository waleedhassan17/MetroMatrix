import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TokenService } from '../token.service';
import { UsersService } from '../../users/users.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../../common/errors/codes';
import { isAdminRole } from '../../../types';
import { adminFields } from '../access-token-validator';

/** How the caller of /admin/me/totp/* proved who they are. */
export type TotpAuth =
  { kind: 'access' } | { kind: 'challenge'; jti: string; exp: number };

export type TotpEnrolRequest = Request & {
  user?: AuthenticatedUser;
  totpAuth?: TotpAuth;
};

const unauthorized = () =>
  new UnauthorizedException({
    code: ErrorCode.UNAUTHORIZED,
    message: 'Sign in again to set up your authenticator.',
  });

/**
 * Guards /admin/me/totp/enrol|confirm, which accept either:
 *
 * - an admin **access token** — rotating an authenticator that already works
 *   (confirm then also demands a code from the current one), or
 * - an admin-portal **challenge token** (`aud: 'totp'`) belonging to an admin
 *   who has NOT enrolled yet — the only way a freshly seeded admin can get a
 *   second factor, since admin tokens are never issued without one.
 *
 * The routes are @PublicRoute so the global JwtAuthGuard (access tokens only)
 * steps aside; this guard does the authentication itself.
 */
@Injectable()
export class AdminTotpEnrolGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TotpEnrolRequest>();
    const token = req.headers.authorization
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim();
    if (!token) throw unauthorized();

    const access = this.tokens.verifyAccess(token);
    if (access) {
      if (await this.tokens.isRevoked(access.jti)) throw unauthorized();
      const user = await this.users.findById(access.sub);
      if (
        !user ||
        user.status !== 'active' ||
        user.tokenVersion !== access.ver
      ) {
        throw unauthorized();
      }
      if (!isAdminRole(user.role)) {
        throw new ForbiddenException({
          code: ErrorCode.FORBIDDEN,
          message: 'Only admins use an authenticator app.',
        });
      }
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        sid: access.sid,
        emailVerified: user.isEmailVerified,
        ...adminFields(user),
      };
      req.totpAuth = { kind: 'access' };
      return true;
    }

    const challenge = this.tokens.verifyChallenge(token);
    if (!challenge?.exp || (await this.tokens.isRevoked(challenge.jti))) {
      throw unauthorized();
    }
    const user = await this.users.findById(challenge.sub);
    if (!user || user.status !== 'active' || !isAdminRole(user.role)) {
      throw unauthorized();
    }
    if (user.totpEnabled) {
      // A challenge only enrols the FIRST authenticator. Otherwise anyone with
      // the password could replace the second factor.
      throw new ForbiddenException({
        code: ErrorCode.TOTP_REQUIRED,
        message:
          'Your authenticator is already set up. Sign in with a code from it.',
      });
    }
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      sid: '',
      emailVerified: user.isEmailVerified,
      ...adminFields(user),
    };
    req.totpAuth = {
      kind: 'challenge',
      jti: challenge.jti,
      exp: challenge.exp,
    };
    return true;
  }
}
