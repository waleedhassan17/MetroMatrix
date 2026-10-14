import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ErrorCode } from '../../../common/errors/codes';

/**
 * Real JWT guard using passport-jwt. Honors @PublicRoute() to skip auth.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  /**
   * passport-jwt's own failure is a bare 401. Keep the specific answer when
   * JwtStrategy threw one (TOKEN_REVOKED, ACCOUNT_DISABLED); otherwise say
   * whether the token was missing or expired, so the client knows to refresh.
   */
  handleRequest<TUser>(err: unknown, user: TUser, info: unknown): TUser {
    if (err) throw err;
    if (user) return user;
    const expired =
      (info as { name?: string } | undefined)?.name === 'TokenExpiredError';
    throw new UnauthorizedException({
      code: ErrorCode.UNAUTHORIZED,
      message: expired
        ? 'Your session has expired. Refresh your token.'
        : 'Authentication required.',
    });
  }
}
