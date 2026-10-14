import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ErrorCode } from '../errors/codes';

/**
 * Global (registered after JwtAuthGuard in AppModule). No-op on routes without
 * @Roles(); otherwise the signed-in user's role — read from the database by
 * JwtStrategy, not from the token — must be one of those listed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const role = req.user?.role;
    if (role && requiredRoles.includes(role)) return true;

    throw new ForbiddenException({
      code: ErrorCode.FORBIDDEN,
      message: 'You do not have permission to perform this action.',
    });
  }
}
