import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ALLOW_RESTRICTED_ADMIN_KEY } from '../decorators/admin-session.decorator';
import { ErrorCode } from '../errors/codes';
import { isAdminRole } from '../../types';

/**
 * Global, after PermissionsGuard. An admin session that has not finished
 * setting up — no authenticator yet, or a temporary password from a super
 * admin — may only call the routes marked @AllowRestrictedAdmin (and the
 * public ones that authenticate themselves, like /admin/me/totp/*).
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user || !isAdminRole(user.role)) return true;
    if (user.totpEnabled !== false && !user.mustChangePassword) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(ALLOW_RESTRICTED_ADMIN_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    if (user.totpEnabled === false) {
      throw new ForbiddenException({
        code: ErrorCode.TOTP_REQUIRED,
        message: 'Set up your authenticator app first.',
        details: { enrolmentRequired: true },
      });
    }
    throw new ForbiddenException({
      code: ErrorCode.PASSWORD_CHANGE_REQUIRED,
      message: 'Choose a new password before you continue.',
    });
  }
}
