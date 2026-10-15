import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../../../common/decorators/optional-auth.decorator';
import { ErrorCode } from '../../../common/errors/codes';

/**
 * Real JWT guard using passport-jwt. Honors @PublicRoute() to skip auth, and
 * @OptionalAuth() to attach a signed-in caller without requiring one.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isOptional(context)) {
      const req = context.switchToHttp().getRequest<Request>();
      if (!req.headers.authorization) return true;
      try {
        await super.canActivate(context);
      } catch {
        // A bad token on an optional route is treated as no token at all.
      }
      return true;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return (await super.canActivate(context)) as boolean;
  }

  /**
   * passport-jwt's own failure is a bare 401. Keep the specific answer when
   * JwtStrategy threw one (TOKEN_REVOKED, ACCOUNT_DISABLED); otherwise say
   * whether the token was missing or expired, so the client knows to refresh.
   * On an optional route, any failure just means "anonymous".
   */
  handleRequest<TUser>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (this.isOptional(context)) return (user || undefined) as TUser;
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

  private isOptional(context: ExecutionContext): boolean {
    return !!this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
